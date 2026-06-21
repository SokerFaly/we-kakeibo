"use strict";
/* ============================================================================
   We 家計簿 — GitHub 同期レイヤー (sync.js)
   方針: ローカル優先 + 非同期同期。既存の load()/save() は同期のまま、
        ここで「もう一枚 save を包む」+ プル/プッシュを足すだけ。
        storage.js / compute.js / ui.js / main.js は一切変更しない。
        トークンとリポジトリ情報は localStorage のみに保存（コードには入れない）。
   ============================================================================ */

/* ---------- 純粋ロジック（ブラウザ非依存・node でテスト可能） ---------- */
function _clone(o){ return o==null ? o : JSON.parse(JSON.stringify(o)); }
function _eq(a,b){ return JSON.stringify(a)===JSON.stringify(b); }

/* UTF-8 安全な base64（日本語が壊れない） */
function _b64encode(str){
  const bytes = new TextEncoder().encode(str);
  let bin=""; for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function _b64decode(b64){
  const bin = atob(String(b64).replace(/\s/g,""));
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* 3-way マージ（月単位）:
   - 別々の月を編集 → 両方とも残る（衝突しない）
   - 同じ月を同時編集 → db 全体の lastModified が新しい方を採用
   base: 前回同期時点（共通祖先）。初回 null は remote 採用 + ローカル限定の月を温存。 */
function _mergeDb(base, local, remote){
  const out = _clone(remote);
  if(!base){
    out.months = _clone(remote.months);
    for(const k in local.months) if(!(k in remote.months)) out.months[k] = _clone(local.months[k]);
    const ln = (local.lastModified||0) > (remote.lastModified||0);
    out.settings = _clone(ln ? local.settings : remote.settings);
    out.lastModified = Math.max(local.lastModified||0, remote.lastModified||0);
    return out;
  }
  const localNewer = (local.lastModified||0) >= (remote.lastModified||0);
  out.months = {};
  const keys = new Set([
    ...Object.keys(base.months||{}),
    ...Object.keys(local.months||{}),
    ...Object.keys(remote.months||{})
  ]);
  for(const k of keys){
    const b=base.months[k], l=local.months[k], r=remote.months[k];
    const bs=JSON.stringify(b||null), ls=JSON.stringify(l||null), rs=JSON.stringify(r||null);
    let win;
    if(ls===bs)      win = r;                  // ローカル未変更 → リモート
    else if(rs===bs) win = l;                  // リモート未変更 → ローカル
    else             win = localNewer ? l : r; // 両方変更 → 時刻で決定
    if(win!==undefined && win!==null) out.months[k] = _clone(win);
  }
  out.settings = _clone(localNewer ? local.settings : remote.settings);
  out.lastModified = Math.max(local.lastModified||0, remote.lastModified||0);
  return out;
}

/* node からはコアだけ require 可能（テスト用） */
if (typeof module !== "undefined" && module.exports){
  module.exports = { _clone, _eq, _b64encode, _b64decode, _mergeDb };
}

/* ============================ ブラウザでのみ実行 ============================ */
if (typeof document !== "undefined") (function(){
  const LS = { token:"we_kakeibo_gh_token", owner:"we_kakeibo_gh_owner",
               repo:"we_kakeibo_gh_repo", path:"we_kakeibo_gh_path", sha:"we_kakeibo_gh_sha" };
  const ls    = (k)=>{ try{ return localStorage.getItem(k)||""; }catch(_){ return ""; } };
  const lsSet = (k,v)=>{ try{ localStorage.setItem(k,v); }catch(_){ } };
  const lsDel = (k)=>{ try{ localStorage.removeItem(k); }catch(_){ } };

  function cfg(){ return { token:ls(LS.token), owner:ls(LS.owner), repo:ls(LS.repo), path:ls(LS.path)||"data.json" }; }
  function configured(){ const c=cfg(); return !!(c.token && c.owner && c.repo); }

  let syncedBase = null;            // 前回同期時点（共通祖先）。メモリのみ。
  let pulling=false, pushTimer=null, lastPullAt=0;
  let STATUS="idle";                // idle|syncing|synced|offline|noauth

  /* ローカルだけに書く（プッシュも lastModified も触らない）。storage.js の KEY/MEM を流用 */
  function rawLocalSave(){
    try{ localStorage.setItem(KEY, JSON.stringify(db)); }
    catch(_){ try{ MEM = JSON.parse(JSON.stringify(db)); }catch(__){} }
  }

  /* ---- GitHub contents API ---- */
  function apiUrl(){ const c=cfg(); return "https://api.github.com/repos/"+c.owner+"/"+c.repo+"/contents/"+c.path.split("/").map(encodeURIComponent).join("/"); }
  function headers(){ const c=cfg(); return { "Authorization":"Bearer "+c.token, "Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" }; }
  async function ghGet(){
    const res = await fetch(apiUrl(), { headers:headers(), cache:"no-store" });
    if(res.status===404) return { exists:false };
    if(res.status===401 || res.status===403){ const e=new Error("auth"); e.code="auth"; throw e; }
    if(!res.ok) throw new Error("GET "+res.status);
    const j = await res.json();
    return { exists:true, sha:j.sha, data: JSON.parse(_b64decode(j.content)) };
  }
  async function ghPut(obj, sha){
    const body = { message:"We家計簿 更新 "+new Date().toISOString(), content:_b64encode(JSON.stringify(obj,null,2)) };
    if(sha) body.sha = sha;
    const res = await fetch(apiUrl(), { method:"PUT", headers:Object.assign({"Content-Type":"application/json"}, headers()), body:JSON.stringify(body) });
    if(res.status===409) return { conflict:true };
    if(res.status===401 || res.status===403){ const e=new Error("auth"); e.code="auth"; throw e; }
    if(!res.ok) throw new Error("PUT "+res.status);
    const j = await res.json();
    return { sha: j.content && j.content.sha };
  }

  /* ---- プル（取得 → マージ → ローカル反映 → 必要ならプッシュ予約） ---- */
  async function pull(){
    if(!configured()){ setStatus("noauth"); return; }
    if(pulling) return;
    pulling=true; lastPullAt=Date.now(); setStatus("syncing");
    try{
      const r = await ghGet();
      if(!r.exists){                              // リモートに未作成 → 今のローカルを初期アップ
        const p = await ghPut(db, null);
        if(p.conflict){ pulling=false; return pull(); }
        lsSet(LS.sha, p.sha||""); syncedBase=_clone(db); setStatus("synced"); return;
      }
      lsSet(LS.sha, r.sha);
      const merged     = _mergeDb(syncedBase, db, r.data);
      const sameLocal  = _eq(merged, db);
      const sameRemote = _eq(merged, r.data);
      db = merged;
      if(!db.months[active]) active = Object.keys(db.months).sort().pop();
      rawLocalSave();
      if(!sameLocal && typeof render==="function") render();
      if(sameRemote){ syncedBase=_clone(r.data); setStatus("synced"); }
      else { schedulePush(); }                    // ローカルにしか無い変更 → 上げる（基準は成功時更新）
    }catch(e){
      setStatus(e && e.code==="auth" ? "noauth" : "offline");
    }finally{ pulling=false; }
  }

  /* ---- プッシュ（デバウンス） ---- */
  function schedulePush(){ if(!configured()) return; clearTimeout(pushTimer); pushTimer=setTimeout(pushNow, 1500); }
  async function pushNow(){
    if(!configured()){ setStatus("noauth"); return; }
    setStatus("syncing");
    try{
      const r = await ghPut(db, ls(LS.sha)||null);
      if(r.conflict){ await pull(); return; }      // 誰かが先に上げた → プルしてマージ（必要なら再プッシュ）
      lsSet(LS.sha, r.sha||""); syncedBase=_clone(db); setStatus("synced");
    }catch(e){
      setStatus(e && e.code==="auth" ? "noauth" : "offline");   // 次の保存/フォーカスで再試行
    }
  }

  /* ---- save をもう一枚包む: ローカル保存（既存）+ プッシュ予約 ---- */
  const _saveLocal = save;
  save = function(){ const out=_saveLocal.apply(this, arguments); if(configured()) schedulePush(); return out; };

  /* ---- 状態バッジ: updateLastmod を包んで「最終更新…」の後ろに付ける ---- */
  const _updateLastmod = (typeof updateLastmod==="function") ? updateLastmod : null;
  function statusText(){ return ({syncing:"同期中…", synced:"同期済", offline:"オフライン", noauth:"未設定"}[STATUS]) || ""; }
  if(_updateLastmod){
    updateLastmod = function(){
      _updateLastmod.apply(this, arguments);
      const el=document.getElementById("lastmod"); if(!el || !configured()) return;
      const col = (STATUS==="offline") ? "#b3541e" : (STATUS==="syncing" ? "#9a8f7a" : "#5b7a52");
      const sep = el.innerHTML ? " · " : '<span class="dot"></span>';
      el.innerHTML += sep + '<span style="color:'+col+'">' + statusText() + '</span>';
    };
  }
  function setStatus(s){ STATUS=s; if(typeof updateLastmod==="function") updateLastmod(); }

  /* ---- 設定シートに「同期設定」を注入（ui.js は触らない・2枚目のクリックリスナ） ---- */
  function injectSyncUI(){
    const sheet=document.getElementById("sheet"); if(!sheet) return;
    if(document.getElementById("sync-save")) return;             // 二重注入防止
    const c=cfg();
    const esc=(s)=>String(s).replace(/"/g,"&quot;");
    sheet.insertAdjacentHTML("beforeend",
      '<div style="margin-top:22px;border-top:1px solid rgba(0,0,0,.08);padding-top:16px">'
      + '<h2 style="font-size:16px">同期設定（GitHub）</h2>'
      + '<div class="desc">二人で同じ家計簿を共有します。トークンとリポジトリ情報は<b>この端末のブラウザのみ</b>に保存され、公開コードには含まれません。</div>'
      + '<div class="field"><label>GitHub ユーザー名</label><input class="finput" id="sync-owner" value="'+esc(c.owner)+'" autocomplete="off" spellcheck="false"></div>'
      + '<div class="field"><label>プライベートリポジトリ名</label><input class="finput" id="sync-repo" value="'+esc(c.repo)+'" autocomplete="off" spellcheck="false"></div>'
      + '<div class="field"><label>ファイルパス</label><input class="finput" id="sync-path" value="'+esc(c.path)+'" autocomplete="off" spellcheck="false"></div>'
      + '<div class="field"><label>アクセストークン (PAT)</label><input class="finput" id="sync-token" type="password" value="'+esc(c.token)+'" autocomplete="off" spellcheck="false" placeholder="github_pat_… / ghp_…"></div>'
      + '<button class="sheetbtn" id="sync-save">保存して同期</button>'
      + '<button class="sheetbtn ghost" id="sync-pull">今すぐ同期</button>'
      + '<button class="sheetbtn ghost" id="sync-clear">トークンを削除（この端末）</button>'
      + '<div class="desc" id="sync-msg" style="margin-top:8px"></div>'
      + '</div>');
    const msg=(t)=>{ const m=document.getElementById("sync-msg"); if(m) m.textContent=t; };
    document.getElementById("sync-save").addEventListener("click", async ()=>{
      lsSet(LS.owner, document.getElementById("sync-owner").value.trim());
      lsSet(LS.repo,  document.getElementById("sync-repo").value.trim());
      lsSet(LS.path,  document.getElementById("sync-path").value.trim()||"data.json");
      const tok=document.getElementById("sync-token").value.trim();
      if(tok) lsSet(LS.token, tok);
      lsDel(LS.sha); syncedBase=null;                            // 設定変更 → 基準リセット & フル取得
      msg("同期中…"); await pull();
      msg(STATUS==="synced" ? "同期しました ✓"
        : STATUS==="noauth" ? "認証に失敗しました。ユーザー名 / リポジトリ名 / トークンを確認してください。"
        : "接続できませんでした。ネットワークを確認してください。");
    });
    document.getElementById("sync-pull").addEventListener("click", async ()=>{ msg("同期中…"); await pull(); msg(STATUS==="synced"?"同期しました ✓":"同期できませんでした。"); });
    document.getElementById("sync-clear").addEventListener("click", ()=>{ lsDel(LS.token); const t=document.getElementById("sync-token"); if(t) t.value=""; setStatus("noauth"); msg("この端末からトークンを削除しました。"); });
  }
  const _btn=document.getElementById("btn-settings");
  if(_btn) _btn.addEventListener("click", ()=>{ requestAnimationFrame(()=>{ if(document.getElementById("s-save")) injectSyncUI(); }); });

  /* ---- フォーカス/可視化/復線でプル（相手の更新を取り込む・スロットル） ---- */
  function maybePull(){ if(!configured()) return; if(Date.now()-lastPullAt < 4000) return; pull(); }
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") maybePull(); });
  window.addEventListener("focus", maybePull);
  window.addEventListener("online", ()=>{ if(configured()) pull(); });

  /* ---- 起動時に一度プル（初期描画の後） ---- */
  setTimeout(()=>{ if(configured()) pull(); else setStatus("idle"); }, 0);

  /* ---- デバッグ用ハンドル ---- */
  window.WeSync = { pull, push:pushNow, cfg, status:()=>STATUS };
})();
