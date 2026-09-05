"use strict";
/* ============================================================================
   We 家計簿 — GitHub 同期レイヤー (sync.js)
   方針: ローカル優先 + 非同期同期。既存の load()/save() は同期のまま、
        ここで「もう一枚 save を包む」+ プル/プッシュを足すだけ。
        storage.js / compute.js / main.js は一切変更しない。
        トークンとリポジトリ情報は localStorage のみに保存（コードには入れない）。

   [2026-09-01 改修 / BUG-20260901-09/-10/-11]
   1) 同期基準(syncedBase)を localStorage に永続化
      — 再起動後もオフライン編集が 3-way マージで残る(-09)。
   2) 画面が隠れる瞬間に keepalive で即プッシュ(-10)。
   3) entries は「1件ずつ」の 3-way マージ。二人が同じ月に別々に記帳しても
      両方残る(-11)。start は startConfirmed(確定)側が時刻に関係なく優先。
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

/* entries の 3-way マージ(id 単位)。
   - 片側だけが触った id → その側に従う(追加/編集/削除)
   - 両側が同じ変更 → そのまま
   - 両側が別々に変更 → db 全体の時刻が新しい方
   出力は (date, id) 順に整列(決定的・両端末で同じ並びに収束)。 */
function _mergeEntries(b, l, r, localNewer){
  b=b||[]; l=l||[]; r=r||[];
  const S=o=>JSON.stringify(o===undefined?null:o);
  const bm=new Map(b.map(e=>[e.id,e])), lm=new Map(l.map(e=>[e.id,e])), rm=new Map(r.map(e=>[e.id,e]));
  const ids=new Set();
  bm.forEach((_,k)=>ids.add(k)); lm.forEach((_,k)=>ids.add(k)); rm.forEach((_,k)=>ids.add(k));
  const out=[];
  ids.forEach(id=>{
    const be=bm.get(id), le=lm.get(id), re=rm.get(id);
    let win;
    if(S(le)===S(be))      win=re;                 // ローカル未変更 → リモートに従う
    else if(S(re)===S(be)) win=le;                 // リモート未変更 → ローカルに従う
    else if(S(le)===S(re)) win=le;                 // 同じ変更
    else                   win=localNewer?le:re;   // 真の衝突 → 時刻
    if(win!=null) out.push(_clone(win));
  });
  out.sort((a,c)=>{ const ad=a.date||"", cd=c.date||"";
    if(ad!==cd) return ad<cd?-1:1; return (a.id||"")<(c.id||"")?-1:((a.id||"")>(c.id||"")?1:0); });
  return out;
}

/* 同じ月を両側が変更した時の月内マージ。
   - entries: 1件ずつ 3-way(上)
   - start: startConfirmed(精算で確定)が片側だけ → 時刻に関係なくその側
   - categories: 時刻勝者のリスト + マージ後の entries が使っている分類を補完
   - その他のフィールド: 時刻勝者 */
function _mergeMonth(b, l, r, localNewer){
  const wf = localNewer ? l : r;
  const out = _clone(wf);
  out.entries = _mergeEntries(b && b.entries, l.entries, r.entries, localNewer);
  const lc=!!l.startConfirmed, rc=!!r.startConfirmed;
  if(lc!==rc){ const w=lc?l:r; out.start=w.start; out.startConfirmed=true; }
  const cats=(wf.categories||[]).slice();
  out.entries.forEach(e=>{ if(e.category && cats.indexOf(e.category)<0) cats.push(e.category); });
  out.categories=cats;
  return out;
}

/* 3-way マージ:
   - 別々の月を編集 → 両方とも残る（衝突しない）
   - 同じ月を両側が編集 → 月内マージ(_mergeMonth)。entries は両方残る
   - 月の削除 vs 編集 → 時刻で決定(従来どおり)
   base: 前回同期時点（共通祖先）。初回 null は remote 採用 + ローカル限定の月を温存。 */
function _mergeDb(base, local, remote){
  const out = _clone(remote);
  if(!base){
    out.months = _clone(remote.months);
    for(const k in local.months) if(!(k in remote.months)) out.months[k] = _clone(local.months[k]);
    out.settings = _clone(remote.settings);   // 初回同期: settings は必ず remote を採用（ローカルは種子で非権威）
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
    else if(ls===rs) win = l;                  // 同じ変更(並び替えを避けそのまま)
    else if(l && r)  win = _mergeMonth(b, l, r, localNewer);  // 両方変更 → 月内マージ
    else             win = localNewer ? l : r; // 削除 vs 編集 → 時刻で決定
    if(win!==undefined && win!==null) out.months[k] = _clone(win);
  }
  out.settings = _clone(localNewer ? local.settings : remote.settings);
  out.lastModified = Math.max(local.lastModified||0, remote.lastModified||0);
  return out;
}

/* node からはコアだけ require 可能（テスト用） */
if (typeof module !== "undefined" && module.exports){
  module.exports = { _clone, _eq, _b64encode, _b64decode, _mergeDb, _mergeEntries, _mergeMonth };
}

/* ============================ ブラウザでのみ実行 ============================ */
if (typeof document !== "undefined") (function(){
  const LS = { token:"we_kakeibo_gh_token", owner:"we_kakeibo_gh_owner",
               repo:"we_kakeibo_gh_repo", path:"we_kakeibo_gh_path", sha:"we_kakeibo_gh_sha",
               draftSha:"we_kakeibo_gh_draft_sha", base:"we_kakeibo_sync_base" };
  const ls    = (k)=>{ try{ return localStorage.getItem(k)||""; }catch(_){ return ""; } };
  const lsSet = (k,v)=>{ try{ localStorage.setItem(k,v); }catch(_){ } };
  const lsDel = (k)=>{ try{ localStorage.removeItem(k); }catch(_){ } };

  function cfg(){ return { token:ls(LS.token), owner:ls(LS.owner), repo:ls(LS.repo), path:ls(LS.path)||"data.json" }; }
  function configured(){ const c=cfg(); return !!(c.token && c.owner && c.repo); }

  /* 前回同期時点（共通祖先）。localStorage に永続化 — 再起動してもオフライン編集が消えない */
  function _loadBase(){ try{ const s=localStorage.getItem(LS.base); return s?JSON.parse(s):null; }catch(_){ return null; } }
  function _setBase(v){
    syncedBase = v ? _clone(v) : null;
    try{ if(v) localStorage.setItem(LS.base, JSON.stringify(v)); else localStorage.removeItem(LS.base); }catch(_){ }
  }
  let syncedBase = _loadBase();
  let pulling=false, pushTimer=null, lastPullAt=0, pushPending=false;
  let STATUS="idle";                // idle|syncing|synced|offline|noauth
  function _delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

  /* ローカルだけに書く（プッシュも lastModified も触らない）。storage.js の KEY/MEM を流用 */
  function rawLocalSave(){
    try{ localStorage.setItem(KEY, JSON.stringify(db)); }
    catch(_){ try{ MEM = JSON.parse(JSON.stringify(db)); }catch(__){} }
  }

  /* ---- GitHub contents API ---- */
  function apiUrlFor(p){ const c=cfg(); return "https://api.github.com/repos/"+c.owner+"/"+c.repo+"/contents/"+p.split("/").map(encodeURIComponent).join("/"); }
  function apiUrl(){ return apiUrlFor(cfg().path); }
  function draftFile(){ const p=cfg().path||"data.json"; return p.replace(/[^\/]*$/,"")+"draft.json"; }
  function headers(){ const c=cfg(); return { "Authorization":"Bearer "+c.token, "Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" }; }
  async function ghGet(){
    const res = await fetch(apiUrl(), { headers:headers(), cache:"no-store" });
    if(res.status===404) return { exists:false };
    if(res.status===401 || res.status===403){ const e=new Error("auth"); e.code="auth"; throw e; }
    if(!res.ok) throw new Error("GET "+res.status);
    const j = await res.json();
    return { exists:true, sha:j.sha, data: JSON.parse(_b64decode(j.content)) };
  }
  async function ghPut(obj, sha, keepalive){
    const body = { message:"We家計簿 更新 "+new Date().toISOString(), content:_b64encode(JSON.stringify(obj,null,2)) };
    if(sha) body.sha = sha;
    const opt = { method:"PUT", headers:Object.assign({"Content-Type":"application/json"}, headers()), body:JSON.stringify(body) };
    if(keepalive) opt.keepalive = true;
    const res = await fetch(apiUrl(), opt);
    if(res.status===409) return { conflict:true };
    if(res.status===401 || res.status===403){ const e=new Error("auth"); e.code="auth"; throw e; }
    if(!res.ok) throw new Error("PUT "+res.status);
    const j = await res.json();
    return { sha: j.content && j.content.sha };
  }

  /* ---- プル（取得 → マージ → 繰越の追従 → ローカル反映 → 必要ならプッシュ予約） ---- */
  async function pull(){
    if(!configured()){ setStatus("noauth"); return; }
    if(pulling) return;
    pulling=true; lastPullAt=Date.now(); setStatus("syncing");
    try{
      const r = await ghGet();
      if(!r.exists){                              // リモートに未作成 → 今のローカルを初期アップ
        const p = await ghPut(db, null);
        if(p.conflict){ pulling=false; return pull(); }
        lsSet(LS.sha, p.sha||""); _setBase(db); pushPending=false; setStatus("synced"); return;
      }
      lsSet(LS.sha, r.sha);
      const localBefore = db;
      const merged = _mergeDb(syncedBase, db, r.data);
      db = merged;
      /* 未確定の繰越金をマージ後の残高に追従(ui.js 提供・決定的なので両端末で収束) */
      if(window._refreshCarry){ try{ window._refreshCarry(); }catch(_){ } }
      const sameLocal  = _eq(db, localBefore);
      const sameRemote = _eq(db, r.data);
      if(!db.months[active]) active = (typeof _latestUpToToday==="function") ? _latestUpToToday() : Object.keys(db.months).sort().pop();
      rawLocalSave();
      if(!sameLocal && typeof render==="function") render();
      /* 基準 = いま取り込んだリモート(共通祖先)。プッシュの成否に関わらずここで確定させる。
         こうしておけば、直後にオフラインになって push が届かなくても、次回の 3-way で
         「ローカルだけの変更」として正しく残る(初回同期直後の隙間を塞ぐ)。 */
      _setBase(r.data);
      if(sameRemote){ pushPending=false; setStatus("synced"); }
      else { schedulePush(); }                    // ローカルにしか無い変更 → 上げる
    }catch(e){
      setStatus(e && e.code==="auth" ? "noauth" : "offline");
    }finally{ pulling=false; }
  }

  /* ---- プッシュ（デバウンス） ---- */
  function schedulePush(){ if(!configured()) return; pushPending=true; clearTimeout(pushTimer); pushTimer=setTimeout(pushNow, 1500); }
  async function pushNow(){
    if(!configured()){ setStatus("noauth"); return; }
    setStatus("syncing");
    try{
      const snap=_clone(db);
      const r = await ghPut(snap, ls(LS.sha)||null);
      if(r.conflict){ await pull(); return; }      // 誰かが先に上げた → プルしてマージ（必要なら再プッシュ）
      lsSet(LS.sha, r.sha||""); _setBase(snap);
      if(_eq(snap, db)) pushPending=false;         // 送信中にさらに編集されていたら pending 継続
      setStatus("synced");
    }catch(e){
      setStatus(e && e.code==="auth" ? "noauth" : "offline");   // 次の保存/フォーカスで再試行
    }
  }
  /* 画面が隠れる瞬間: 1.5 秒待たず keepalive で即送る(BUG-20260901-10)。
     失敗しても永続化した基準があるので次回起動の 3-way で必ず復元できる。 */
  function flushPushNow(){
    if(!configured() || !pushPending) return;
    clearTimeout(pushTimer); pushTimer=null;
    const snap=_clone(db);
    ghPut(snap, ls(LS.sha)||null, true).then(r=>{
      if(r && r.sha){ lsSet(LS.sha, r.sha); _setBase(snap); if(_eq(snap,db)) pushPending=false; setStatus("synced"); }
    }).catch(()=>{});
  }

  /* ---- save をもう一枚包む: ローカル保存（既存）+ プッシュ予約 ---- */
  const _saveLocal = save;
  save = function(){ const out=_saveLocal.apply(this, arguments); if(configured()) schedulePush(); return out; };

  /* ---- 状態バッジ: updateLastmod を包んで「最終更新…」の後ろに付ける ---- */
  const _updateLastmod = (typeof updateLastmod==="function") ? updateLastmod : null;
  /* v11: オフラインは「圏外です」より先に「データは無事」と言う。不安を消すのが本体 */
  function statusText(){ return ({syncing:"同期中…", synced:"同期済",
    offline:"オフライン · 端末に保存済み", noauth:"同期できません"}[STATUS]) || ""; }
  if(_updateLastmod){
    updateLastmod = function(){
      _updateLastmod.apply(this, arguments);
      const el=document.getElementById("lastmod"); if(!el || !configured()) return;
      /* v11: 色は styles.css の token に任せる（ここに hex を書かない） */
      el.className = "lastmod st-" + STATUS;
      const sep = el.innerHTML ? " · " : '<span class="dot"></span>';
      el.innerHTML += sep + '<span class="stx">' + statusText() + '</span>';
    };
  }
  function setStatus(s){ STATUS=s; if(typeof updateLastmod==="function") updateLastmod(); }

  /* ---- 設定ページに「同期設定」を注入（2枚目のクリックリスナ） ---- */
  function injectSyncUI(){
    const host=document.getElementById("ed-body")||document.getElementById("sheet"); if(!host) return;
    if(document.getElementById("sync-save")) return;             // 二重注入防止
    const c=cfg();
    const esc=(s)=>String(s).replace(/"/g,"&quot;");
    host.insertAdjacentHTML("beforeend",
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
      lsDel(LS.sha); _setBase(null);                             // 設定変更 → 基準リセット & フル取得
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

  /* ---- 目覚めイベント: 月替わりチェック → プル（相手の更新を取り込む・スロットル） ---- */
  function editingOpen(){ return (typeof _sheetOpen!=="undefined" && _sheetOpen) || (typeof _hesanOpen!=="undefined" && _hesanOpen) || (typeof _dlgOpen!=="undefined" && _dlgOpen); }
  function maybePull(){ if(!configured()) return; if(editingOpen()) return; if(Date.now()-lastPullAt < 4000) return; pull(); }
  function wake(){
    if(window._ensureToday){ try{ window._ensureToday(); }catch(_){ } }   // 月替わり・ロック状態の再判定(ui.js)
    maybePull();
  }
  document.addEventListener("visibilitychange", ()=>{
    if(document.visibilityState==="hidden") flushPushNow();
    else wake();
  });
  window.addEventListener("focus", wake);
  window.addEventListener("online", ()=>{ if(window._ensureToday){ try{ window._ensureToday(); }catch(_){ } } if(configured() && !editingOpen()) pull(); });
  window.addEventListener("pagehide", flushPushNow);
  window._syncResume = maybePull;                      // ページ/精算を閉じた時に ui.js が呼ぶ

  /* ---- 起動時に一度プル(8秒で見切り) → その後 ui.js の月替わり処理へ ---- */
  setTimeout(async ()=>{
    if(configured()){ try{ await Promise.race([pull(), _delay(8000)]); }catch(_){ } }
    else setStatus("idle");
    if(window._afterFirstSync){ try{ window._afterFirstSync(); }catch(_){ } }
  }, 0);

  /* ---- リモート覗き見(精算「設定」前の確認用・マージしない) ---- */
  window._peekRemote = async function(timeoutMs){
    if(!configured()) return { ok:false };
    try{
      const r = await Promise.race([ghGet(), _delay(timeoutMs||4000).then(()=>null)]);
      if(!r) return { ok:false };
      if(!r.exists) return { ok:true, data:null };
      return { ok:true, data:r.data };
    }catch(_){ return { ok:false }; }
  };

  /* ---- 下書き draft.json(記帳データと別ファイル・1 枠のみ・全置換) ---- */
  async function ghGetDraft(){
    const res = await fetch(apiUrlFor(draftFile()), { headers:headers(), cache:"no-store" });
    if(res.status===404) return { exists:false };
    if(res.status===401 || res.status===403){ const e=new Error("auth"); e.code="auth"; throw e; }
    if(!res.ok) throw new Error("GET draft "+res.status);
    const j = await res.json();
    return { exists:true, sha:j.sha, data: JSON.parse(_b64decode(j.content)) };
  }
  async function ghPutDraft(obj, sha){
    const body = { message:"We家計簿 下書き "+new Date().toISOString(), content:_b64encode(JSON.stringify(obj,null,2)) };
    if(sha) body.sha = sha;
    const res = await fetch(apiUrlFor(draftFile()), { method:"PUT", headers:Object.assign({"Content-Type":"application/json"}, headers()), body:JSON.stringify(body) });
    if(res.status===409) return { conflict:true };
    if(res.status===401 || res.status===403){ const e=new Error("auth"); e.code="auth"; throw e; }
    if(!res.ok) throw new Error("PUT draft "+res.status);
    const j = await res.json();
    return { sha: j.content && j.content.sha };
  }
  window._draftSync = {
    /* 取得: {ok, draft|null}。404 = 下書きなし。失敗は ok:false(ローカル維持) */
    pull: async function(){
      if(!configured()) return { ok:false };
      try{
        const r = await ghGetDraft();
        if(!r.exists) return { ok:true, draft:null };
        lsSet(LS.draftSha, r.sha);
        return { ok:true, draft:r.data };
      }catch(e){ return { ok:false }; }
    },
    /* 取得(4秒で見切り): 閉じる前の衝突確認用 */
    pullQuick: async function(timeoutMs){
      if(!configured()) return { ok:false };
      try{
        const r = await Promise.race([ghGetDraft(), _delay(timeoutMs||4000).then(()=>null)]);
        if(!r) return { ok:false };
        if(!r.exists) return { ok:true, draft:null };
        lsSet(LS.draftSha, r.sha);
        return { ok:true, draft:r.data };
      }catch(e){ return { ok:false }; }
    },
    /* 保存: draft(null = 削除の印)。sha 競合は取り直して 1 回だけ再試行 */
    push: async function(draft){
      if(!configured()) return false;
      const obj = draft || { month:null, rows:[], yeonZan:"", initAmount:"", savedAt:Date.now() };
      try{
        let r = await ghPutDraft(obj, ls(LS.draftSha)||null);
        if(r.conflict){
          const g = await ghGetDraft().catch(()=>null);
          r = await ghPutDraft(obj, (g && g.sha) || null);
          if(r.conflict) return false;
        }
        lsSet(LS.draftSha, r.sha||"");
        return true;
      }catch(e){ return false; }
    }
  };

  /* ---- デバッグ用ハンドル ---- */
  window.WeSync = { pull, push:pushNow, cfg, status:()=>STATUS };
})();
