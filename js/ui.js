"use strict";
/* ============================================================
   ui.js — presentation + interaction (redesign)
   Logic identical to the verified single-file version; only the
   markup styling and a native (zero-dependency) motion layer change.
   Pure compute/data/storage live in their own files, untouched.

   [2026-09-01 改修] 対応番号は HANDBOOK §13.10 / §14 を参照。
   - 月の生命周期: 今日の月は自動作成・仮/確定の繰越金・「›」は翌月まで
     (BUG-20260901-01/-04/-05/-06, REV-20260901-05)
   - 入力: 半角数字以外は保存せず警告・毎回の書き込みに回執トースト
     (BUG-20260901-02/-03/-08/-15/-16/-17)
   - 固定費: 引き落とし総額のみ入力でも合計に含める(-07)
   - 編集は全画面ページ(開いている間は下の画面を固定・戻るは左上ボタン)(REV-01/-06)
   - 精算下書きの衝突確認・設定後の下書き削除・月違いガード(-12/-13/-14)
   - 分類の統合(REV-02)・東京時間で扱い境外は記帳時に確認(REV-03改)・現金未使用の表示(REV-04)
   [2026-09-02 追加] 1〜9日は「入金前」表示(REV-07a)・既定値変更の適用ダイアログ(REV-07c)・
   過去月の節奏条(REV-07b)・上部胶囊/下部二拍タブ(REV-07d/e)
   storage.js / compute.js / main.js(凍結)は不変。関数の差し替えは
   save / fixedTotal の 2 つだけ(どちらも「包む」だけで元は呼ぶ)。
   ============================================================ */

/* ---------------- last-modified time + save hook ---------------- */
// Stamp the data's last-modified time on every save — done here so storage.js stays byte-identical.
// 同時に「仮」の繰越金を前月残高へ追従させる(_refreshCarry: 今月・来月のみ)。
const _origSave = save;
save = function(){ db.lastModified = Date.now(); try{ _refreshCarry(); }catch(e){} return _origSave.apply(this, arguments); };
function relTime(ts){
  const diff = Date.now() - ts;
  if(diff < 60000) return "たった今";
  if(diff < 86400000){
    const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000);
    return h < 1 ? m + "分前" : h + "時間" + m + "分前";
  }
  const d = Math.floor(diff/86400000), h = Math.floor((diff%86400000)/3600000);
  return d + "日" + h + "時間前";
}
function updateLastmod(){
  const el = document.getElementById("lastmod"); if(!el) return;
  el.className = "lastmod";                       // 同期状態のクラスは sync.js が付け直す
  if(!db.lastModified){ el.innerHTML = ""; return; }
  el.innerHTML = '<span class="dot"></span>最終更新 ' + relTime(db.lastModified);
}

/* ---------------- fixedTotal を包む (BUG-20260901-07) ----------------
   「引き落とし総額」だけ入力して「電気」が未入力のとき、compute.js の
   fixedTotal は総額を分解できず賃料+管理費しか数えない(総額が消える)。
   ここでは総額をそのまま数える。両方入力済みなら従来の計算(同値)。 */
const _fixedTotalBase = fixedTotal;
fixedTotal = function(key){
  const mo=db.months[key], f=mo&&mo.fixed;
  if(f && f.totalDebit!=null && f.denki==null){
    let t=f.totalDebit+(f.gas||0)+(f.water||0); (f.extra||[]).forEach(x=>t+=(x.amount||0)); return t;
  }
  return _fixedTotalBase(key);
};

/* HTML エスケープ(分類名・人名・その他固定費名を属性/本文に埋める時) (BUG-20260901-16) */
function esc(v){ return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

/* ============================================================
   navigation guards / launch month / jump-to-current
   - 起動: 「今日を超えない最新の月」を開く → 初回同期後に ensureToday が今月を作って移動
   - 「‹」: 最も古い実データ月で停止(誤タップ防止)
   - 「›」: 翌月までは確認して作成、それより先は作成不可(REV-20260901-05)
   - 月ラベルのタップ: 当月へ戻る
   いずれも本ファイル(ui.js)内のみ。storage/compute/main(凍結)は不変。
   ============================================================ */
/* 「今日」は常に東京時間(端末がどこにあっても同じ月・同じ日付で扱う) */
const PAYDAY=10;   // 給料日(節奏条・1〜9日の「入金前」表示が参照)
function _tokyoParts(){
  try{
    const f=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
    const o={}; f.formatToParts(new Date()).forEach(x=>{ if(x.type!=="literal") o[x.type]=x.value; });
    return {y:+o.year, m:+o.month, d:+o.day, h:(+o.hour)%24, mi:+o.minute};
  }catch(e){ const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()+1, d:d.getDate(), h:d.getHours(), mi:d.getMinutes()}; }
}
function _nowYM(){ const t=_tokyoParts(); return t.y+"-"+String(t.m).padStart(2,"0"); }
function _todayD(){ return _tokyoParts().d; }
function _todayStr(){ const t=_tokyoParts(); return t.y+"-"+String(t.m).padStart(2,"0")+"-"+String(t.d).padStart(2,"0"); }
function _tokyoClock(){ const t=_tokyoParts(); return t.m+"/"+t.d+" "+String(t.h).padStart(2,"0")+":"+String(t.mi).padStart(2,"0"); }
function _localClock(){ const d=new Date(); return (d.getMonth()+1)+"/"+d.getDate()+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function _isPrePayday(k){ return k===_nowYM() && _todayD()<PAYDAY; }
function _isEmptyMonth(m){
  return !!m && (!m.entries || !m.entries.length)
    && (!m.categoryTotals || !Object.keys(m.categoryTotals).length)
    && (!m.fixed || !m.fixed.extra || !m.fixed.extra.length)
    && !!m.fixed && m.fixed.denki==null && m.fixed.gas==null && m.fixed.water==null && m.fixed.totalDebit==null
    && !m.hesan;
}
function _earliestRealKey(){
  const keys=Object.keys(db.months).sort();
  for(const k of keys){ if(!_isEmptyMonth(db.months[k])) return k; }
  return keys[0]||null;
}
function _latestUpToToday(){
  const now=_nowYM(); if(db.months[now]) return now;
  const keys=Object.keys(db.months).sort();
  let pick=null; for(const k of keys){ if(k<=now) pick=k; }
  return pick || keys[0] || now;
}
/* 起動時に active を「今日を超えない最新の月」に固定(main.js の render より前に実行) */
active=_latestUpToToday();

/* ============================================================
   東京の外にいる時 (REV-20260901-03 → 2026-09-02 改)
   端末の時計のタイムゾーンが Asia/Tokyo でなければ、上部に知らせ、
   記録の追加・編集の時だけ「東京の日付で記録しますか?」と確認する。
   日付を持たない編集(固定費・入金・精算・設定)は確認しない。
   (判定は時計設定であり GPS ではない。iPhone「日付と時刻」自動なら現地で変わる)
   ============================================================ */
function _zoneName(){ try{ return (Intl.DateTimeFormat().resolvedOptions().timeZone)||""; }catch(e){ return ""; } }
function _zoneAwayNow(){ const z=_zoneName(); if(z) return z!=="Asia/Tokyo"; return new Date().getTimezoneOffset()!==-540; }
let _zoneAway=_zoneAwayNow();
function _renderZoneBar(){
  let bar=document.getElementById("zonebar");
  if(!_zoneAway){ if(bar) bar.remove(); return; }
  if(!bar){
    bar=document.createElement("div"); bar.id="zonebar"; bar.className="zonebar";
    const nav=document.querySelector(".month");
    if(nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling); else document.body.prepend(bar);
  }
  bar.innerHTML='<span class="zl">🌏</span><div><b>今のエリアは東京ではありません。</b>日付は東京時間（'+_tokyoClock()+'）で扱います。</div>';
}
/* 記録を書く直前: 東京の外なら確認。Promise<boolean> */
async function _confirmAwayEntry(date){
  if(!_zoneAway) return true;
  return _confirmDialog("今いる場所は <b>"+_localClock()+"</b>、東京は <b>"+_tokyoClock()+"</b> です。<br>この記録を日付 <b>"+_md(date)+"</b>（東京時間）で記録しますか？","この日付で記録","やめる");
}

/* ============================================================
   月の生命周期 (BUG-20260901-01/-04/-05)
   - ensureToday(): 今日の月が無ければ作る(唯一の自動作成)。月替わりなら今月へ移動。
     呼び元: 初回同期後 / 画面復帰 / online / 30秒ごと。
   - 繰越金の状態: startConfirmed が無い = 仮(自動)。仮の間は前月残高に追従し、
     精算「設定」または入金編集で手を入れた時に確定(以後は人以外触らない)。
     追従・表示の対象は「今月」と「来月」だけ。過去の月には一切触れない。
   ============================================================ */
let _seenYM=_nowYM(), _userNav=false;
function _carryTargets(){ const now=_nowYM(); return [now, shiftMonth(now,1)]; }
function _isCarryMonth(k){ return _carryTargets().indexOf(k)>=0; }
function _isKari(k){ const m=db.months[k]; return !!m && !m.startConfirmed && _isCarryMonth(k); }
function _refreshCarry(){
  let changed=false;
  _carryTargets().forEach(k=>{
    const m=db.months[k]; if(!m || m.startConfirmed) return;
    const p=shiftMonth(k,-1); if(!db.months[p]) return;
    const v=Math.round(balance(p));
    if(m.start!==v){ m.start=v; changed=true; }
  });
  return changed;
}
function ensureToday(opts){
  _zoneAway=_zoneAwayNow(); _renderZoneBar();
  const now=_nowYM(); const rolled=(now!==_seenYM); _seenYM=now;
  let created=false;
  if(!db.months[now]){ ensureMonth(now); created=true; }    // ensureMonth → save → 追従
  const startup=!!(opts && opts.startup);
  let need=false;
  if(_refreshCarry()){ save(); need=true; }
  const jump = rolled || created || (startup && !_userNav);
  if(jump && active!==now){
    active=now; need=true;
    const mm=Number(now.split("-")[1]);
    setTimeout(()=>_flashMonthLabel(mm+"月になりました"), 60);
  }
  if(need && typeof render==="function") render();
}
window._ensureToday=ensureToday;
window._refreshCarry=_refreshCarry;
window._afterFirstSync=function(){ ensureToday({startup:true}); };

/* 月ナビの境界: .mnav にキャプチャ段で割り込み、main.js のボタン処理より先に判定 */
(function bindMonthNavGuards(){
  const mnav=document.querySelector(".mnav"); if(!mnav) return;
  mnav.addEventListener("click", function(e){
    _userNav=true;
    if(e.target.closest("#prev")){
      const target=shiftMonth(active,-1), floor=_earliestRealKey();
      if(floor && target<floor && !db.months[target]){
        e.stopPropagation(); e.preventDefault();
        _flashMonthLabel("これより前の記録はありません");
      }
    } else if(e.target.closest("#next")){
      const target=shiftMonth(active,1), now=_nowYM();
      if(!db.months[target]){
        if(target>now){
          e.stopPropagation(); e.preventDefault();
          if(target===shiftMonth(now,1)) _confirmCreateFuture(target);
          else _flashMonthLabel("翌月までしか作成できません");
        }
      }
    }
  }, true);
}());

/* 翌月の新規作成: 小さな確認ダイアログ */
function _confirmCreateFuture(target){
  openDialog('<h2>まだ来ていない月です</h2>'
    +'<div class="desc">'+labelOf(target)+' はまだ始まっていません。新しい月を作成して移動しますか?</div>'
    +'<button class="sheetbtn" id="cf-yes">作成して移動</button>'
    +'<button class="sheetbtn ghost" id="cf-no">やめる</button>');
  document.getElementById("cf-yes").addEventListener("click", function(){ closeDialog(true); active=target; ensureMonth(active); render(); });
  document.getElementById("cf-no").addEventListener("click", function(){ closeDialog(); });
}

/* 月ラベルのタップで当月へ戻る */
(function bindJumpToCurrent(){
  const lab=document.getElementById("monthlabel"); if(!lab) return;
  lab.style.cursor="pointer"; lab.title="今月へ";
  lab.addEventListener("click", function(){ _userNav=true; const t=_latestUpToToday(); if(t && t!==active){ active=t; render(); } });
}());

/* 旧仕様の下書き(mo.hesan)を見つけ次第すべて削除する。
   新仕様では下書きは draft.json / localStorage のみで、記帳データには置かない。
   pull で古い hesan が戻ってきても、次の描画で再び剥がして押し返す(両端末が更新後に収束)。 */
function _stripHesan(){ let n=0;
  for(const k in db.months){ const m=db.months[k];
    if(m && Object.prototype.hasOwnProperty.call(m,"hesan")){ delete m.hesan; n++; } }
  return n; }

/* 境界に当たったときの月ラベル軽量ヒント(オーバーレイなし・自動で戻る) */
let _flashTimer=null;
function _flashMonthLabel(text){
  const lab=document.getElementById("monthlabel"); if(!lab) return;
  lab.textContent=text; lab.style.opacity="0.55";
  clearTimeout(_flashTimer);
  _flashTimer=setTimeout(function(){ lab.style.opacity=""; if(typeof renderHeader==="function") renderHeader(); }, 1400);
}

/* ---------------- motion ---------------- */
const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches);

/* ============================================================
   フルページ編集 (REV-20260901-01 / REV-20260902-06)
   openSheet(html)/closeSheet() の名前と引数はそのまま(各編集器は無変更で
   呼べる)。中身は全画面ページ。h2 は上部タイトルへ、最初の主ボタン
   (.sheetbtn / ghost・danger 以外)は下部の固定フッターへ移す。
   ページ・精算・ダイアログが開いている間は下の画面(body)を固定する
   (_lockBody): iOS でスクロールが下の画面へ抜けて「疑似全画面」になるのを
   止める。戻るは左上ボタンのみ(端スワイプ・キーボード追従は 09-02 に撤去)。
   ============================================================ */
let _sheetOpen = false, _onSheetClose = null, _edEl = null;
/* 下の画面を固定(入れ子で開いても数を数えて最後に解除・元のスクロール位置へ戻す) */
let _lockN=0, _lockY=0;
function _lockBody(){
  if(_lockN++ > 0) return;
  _lockY = window.scrollY || window.pageYOffset || 0;
  const b=document.body;
  b.style.position="fixed"; b.style.top=(-_lockY)+"px"; b.style.left="0"; b.style.right="0"; b.style.width="100%";
  document.documentElement.classList.add("pglock");
}
function _unlockBody(){
  if(_lockN>0) _lockN--; if(_lockN>0) return;
  const b=document.body;
  b.style.position=""; b.style.top=""; b.style.left=""; b.style.right=""; b.style.width="";
  document.documentElement.classList.remove("pglock");
  window.scrollTo(0,_lockY);
}
/* ページの出入りは CSS の淡入淡出(.on / .out)。動きを減らす設定や WAAPI の無い環境では即時。 */
function _pageIn(el){
  el.classList.remove("out");
  if(REDUCED || !el.animate){ el.classList.add("on"); return; }
  void el.offsetWidth;                     // 初期状態(透明・少し縮小)を確定させてから
  el.classList.add("on");
}
function _pageOut(el, done){
  if(REDUCED || !el.animate){ done(); return; }
  let fired=false; const fin=()=>{ if(fired) return; fired=true; el.removeEventListener("transitionend", fin); done(); };
  el.classList.remove("on"); el.classList.add("out");
  el.addEventListener("transitionend", fin);
  setTimeout(fin, 420);
}
function _fillPage(el, title, body){
  el.innerHTML =
    '<div class="hp-top"><button class="iconbtn" id="ed-back" aria-label="戻る"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>'
    + '<div class="hp-title">'+title+'</div></div>'
    + '<div class="hp-scroll sheet" id="ed-body">'+body+'</div>'
    + '<div class="ed-foot" id="ed-foot"></div>';
  const bodyEl=el.querySelector("#ed-body"), foot=el.querySelector("#ed-foot");
  const prim=Array.from(bodyEl.querySelectorAll(".sheetbtn")).find(b=>!b.classList.contains("ghost") && !b.classList.contains("danger"));
  if(prim) foot.appendChild(prim); else foot.remove();
  el.querySelector("#ed-back").addEventListener("click", ()=>closeSheet());
  bodyEl.scrollTop=0;
}
function openSheet(html){
  const m = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const title = m ? m[1] : "";
  const body  = m ? html.replace(m[0], "") : html;
  if(_sheetOpen && _edEl){ _fillPage(_edEl, title, body); return; }   // already open: swap, no re-animate
  _edEl=document.createElement("div"); _edEl.className="edpage"; document.body.appendChild(_edEl);
  _fillPage(_edEl, title, body);
  _sheetOpen=true;
  _lockBody();
  _pageIn(_edEl);
}
function closeSheet(){
  if(!_sheetOpen) return; _sheetOpen = false;
  if(_onSheetClose){ const cb=_onSheetClose; _onSheetClose=null; try{ cb(); }catch(e){} }
  if(window._syncResume) setTimeout(window._syncResume, 400);
  const el=_edEl; _edEl=null; if(!el) return;
  _unlockBody();
  _pageOut(el, ()=>el.remove());
}

/* ---------------- 小さな確認ダイアログ(はい/いいえ 用・中央) ---------------- */
let _dlgOpen=false, _dlgEl=null;
function openDialog(html){
  if(_dlgOpen) closeDialog(true);
  document.querySelectorAll(".dlg-ov").forEach(x=>x.remove());   // 淡出中の古いダイアログは即撤去(id の重複を防ぐ)
  const ov=document.createElement("div"); ov.className="dlg-ov";
  ov.innerHTML='<div class="dlg sheet" role="dialog" aria-modal="true">'+html+'</div>';
  document.body.appendChild(ov); _dlgEl=ov; _dlgOpen=true;
  _lockBody();
  requestAnimationFrame(()=>ov.classList.add("on"));
  ov.addEventListener("click", e=>{ if(e.target===ov) closeDialog(); });
}
function closeDialog(silent){
  if(!_dlgOpen) return; _dlgOpen=false;
  const el=_dlgEl; _dlgEl=null;
  _unlockBody();
  if(el){ el.classList.remove("on"); el.style.pointerEvents="none"; setTimeout(()=>el.remove(), 440); }
  if(!silent && window._syncResume) setTimeout(window._syncResume, 400);
}
/* はい/いいえ を Promise で受け取る */
function _confirmDialog(text, yesLabel, noLabel, danger){
  return new Promise(res=>{
    openDialog('<div class="desc" style="margin-top:6px">'+text+'</div>'
      +'<button class="sheetbtn '+(danger?'danger':'')+'" id="cd-yes">'+esc(yesLabel||"はい")+'</button>'
      +'<button class="sheetbtn ghost" id="cd-no">'+esc(noLabel||"やめる")+'</button>');
    document.getElementById("cd-yes").addEventListener("click", ()=>{ closeDialog(true); res(true); });
    document.getElementById("cd-no").addEventListener("click", ()=>{ closeDialog(true); res(false); });
  });
}

/* ---------------- 回執トースト (BUG-20260901-03) ---------------- */
let _toastT=null;
function toast(msg, kind){
  let el=document.getElementById("toast");
  if(!el){ el=document.createElement("div"); el.id="toast"; document.body.appendChild(el); }
  el.className="toast"+(kind?" "+kind:"");
  el.textContent=msg;
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  clearTimeout(_toastT); _toastT=setTimeout(()=>el.classList.remove("on"), 2600);
}

/* ---------------- 金額入力の検査 (BUG-20260901-08) ----------------
   半角数字(と + - * / ( ) . )以外は受け付けず、その場で欄を赤くして理由を出す。
   保存はしない。空欄・0・マイナスの扱いは入口ごとに opt で指定。 */
const _RE_BAD=/[０-９，,¥￥]/;
function _checkAmount(raw, opt){
  opt=opt||{};
  const s=String(raw==null?"":raw).trim();
  if(!s) return opt.allowEmpty ? {ok:true,v:null} : {ok:false,msg:"金額を入力してください ✏️"};
  if(_RE_BAD.test(s)) return {ok:false,msg:"半角の数字で入力してください（例: 1200）。カンマ・全角・¥ は使えません ✏️"};
  const v=evalExpr(s);
  if(v==null) return {ok:false,msg:"計算できませんでした。数字か 5349+890 のような式で ✏️"};
  if(v===0 && opt.allowZero===false) return {ok:false,msg:"0 円は記録できません ✏️"};
  if(v<0 && opt.allowNegative===false) return {ok:false,msg:"マイナスの金額は記録できません ✏️"};
  return {ok:true,v:v};
}
function _fieldHost(inp){ return inp.closest(".field")||inp.closest(".qrow")||inp.closest(".amt-in")||inp; }
function _markBad(inp, msg){
  const host=_fieldHost(inp), wrap=inp.closest(".amt-in")||inp;
  inp.classList.add("bad"); wrap.classList.add("bad");
  let err=host.nextElementSibling;
  if(!err || !err.classList.contains("fielderr")){ err=document.createElement("div"); err.className="fielderr"; host.insertAdjacentElement("afterend", err); }
  err.textContent=msg;
  wrap.classList.remove("shake"); void wrap.offsetWidth; wrap.classList.add("shake");
  inp.addEventListener("input", ()=>_clearBad(inp), {once:true});
}
function _clearBad(inp){
  inp.classList.remove("bad"); const w=inp.closest(".amt-in"); if(w) w.classList.remove("bad");
  const host=_fieldHost(inp), err=host.nextElementSibling; if(err && err.classList.contains("fielderr")) err.remove();
}
/* id か要素を受け取り検査。NG なら欄に印を付けて {ok:false} */
function _readAmt(idOrEl, opt){
  const inp=(typeof idOrEl==="string")?document.getElementById(idOrEl):idOrEl;
  if(!inp) return {ok:true, v:null, el:null};
  const r=_checkAmount(inp.value, opt); r.el=inp;
  if(!r.ok) _markBad(inp, r.msg);
  return r;
}
function _focusFirstBad(){ const b=document.querySelector(".finput.bad, .amt-in.bad input, input.bad"); if(b && b.focus) try{ b.focus({preventScroll:false}); }catch(e){} }

/* ---------------- number roll ---------------- */
function rollNumber(el, from, to){
  if(REDUCED || from === to){ el.textContent = fmtN(to); return; }
  const dur = 520, t0 = performance.now();
  function step(t){
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtN(from + (to - from) * e);
    if(p < 1) requestAnimationFrame(step); else el.textContent = fmtN(to);
  }
  requestAnimationFrame(step);
}

/* 現金サブ台帳: 最後に動きがあった月の翌月から今日まで 1 ヶ月以上空いていればその開始月 (REV-20260901-04) */
function _cashUnusedSince(){
  const keys=monthsAsc(); let last=null, first=null;
  keys.forEach(k=>{ const m=db.months[k]; if(!m || !m.cash) return; if(!first) first=k; if((m.cash.deposit||0)>0 || cashSpent(k)>0) last=k; });
  if(!first) return null;
  const since=last?shiftMonth(last,1):first;
  return since<_nowYM() ? since : null;
}

/* ---------------- editors (logic verbatim + 入力検査 + 回執) ---------------- */
function _snapVal(raw, old){ const s=String(raw==null?"":raw).trim(); if(!s) return null; const v=evalExpr(s); return v==null?old:v; }
function editFixed(){
  const k0=active;                                  // 開いた月のキーだけ保持(オブジェクト参照は保持しない)
  const f=db.months[k0].fixed;                      // 表示用スナップショット
  let extraHtml=(f.extra||[]).map((x,i)=>`<div class="frow" style="align-items:flex-end;margin-bottom:14px"><div class="field" style="margin-bottom:0"><label>その他の名前</label><input class="finput" data-ex="name" data-i="${i}" value="${esc(x.name||"")}"></div><div class="field" style="margin-bottom:0"><label>金額</label><input class="finput num" data-ex="amount" data-i="${i}" inputmode="numeric" value="${x.amount!=null?x.amount:""}"></div><button class="del" data-rmex="${i}" style="margin-bottom:10px">×</button></div>`).join("");
  openSheet(`<h2>固定費の編集</h2>
    <div class="desc">賃料・管理費は自動入力(変更可)。「引き落とし総額」と「電気」を入れると保証料を自動で逆算します。総額だけ入れた場合も合計に含まれます。ガス・水道は手入力。</div>
    <div class="frow"><div class="field"><label>賃料</label><input class="finput num" id="f-rent" inputmode="numeric" value="${f.rent!=null?f.rent:""}"></div>
      <div class="field"><label>管理費</label><input class="finput num" id="f-mgmt" inputmode="numeric" value="${f.mgmt!=null?f.mgmt:""}"></div></div>
    <div class="field"><label>引き落とし総額 <span class="hint">(賃料+管理費+保証料+電気)</span></label><input class="finput num" id="f-total" inputmode="numeric" value="${f.totalDebit!=null?f.totalDebit:""}"></div>
    <div class="field"><label>電気</label><input class="finput num" id="f-denki" inputmode="numeric" value="${f.denki!=null?f.denki:""}"></div>
    <div class="computed"><span>保証料 + 引落手数料(自動)</span><span id="f-hosho">未入力</span></div>
    <div style="height:13px"></div>
    <div class="frow"><div class="field"><label>ガス</label><input class="finput num" id="f-gas" inputmode="numeric" value="${f.gas!=null?f.gas:""}"></div>
      <div class="field"><label>水道</label><input class="finput num" id="f-water" inputmode="numeric" value="${f.water!=null?f.water:""}"></div></div>
    ${extraHtml}
    <button class="addrow" id="f-addextra">+ その他の固定費を追加</button>
    <button class="sheetbtn" id="f-save">保存</button>`);
  function recompute(){
    const t=evalExpr(g("f-total")), d=evalExpr(g("f-denki")), r=evalExpr(g("f-rent")), m=evalExpr(g("f-mgmt"));
    const el=document.getElementById("f-hosho");
    if(t!=null&&d!=null){ el.textContent=fmt(t-(r||0)-(m||0)-d); } else el.textContent= t!=null ? "未入力(総額で計上)" : "未入力";
  }
  function g(id){ const e=document.getElementById(id); return e?e.value:""; }
  ["f-total","f-denki","f-rent","f-mgmt"].forEach(id=>document.getElementById(id).addEventListener("input",recompute));
  recompute();
  function snap(){ const f=db.months[k0].fixed;  // 書き込みは常に生きている月へ(未保存の一時スナップ・不正な文字列は旧値を保つ)
    f.rent=_snapVal(g("f-rent"),f.rent); f.mgmt=_snapVal(g("f-mgmt"),f.mgmt); f.totalDebit=_snapVal(g("f-total"),f.totalDebit); f.denki=_snapVal(g("f-denki"),f.denki); f.gas=_snapVal(g("f-gas"),f.gas); f.water=_snapVal(g("f-water"),f.water);
    document.querySelectorAll('[data-ex]').forEach(inp=>{ const i=+inp.dataset.i,kk=inp.dataset.ex; if(f.extra[i]) f.extra[i][kk]= kk==="amount"?_snapVal(inp.value,f.extra[i].amount):inp.value; }); }
  document.getElementById("f-addextra").addEventListener("click",()=>{ const f=db.months[k0].fixed; f.extra=f.extra||[]; snap(); f.extra.push({name:"",amount:null}); editFixedReopen(); });
  document.querySelectorAll('[data-rmex]').forEach(b=>b.addEventListener("click",()=>{ const f=db.months[k0].fixed; snap(); f.extra.splice(+b.dataset.rmex,1); editFixedReopen(); }));
  document.getElementById("f-save").addEventListener("click",()=>{
      const vals={}; let bad=false;
    ["f-rent","f-mgmt","f-total","f-denki","f-gas","f-water"].forEach(id=>{ const r=_readAmt(id,{allowEmpty:true}); if(!r.ok) bad=true; else vals[id]=r.v; });
    const exs=[];
    document.querySelectorAll('[data-ex]').forEach(inp=>{ const i=+inp.dataset.i, k=inp.dataset.ex;
      if(k==="amount"){ const r=_readAmt(inp,{allowEmpty:true}); if(!r.ok) bad=true; else exs.push({i,k,v:r.v}); }
      else exs.push({i,k,v:inp.value}); });
    if(bad){ _focusFirstBad(); toast("入力を確認してください ⚠️","warn"); return; }
    const f=db.months[k0].fixed;                    // 保存の瞬間に取り直す(同期で db が入れ替わっても生きている方に書く)
    f.rent=vals["f-rent"]; f.mgmt=vals["f-mgmt"]; f.totalDebit=vals["f-total"];
    f.denki=vals["f-denki"]; f.gas=vals["f-gas"]; f.water=vals["f-water"];
    f.extra=f.extra||[]; exs.forEach(x=>{ if(f.extra[x.i]) f.extra[x.i][x.k]=x.v; });
    f.extra=(f.extra||[]).filter(x=>x.name||x.amount!=null);
    save(); closeSheet(); render();
    toast(labelOf(k0)+" の固定費を保存しました ✓");
  });
}
function editFixedReopen(){ editFixed(); }

function editIncome(){
  const k0=active;
  const mo=db.months[k0];
  const kari=_isKari(k0);
  let rows=mo.income.map((i,idx)=>`<div class="frow"><div class="field"><label>名前</label><input class="finput" data-in="who" data-i="${idx}" value="${esc(i.who)}"></div><div class="field"><label>入金額</label><input class="finput num" data-in="amount" data-i="${idx}" inputmode="numeric" value="${i.amount!=null?i.amount:""}"></div></div>`).join("");
  openSheet(`<h2>入金 / 繰越金の編集</h2>
    <div class="desc">「今月の繰越金」は通常は精算で設定しますが、ここでも直接変更できます。${kari?'<br><b>今は仮(自動)の値です。</b>ここで手を入れると確定扱いになり、以後は自動で変わりません。':''}</div>
    <div class="field"><label>今月の繰越金 <span class="hint">(＝先月の繰越)</span>${kari?' <span class="chip-kari">仮</span>':(mo.startConfirmed&&_isCarryMonth(k0)?' <span class="chip-ok">確定</span>':'')}</label><input class="finput num" id="i-start" inputmode="numeric" value="${mo.start!=null?mo.start:""}"></div>
    <div style="height:6px"></div>${rows}
    <button class="sheetbtn" id="i-save">保存</button>`);
  let touchedStart=false;
  document.getElementById("i-start").addEventListener("input",()=>{ touchedStart=true; });
  document.getElementById("i-save").addEventListener("click",()=>{
      let bad=false;
    const rs=_readAmt("i-start",{allowEmpty:false}); if(!rs.ok) bad=true;
    const inc=[];
    document.querySelectorAll('[data-in]').forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.in;
      if(k==="amount"){ const r=_readAmt(inp,{allowEmpty:false}); if(!r.ok) bad=true; else inc.push({i,k,v:r.v}); }
      else inc.push({i,k,v:inp.value}); });
    if(bad){ _focusFirstBad(); toast("入力を確認してください ⚠️","warn"); return; }
    const mo=db.months[k0];                          // 保存の瞬間に取り直す
    mo.start=rs.v;
    if(touchedStart) mo.startConfirmed=true;         // 人が触った繰越金は確定(以後は自動で変わらない)
    inc.forEach(x=>{ if(mo.income[x.i]) mo.income[x.i][x.k]=x.v; });
    save(); closeSheet(); render();
    toast(labelOf(k0)+" の入金/繰越金を保存しました"+(touchedStart?"（繰越金 確定）":"")+" ✓");
  });
}
function editCash(){
  const k0=active;
  const c=db.months[k0].cash||{start:0,deposit:0};   // 表示用。開いただけでは db に書かない
  openSheet(`<h2>現金の編集</h2>
    <div class="desc">現金だけを管理するサブ台帳です。日々の「現金で払った額」は記帳の現金タグから自動集計されます。</div>
    <div class="field"><label>先月の現金残</label><input class="finput num" id="c-start" inputmode="numeric" value="${c.start!=null?c.start:""}"></div>
    <div class="field"><label>今月の引き出し額</label><input class="finput num" id="c-dep" inputmode="numeric" value="${c.deposit!=null?c.deposit:""}"></div>
    <button class="sheetbtn" id="c-save">保存</button>`);
  document.getElementById("c-save").addEventListener("click",()=>{
      const a=_readAmt("c-start",{allowEmpty:false}), b=_readAmt("c-dep",{allowEmpty:false});
    if(!a.ok||!b.ok){ _focusFirstBad(); toast("入力を確認してください ⚠️","warn"); return; }
    const mo=db.months[k0]; const cc=mo.cash||(mo.cash={start:0,deposit:0});   // 保存の瞬間に取り直す
    cc.start=a.v; cc.deposit=b.v;
    save(); closeSheet(); render();
    toast(labelOf(k0)+" の現金を保存しました ✓");
  });
}
function editVarTotals(){
  const k0=active;
  const mo=db.months[k0];
  let rows=mo.categories.map(cat=>`<div class="frow"><div class="field"><label>${esc(cat)}</label><input class="finput num" data-ct="${esc(cat)}" inputmode="numeric" value="${mo.categoryTotals[cat]!=null?mo.categoryTotals[cat]:""}"></div></div>`).join("");
  openSheet(`<h2>変動費(合計)の編集</h2>
    <div class="desc">この月は移行データ(合計のみ)です。分類ごとの合計を直接編集できます(空欄は 0)。</div>
    ${rows}<button class="sheetbtn" id="vt-save">保存</button>`);
  document.getElementById("vt-save").addEventListener("click",()=>{
      let bad=false; const vals=[];
    document.querySelectorAll('[data-ct]').forEach(inp=>{ const r=_readAmt(inp,{allowEmpty:true}); if(!r.ok) bad=true; else vals.push({c:inp.dataset.ct, v:r.v||0}); });
    if(bad){ _focusFirstBad(); toast("入力を確認してください ⚠️","warn"); return; }
    const mo=db.months[k0];                          // 保存の瞬間に取り直す
    mo.categoryTotals=mo.categoryTotals||{};
    vals.forEach(x=>{ mo.categoryTotals[x.c]=x.v; });
    save(); closeSheet(); render();
    toast(labelOf(k0)+" の変動費(合計)を保存しました ✓");
  });
}

/* ============================================================
   変動費の分類 + 分類の統合 (REV-20260901-02)
   - 「過去に使った分類」は常に見える(タップで今月に追加 = 同じ文字列の再利用)
   - 「統合」: 選ぶ → 最終的な名前 → 影響範囲(両方ある月は赤く)→ 確認語を打つ → 実行
     全月の categories / categoryTotals / entries を書き換える。金額は動かない。
   ============================================================ */
function _catPresent(k,c){ const m=db.months[k]; if(!m) return false;
  return (m.categories||[]).indexOf(c)>=0 || (m.entries||[]).some(e=>e.category===c) || !!(m.categoryTotals && m.categoryTotals[c]!=null); }
function _catUsage(c){ let months=0, cnt=0, last="";
  monthsAsc().forEach(k=>{ if(_catPresent(k,c)){ months++; last=k; cnt+=(db.months[k].entries||[]).filter(e=>e.category===c).length; } });
  return {months,cnt,last}; }
function _allCats(){ return Array.from(new Set(monthsAsc().flatMap(m=>db.months[m].categories||[]).concat(monthsAsc().flatMap(m=>(db.months[m].entries||[]).map(e=>e.category))))).filter(Boolean); }

function editVarCats(reassignCat){
  const k0=active;
  const mo=db.months[k0];
  const defaults=db.settings.defaultCategories||[];
  const cnt=cat=>(mo.entries||[]).filter(e=>e.category===cat).length;
  let rows=mo.categories.map(cat=>{
    if(defaults.includes(cat)) return `<div class="frow" style="align-items:center;margin-bottom:13px"><span style="flex:1;font-size:14.5px;color:var(--ink)">${esc(cat)}</span><span class="vc-fixed">固定</span></div>`;
    if(reassignCat===cat){
      const opts=mo.categories.filter(c=>c!==cat).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
      return `<div class="frow" style="flex-wrap:wrap;gap:8px;background:var(--clay-soft);padding:10px;border-radius:12px"><div class="field" style="flex:1 1 100%"><label>「${esc(cat)}」の記録(${cnt(cat)}件)を移動 →</label><select class="finput" id="vc-target">${opts}</select></div><button class="sheetbtn danger" id="vc-domove" style="flex:1;margin:0">移動して削除</button><button class="addrow" id="vc-cancel" style="flex:0 0 auto;margin:0;width:auto;padding:0 14px">キャンセル</button></div>`;
    }
    return `<div class="frow" style="align-items:center;margin-bottom:13px"><span style="flex:1;font-size:14.5px;color:var(--ink)">${esc(cat)}</span><button class="del" data-rmcat="${esc(cat)}">×</button></div>`;
  }).join("");
  /* 過去に使った分類(今月に無いもの)をワンタップで復用できる候補 — 常時表示。
     候補タップ = 同じ文字列の再利用なので、表記が必ず一致し比較が自動で繋がる。 */
  const all=_allCats();
  const pastCats=all.filter(c=>!mo.categories.includes(c));
  const mergeable=all.filter(c=>!defaults.includes(c));
  const pastHtml=pastCats.length
    ? `<div class="chips">${pastCats.map(c=>`<button class="chip" data-past="${esc(c)}">${esc(c)}</button>`).join("")}</div>`
    : `<div class="vc-empty">まだありません</div>`;
  openSheet(`<h2>変動費の分類</h2>
    <div class="desc">この月の大分類です。元の5つは固定。新しい分類を追加・削除できます。合計は記帳から自動集計され、翌月は5つに戻ります。</div>
    <div class="vc-sec"><div class="vc-h">この月の分類</div>${rows}</div>
    <div class="vc-sec"><div class="vc-h">過去に使った分類 <small>タップで今月に追加・表記ゆれ防止</small></div>${pastHtml}
      ${mergeable.length?'<button class="addrow" id="vc-merge">分類を統合する（表記ゆれをまとめる）</button>':''}</div>
    <div class="vc-sec"><div class="vc-h">新しい分類</div>
      <div class="frow" style="align-items:center"><input class="finput" id="vc-newcat" placeholder="新しい分類名" autocomplete="off"><button class="chip" id="vc-addnew" style="flex:0 0 auto">追加</button></div></div>
    <button class="sheetbtn" id="vc-done" style="margin-top:14px">完了</button>`);
  const newcat=document.getElementById("vc-newcat");
  document.querySelectorAll('[data-past]').forEach(b=>b.addEventListener("click",()=>{ const mo=db.months[k0]; const c=b.dataset.past; if(!mo.categories.includes(c)){ mo.categories.push(c); save(); toast("「"+c+"」を"+labelOf(k0)+"に追加しました ✓"); } editVarCats(); }));
  /* 入力欄に残っている分類名を確定する(再描画はしない)。
     「完了」ボタンやページを閉じた時に、打ち込んだ名前が消えるのを防ぐ。 */
  const flushNewCat=()=>{ const mo=db.months[k0]; const n=newcat.value.trim(); newcat.value=""; if(n && !mo.categories.includes(n)){ mo.categories.push(n); save(); toast("「"+n+"」を追加しました ✓"); return true; } return false; };
  const commitAdd=()=>{ flushNewCat(); editVarCats(); };
  document.getElementById("vc-addnew").addEventListener("click",commitAdd);
  newcat.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); commitAdd(); } else if(e.key==="Escape"){ newcat.value=""; } });
  document.querySelectorAll('[data-rmcat]').forEach(b=>b.addEventListener("click",()=>{ const mo=db.months[k0]; const cat=b.dataset.rmcat; if(cnt(cat)>0){ editVarCats(cat); } else { mo.categories=mo.categories.filter(c=>c!==cat); save(); toast("「"+cat+"」を外しました"); editVarCats(); } }));
  document.getElementById("vc-domove")?.addEventListener("click",()=>{ const mo=db.months[k0]; const t=document.getElementById("vc-target").value; let n=0; (mo.entries||[]).forEach(e=>{ if(e.category===reassignCat){ e.category=t; n++; } }); mo.categories=mo.categories.filter(c=>c!==reassignCat); save(); toast(n+"件を「"+t+"」へ移動し「"+reassignCat+"」を外しました ✓"); editVarCats(); });
  document.getElementById("vc-cancel")?.addEventListener("click",()=>editVarCats());
  document.getElementById("vc-merge")?.addEventListener("click",()=>{ flushNewCat(); _mergeCatsStep1(k0, []); });
  document.getElementById("vc-done").addEventListener("click",()=>{ closeSheet(); });
  _onSheetClose=()=>{ flushNewCat(); render(); };
}
/* 統合 1/3: 選ぶ */
function _mergeCatsStep1(k0, pre){
  const defaults=db.settings.defaultCategories||[];
  const mergeable=_allCats().filter(c=>!defaults.includes(c));
  const sel=new Set(pre||[]);
  const chips=mergeable.map(c=>{ const u=_catUsage(c); return `<button class="chip sel ${sel.has(c)?'on':''}" data-msel="${esc(c)}">${esc(c)}<small>${u.months}ヶ月</small></button>`; }).join("");
  openSheet(`<h2>分類の統合 <small>1/3</small></h2>
    <div class="desc">まとめたい分類を選んでください（元の5つは選べません）。例: 「お見舞い」と「おみまい」、「衣類」と「衣料品」。</div>
    <div class="chips" id="mg-chips">${chips}</div>
    <button class="sheetbtn" id="mg-next" ${sel.size?'':'disabled'}>次へ（${sel.size}件を選択中）</button>
    <button class="sheetbtn ghost" id="mg-cancel">分類の一覧へ戻る</button>`);
  const nb=document.getElementById("mg-next");
  document.getElementById("mg-chips").addEventListener("click",e=>{ const b=e.target.closest("[data-msel]"); if(!b) return; const c=b.dataset.msel; if(sel.has(c)) sel.delete(c); else sel.add(c); b.classList.toggle("on",sel.has(c)); nb.disabled=!sel.size; nb.textContent=`次へ（${sel.size}件を選択中）`; });
  nb.addEventListener("click",()=>{ if(!sel.size) return; _mergeCatsStep2(k0, Array.from(sel)); });
  document.getElementById("mg-cancel").addEventListener("click",()=>editVarCats());
  _onSheetClose=()=>{ render(); };
}
/* 統合 2/3: 最終的な名前 */
function _mergeCatsStep2(k0, sel){
  const byLast=sel.slice().sort((a,b)=>_catUsage(b).last.localeCompare(_catUsage(a).last));
  const def=byLast[0]||"";
  openSheet(`<h2>分類の統合 <small>2/3</small></h2>
    <div class="desc">選んだ ${sel.length} 件をひとつの名前にまとめます。下の候補をタップするか、新しい名前を入力してください。</div>
    <div class="field"><label>最終的な名前</label><input class="finput" id="mg-name" value="${esc(def)}" autocomplete="off"></div>
    <div class="chips">${sel.map(c=>`<button class="chip" data-mgpick="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <button class="sheetbtn" id="mg-next2">影響を確認する</button>
    <button class="sheetbtn ghost" id="mg-back">戻る</button>`);
  const inp=document.getElementById("mg-name");
  document.querySelectorAll("[data-mgpick]").forEach(b=>b.addEventListener("click",()=>{ inp.value=b.dataset.mgpick; _clearBad(inp); }));
  document.getElementById("mg-next2").addEventListener("click",()=>{ const t=inp.value.trim(); if(!t){ _markBad(inp,"名前を入力してください ✏️"); return; } _mergeCatsStep3(k0, sel, t); });
  document.getElementById("mg-back").addEventListener("click",()=>_mergeCatsStep1(k0, sel));
  _onSheetClose=()=>{ render(); };
}
function _mergePlan(sel, target){
  const sources=sel.filter(c=>c!==target);
  const months=[]; let ents=0;
  monthsAsc().forEach(k=>{
    const present=sources.filter(c=>_catPresent(k,c)); if(!present.length) return;
    const hasTarget=_catPresent(k,target);
    const n=(db.months[k].entries||[]).filter(e=>present.indexOf(e.category)>=0).length;
    months.push({k, sources:present, n, both: present.length>=2 || hasTarget}); ents+=n;
  });
  return {sources, months, ents};
}
/* 統合 3/3: 影響の確認 + 確認語 */
function _mergeCatsStep3(k0, sel, target){
  const plan=_mergePlan(sel, target);
  const list=plan.months.length
    ? plan.months.map(m=>`<div class="mg-row ${m.both?'both':''}"><span class="mg-m">${labelOf(m.k)}</span><span class="mg-d">${m.sources.map(esc).join("・")} → ${esc(target)}${m.n?`<small>${m.n}件</small>`:''}${m.both?'<b>両方あるため合算されます</b>':''}</span></div>`).join("")
    : `<div class="vc-empty">変更される月はありません（すでに「${esc(target)}」だけです）</div>`;
  openSheet(`<h2>分類の統合 <small>3/3</small></h2>
    <div class="mg-sum">${plan.months.length} ヶ月・${plan.ents} 件の記録を「${esc(target)}」に統合します</div>
    <div class="mg-list">${list}</div>
    <div class="desc" style="margin-top:12px">金額は変わりません（余額もそのまま）。<b>取り消しはできません。</b>実行前にバックアップ（右上 ↓）をおすすめします。</div>
    <div class="field"><label>確認のため「我已确定无误」と入力してください</label><input class="finput" id="mg-confirm" autocomplete="off" placeholder="我已确定无误"></div>
    <button class="sheetbtn" id="mg-run" disabled>統合する</button>
    <button class="sheetbtn ghost" id="mg-back">戻る</button>`);
  const conf=document.getElementById("mg-confirm"), run=document.getElementById("mg-run");
  conf.addEventListener("input",()=>{ run.disabled = conf.value.trim()!=="我已确定无误" || !plan.months.length; });
  run.addEventListener("click",()=>{
      if(conf.value.trim()!=="我已确定无误"){ _markBad(conf,"「我已确定无误」と入力してください ✏️"); return; }
    const r=_applyMerge(sel, target);
    save();
    toast(`「${target}」に統合しました（${r.months}ヶ月・${r.ents}件）✓`);
    editVarCats();
  });
  document.getElementById("mg-back").addEventListener("click",()=>_mergeCatsStep2(k0, sel));
  _onSheetClose=()=>{ render(); };
}
function _applyMerge(sel, target){
  const sources=sel.filter(c=>c!==target); let months=0, ents=0;
  monthsAsc().forEach(k=>{
    const m=db.months[k]; let touched=false;
    (m.entries||[]).forEach(e=>{ if(sources.indexOf(e.category)>=0){ e.category=target; ents++; touched=true; } });
    if(m.categoryTotals){ sources.forEach(s=>{ if(m.categoryTotals[s]!=null){ m.categoryTotals[target]=(m.categoryTotals[target]||0)+(m.categoryTotals[s]||0); delete m.categoryTotals[s]; touched=true; } }); }
    if(m.categories && m.categories.some(c=>sources.indexOf(c)>=0)){
      const out=[]; m.categories.forEach(c=>{ const n=sources.indexOf(c)>=0?target:c; if(out.indexOf(n)<0) out.push(n); }); m.categories=out; touched=true;
    }
    if(touched) months++;
  });
  return {months, ents};
}

/* 記録の追加・編集 (BUG-20260901-02/-03/-08) */
let _lastAddedId=null;
function _highlightEntry(id){
  if(!id) return;
  setTimeout(()=>{ const el=document.querySelector('[data-eid="'+id+'"]'); if(!el) return;
    const day=el.closest(".day")||el; day.classList.add("flash");
    if(day.scrollIntoView) try{ day.scrollIntoView({block:"center",behavior:"smooth"}); }catch(e){}
    setTimeout(()=>day.classList.remove("flash"), 1600); }, 40);
}
/* ============================================================
   日付ピッカー (v11 · batch3)
   方針: ネイティブの <input type="date"> は「値の持ち主」として残し、
        見た目とタップだけを差し替える。
        → di.value / min / max / _markBad / 保存時の守衛は一切変えない。
   min/max は常に同じ月の 1 日〜末日なので、月送りは要らない。
   ============================================================ */
function _dateLabel(v){
  if(!v) return "";
  const [y,m,d]=v.split("-").map(Number);
  return m+"月"+d+"日 ("+["日","月","火","水","木","金","土"][new Date(y,m-1,d).getDay()]+")";
}
/* 見た目のボタンだけを作る。input は呼び出し側にリテラルで置く
   （id をソース上の literal に保つ = 関門4 が「その id は生成されるか」を静的に確認できる） */
function _dfBtn(id, value){
  return '<button type="button" class="dfbtn'+(value?'':' ph')+'" data-dfor="'+id+'">'
    + '<span class="dfl">日付</span>'
    + '<span class="dfv">'+(value?_dateLabel(value):"選んでください")+'</span>'
    + '<span class="dfc">▾</span></button>';
}
function openDatePicker(id){
  const inp=document.getElementById(id); if(!inp) return;
  const min=inp.min||(active+"-01");
  const key=min.slice(0,7);                              // min/max は同じ月なので月はここで決まる
  const [y,m]=key.split("-").map(Number);
  const days=new Date(y,m,0).getDate(), first=new Date(y,m,1).getDay();
  const sel=inp.value, todayS=_todayStr();               // 今日は東京時間
  const mo=db.months[key]||{};
  const has={}; (mo.entries||[]).forEach(e=>{ has[String(e.date||"").slice(8,10)]=1; });
  let cells="";
  for(let i=0;i<first;i++) cells+='<div class="dy pad"></div>';
  for(let d=1;d<=days;d++){
    const ds=key+"-"+String(d).padStart(2,"0");
    let c="dy";
    if(ds===sel) c+=" sel"; else if(ds===todayS) c+=" today";
    if(ds>todayS) c+=" fut";
    let mk="";
    if(d===PAYDAY) mk='<span class="mk pay"></span>';
    else if(has[String(d).padStart(2,"0")]) mk='<span class="mk has"></span>';
    cells+='<button type="button" class="'+c+'" data-pick="'+ds+'">'+d+mk+'</button>';
  }
  const showToday = todayS>=min && todayS<=(inp.max||todayS);
  openDialog('<div class="cal">'
    + '<div class="calttl">'+labelOf(key)+'</div>'
    + '<div class="wk"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>'
    + '<div class="days" id="dp-days">'+cells+'</div>'
    + '<div class="callg"><span><i class="pay"></i>給料日</span><span><i class="has"></i>記帳あり</span></div>'
    + (showToday?'<div class="calft"><button class="todaybtn" id="dp-today">今日へ</button></div>':'')
    + '</div>');
  const pick=(ds)=>{
    inp.value=ds;
    inp.dispatchEvent(new Event("input",{bubbles:true}));   // _markBad の解除もこれで走る
    inp.dispatchEvent(new Event("change",{bubbles:true}));
    const b=document.querySelector('.dfbtn[data-dfor="'+id+'"]');
    if(b){ b.classList.remove("ph"); b.querySelector(".dfv").textContent=_dateLabel(ds); }
    closeDialog();
  };
  document.getElementById("dp-days").addEventListener("click",e=>{
    const t=e.target.closest("[data-pick]"); if(t) pick(t.dataset.pick);
  });
  document.getElementById("dp-today")?.addEventListener("click",()=>pick(todayS));
}
/* 差し替えたボタンはどの画面にも出るので、文書レベルで一度だけ束ねる */
document.addEventListener("click",e=>{
  const b=e.target.closest && e.target.closest(".dfbtn");
  if(b) openDatePicker(b.dataset.dfor);
});

function _md(date){ const p=String(date||"").split("-"); return p.length===3 ? (Number(p[1])+"/"+Number(p[2])) : date; }
function editEntry(id){
  const k0=active;
  const mo=db.months[k0]; const e=id?mo.entries.find(x=>x.id===id):null;
  const cats=mo.categories;
  const [ey,em]=active.split("-").map(Number); const eMin=active+"-01", eMax=active+"-"+String(new Date(ey,em,0).getDate()).padStart(2,"0");
  const cur=(k0===_nowYM());
  const eDefault=e?e.date:(cur?_todayStr():"");
  let chips=cats.map(c=>`<button class="chip ${e&&e.category===c?'on':(!e&&c===cats[0]?'on':'')}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  openSheet(`<h2>${e?"記録を編集":"記録を追加"} <small>${labelOf(k0)}</small></h2>
    ${!cur?`<div class="entrybar"><span>${labelOf(k0)} の記録です<small>（今日は ${_md(_todayStr())}）</small></span></div>`:''}
    <div class="field"><label>日付${!cur?' <span class="hint">必ず選んでください</span>':''}</label><div class="datefield"><input class="finput" type="date" id="e-date" value="${eDefault}" min="${eMin}" max="${eMax}">${_dfBtn("e-date",eDefault)}</div></div>
    <div class="field"><label>分類</label><div class="chips" id="e-chips">${chips}</div></div>
    <div class="qrow"><div class="amt-in"><span>¥</span><input inputmode="numeric" id="e-amt" placeholder="0" value="${e?e.amount:''}"></div>
      <div class="cash-toggle ${e&&e.cash?'on':''}" id="e-cash"><div class="switch"></div>現金</div></div>
    <button class="sheetbtn" id="e-save" style="margin-top:16px">${e?"保存":"追加する"}</button>
    ${e?'<button class="sheetbtn danger" id="e-del">削除</button>':''}`);
  let cat=e?e.category:cats[0], isCash=!!(e&&e.cash);
  document.getElementById("e-chips").addEventListener("click",ev=>{ const c=ev.target.closest(".chip"); if(!c) return; document.querySelectorAll("#e-chips .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); cat=c.dataset.c; });
  document.getElementById("e-cash").addEventListener("click",function(){ this.classList.toggle("on"); isCash=this.classList.contains("on"); });
  document.getElementById("e-save").addEventListener("click",async ()=>{
      const ra=_readAmt("e-amt",{allowEmpty:false,allowZero:false,allowNegative:false});
    const di=document.getElementById("e-date"); const date=di.value;
    let bad=!ra.ok;
    if(!date){ _markBad(di,"日付を選んでください ✏️"); bad=true; }
    else if(date<eMin||date>eMax){ _markBad(di,labelOf(k0)+" の日付を選んでください ✏️"); bad=true; }
    if(bad){ _focusFirstBad(); return; }
    if(!(await _confirmAwayEntry(date))) return;           // 東京の外: 日付の確認
    const amt=ra.v;
    const m=db.months[k0]; m.entries=m.entries||[];             // 保存の瞬間に取り直す
    const le=id?m.entries.find(x=>x.id===id):null;
    if(id&&!le){ closeSheet(); render(); toast("この記録はすでに削除されています","warn"); return; }
    let nid=id;
    if(le){ le.category=cat; le.amount=amt; le.cash=isCash?amt:0; le.date=date; }
    else{ nid="e"+Date.now(); m.entries.push({id:nid,date:date,category:cat,amount:amt,cash:isCash?amt:0}); }
    save(); closeSheet(); render();
    toast(_md(date)+" · "+cat+" "+fmt(amt)+(isCash?"（現金）":"")+" を"+(le?"更新":"追加")+"しました ✓");
    _highlightEntry(nid);
  });
  if(e){ document.getElementById("e-del").addEventListener("click",async ()=>{
      const ok=await _confirmDialog(_md(e.date)+" · "+esc(e.category)+" "+fmt(e.amount)+" を削除しますか？","削除する","やめる",true);
    if(!ok) return;
    const m=db.months[k0]; m.entries=(m.entries||[]).filter(x=>x.id!==id); save(); closeSheet(); render();
    toast(_md(e.date)+" · "+e.category+" "+fmt(e.amount)+" を削除しました");
  }); }
}

/* ============================================================
   精算 — フルページ + 単一下書き
   - 下書きは記帳データ(data.json)に入れない。打っている間はこの端末の
     localStorage に自動保存し、戻る時に非公開リポジトリの draft.json へ
     1 回だけアップロード(1 枠のみ)。
   - 月オブジェクトの参照は保持しない。書き込みの瞬間に毎回 M() で取得
     (同期で db が丸ごと入れ替わっても、生きている月に書く)。
   - ページを開いている間、自動同期(pull)は一時停止(sync.js が _hesanOpen を見る)。
   [2026-09-01] 
   - 開けるのは今月と来月だけ(過去月の繰越金を誤って書き換えない) (BUG-06)
   - 閉じる前にリモートの下書きを確認し、相手が更新していれば選ばせる (BUG-12)
   - 「設定」の前に相手が先に確定していないか確認 / 設定後は下書きを消す (BUG-13)
   - 下書きの月が違えば「設定」を止め、移動か削除を選ばせる (BUG-14)
   ============================================================ */
let _hesanOpen=false;
const DRAFT_LS="we_kakeibo_draft_v1", DRAFT_PENDING_LS="we_kakeibo_draft_pending";
function _draftLocalGet(){ try{ const s=localStorage.getItem(DRAFT_LS); return s?JSON.parse(s):null; }catch(e){ return null; } }
function _draftLocalSet(d){ try{ if(d) localStorage.setItem(DRAFT_LS, JSON.stringify(d)); else localStorage.removeItem(DRAFT_LS); }catch(e){} }
function _draftPendingGet(){ try{ return localStorage.getItem(DRAFT_PENDING_LS)==="1"; }catch(e){ return false; } }
function _draftPendingSet(v){ try{ if(v) localStorage.setItem(DRAFT_PENDING_LS,"1"); else localStorage.removeItem(DRAFT_PENDING_LS); }catch(e){} }
function _hesanDefaultRows(){ const P=db.settings.people;
  return [ {label:P[0]+" pay",expr:""},{label:P[0]+" 現金",expr:""},{label:P[1]+" 現金",expr:""},{label:P[1]+" pay",expr:""},{label:P[1]+" カード",expr:""} ]; }
/* 全角数字・カンマ・¥・空白を受け付けてから evalExpr へ(精算は式の欄なので寛容のまま) */
function _hesanNum(s){ if(s==null) return null;
  s=String(s).replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[，,¥￥\s]/g,"");
  return evalExpr(s); }
function _hm(ts){ const d=new Date(ts||0); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }

function openHesan(force){
  if(_hesanOpen) return;
  const key=active;
  if(force!==true && !_isCarryMonth(key)){
    openDialog('<h2>過去の月は精算できません</h2><div class="desc">精算は今月と来月の繰越金を決めるためのものです。'+labelOf(key)+' の繰越金を直したい時は「入金 / 繰越金の編集」から変更できます。</div>'
      +'<button class="sheetbtn" id="hp-goinc">入金 / 繰越金の編集を開く</button><button class="sheetbtn ghost" id="hp-close">閉じる</button>');
    document.getElementById("hp-goinc").addEventListener("click",()=>{ closeDialog(true); editIncome(); });
    document.getElementById("hp-close").addEventListener("click",()=>closeDialog());
    return;
  }
  _hesanOpen=true;
  const M=()=>db.months[key];
  const P=db.settings.people;

  let d=_draftLocalGet();
  let rows=(d&&d.rows&&d.rows.length)?JSON.parse(JSON.stringify(d.rows)):_hesanDefaultRows();
  let yzExpr=(d&&d.yeonZan!=null)?String(d.yeonZan):"";
  let initExpr=(d&&d.initAmount!=null)?String(d.initAmount):"";
  let draftMonth=d?d.month:null;
  let lastSavedAt=d?(d.savedAt||0):0;
  let baseSavedAt=lastSavedAt;                       // 開いた時点で採用していた下書きの時刻(衝突判定の基準)
  let pendingFlag=_draftPendingGet();                // 前回オフラインで送れなかった下書きが残っている
  let typed=false, dirty=false, saveTimer=null, closing=false;
  const cashNote=_cashUnusedSince();

  const page=document.createElement("div");
  page.className="hesanpage";
  document.body.appendChild(page);

  function isEmptyDraft(){ return rows.every(r=>!String(r.expr||"").trim()) && !String(yzExpr).trim() && !String(initExpr).trim(); }
  function draftObj(){ return { month:key, rows:rows, yeonZan:yzExpr, initAmount:initExpr, savedAt:Date.now() }; }
  function flushLocal(){ clearTimeout(saveTimer); saveTimer=null; if(!dirty) return; dirty=false;
    const o=isEmptyDraft()?null:draftObj(); _draftLocalSet(o); if(o) lastSavedAt=o.savedAt; }
  function touch(){ typed=true; dirty=true; draftMonth=key; clearTimeout(saveTimer); saveTimer=setTimeout(flushLocal,800); }
  function adopt(rd){                                // リモートの下書きをこの端末に取り込む
    if(!rd || rd.month==null || !rd.rows || !rd.rows.length){
      rows=_hesanDefaultRows(); yzExpr=""; initExpr=""; draftMonth=null; _draftLocalSet(null);
      lastSavedAt=(rd&&rd.savedAt)||Date.now();
    } else {
      rows=JSON.parse(JSON.stringify(rd.rows));
      yzExpr=rd.yeonZan!=null?String(rd.yeonZan):"";
      initExpr=rd.initAmount!=null?String(rd.initAmount):"";
      draftMonth=rd.month; lastSavedAt=rd.savedAt||0;
      _draftLocalSet({month:draftMonth,rows:rows,yeonZan:yzExpr,initAmount:initExpr,savedAt:lastSavedAt});
    }
    baseSavedAt=lastSavedAt; typed=false; dirty=false; _draftPendingSet(false);
  }
  function showConflict(rd){                          // 相手が更新: 読み込むか無視するかを本人に
    const box=document.getElementById("hp-conflict"); if(!box) return;
    box.innerHTML=`<div class="hp-conflict"><span>相手が下書きを更新しました（${_hm(rd.savedAt)}）</span><div class="frow" style="gap:8px;margin-top:8px"><button class="chip on" id="hpc-load">読み込む</button><button class="chip" id="hpc-ignore">無視して続ける</button></div></div>`;
    document.getElementById("hpc-load").addEventListener("click",()=>{ adopt(rd); build(); });
    document.getElementById("hpc-ignore").addEventListener("click",()=>{ box.innerHTML=""; });
  }

  function carry(){ const m=M(); return (m&&m.start!=null)?m.start:0; }
  function rowRight(expr){ const v=_hesanNum(expr); if(v==null) return '—'; return /[+\-*/]/.test(String(expr)) ? fmtN(v) : ''; }
  function rowHtml(r,i){ return `<div class="hesanrow"><div class="hslot"><input class="hi hl-edit" data-hl="${i}" value="${esc(r.label)}"><input class="hi" data-he="${i}" value="${esc(r.expr||'')}" inputmode="decimal"></div><span class="he">${rowRight(r.expr)}</span><button class="del" data-del="${i}">×</button></div>`; }
  function calcTotal(){ let t=0; rows.forEach(r=>{ const v=_hesanNum(r.expr); if(v!=null) t+=v; }); return t; }
  function initSuggest(total){ const yz=_hesanNum(yzExpr); return yz==null?null:Math.round(total-yz); }
  function diffHtml(total){
    const yz=_hesanNum(yzExpr);
    const theoryLine=`<div class="htotal" style="border-top:1px dashed var(--hair);margin-top:0"><span style="color:var(--ink-2)">理論上の残高 <small style="font-weight:400;color:var(--ink-3)">(${esc(P[1])}残高 ＋ 繰越金)</small></span><span class="num" style="color:var(--ink-2)">${yz!=null?fmt(yz+carry()):'—'}</span></div>`;
    if(yz==null) return theoryLine+`<div class="htotal" style="border-top:1px dashed var(--hair);margin-top:0"><span style="color:var(--ink-3)">差額(実際 − 理論)</span><span style="color:var(--ink-3)">—</span></div>`;
    const dd=Math.round(total-(yz+carry())); const col=dd>0?'var(--sage)':(dd<0?'var(--clay)':'var(--ink)'); const sign=dd>0?'+':(dd<0?'−':'±'); const word=dd>0?'多い・余り':(dd<0?'少ない・不足':'一致');
    return theoryLine+`<div class="htotal" style="border-top:1px dashed var(--hair);margin-top:0"><span>差額(実際 − 理論)</span><span style="color:${col}">${sign}¥${Math.abs(dd).toLocaleString("ja-JP")} <small style="font-weight:400;color:var(--ink-2)">${word}</small></span></div>`;
  }
  function initHint(total){ const sg=initSuggest(total); return sg!=null ? ('空欄なら自動 '+fmt(sg)) : ('※ '+P[1]+'残高を入れると自動計算'); }
  function initPh(total){ const sg=initSuggest(total); return sg!=null ? fmtN(sg) : ''; }
  function msg(t){ const m=document.getElementById("hp-msg"); if(m) m.textContent=t||""; }
  function mismatch(){ return !!(draftMonth && draftMonth!==key); }
  function refresh(){ const t=calcTotal();
    const te=document.getElementById("he-total"); if(te) te.textContent=fmt(t);
    const dbx=document.getElementById("he-diffbox"); if(dbx) dbx.innerHTML=diffHtml(t);
    const h=document.getElementById("he-init-hint"); if(h) h.textContent=initHint(t);
    const ie=document.getElementById("he-init"); if(ie) ie.placeholder=initPh(t); }

  function build(){
    const t=calcTotal(); const mm=mismatch(); const m=M();
    page.innerHTML=`
    <div class="hp-top">
      <button class="iconbtn" id="hp-back" aria-label="概要へ戻る"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="hp-title">精算 <small>${labelOf(key)}${(m&&!m.startConfirmed)?' · 繰越 仮':(m&&m.startConfirmed?' · 確定済':'')}</small></div>
      <button class="hp-del" id="hp-deldraft">下書きを削除</button>
    </div>
    <div class="hp-scroll">
      <div class="desc">手元のお金を数えて、今月の<b>初期金額</b>(繰越金)を出します。記帳データとは連動しません。下書きは自動保存されます。</div>
      ${cashNote?`<div class="hp-cashnote">${labelOf(cashNote)}から現金の使用なし（現金残 ${fmt(cashRemain(monthsAsc().slice(-1)[0]))}）</div>`:``}
      ${mm ? `<div class="hp-mismatch">この下書きは ${labelOf(draftMonth)} のものです。このまま${labelOf(key)}の繰越金には設定できません。<div class="frow" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="chip on" id="hp-gomonth">${labelOf(draftMonth)}へ移動して設定</button><button class="chip" id="hp-dropdraft">下書きを削除して${labelOf(key)}を始める</button></div></div>` : ``}
      <div id="hp-conflict"></div>
      <div class="hzhint">金額は <b>5349+890</b> のように式でも書けます</div>
      <div id="he-rows">${rows.map(rowHtml).join("")}</div>
      <button class="addrow" id="he-add">+ 行を追加</button>
      <div class="htotal"><span>実際に残ったお金</span><span class="num" id="he-total">${fmt(t)}</span></div>
      <div class="htotal" style="border-top:1px dashed var(--hair)"><span style="color:var(--ink-2)">今月の繰越金 <small style="font-weight:400;color:var(--ink-3)">${(m&&!m.startConfirmed)?'仮・前月残高に自動追従':'確定済'}</small></span><span class="num" style="color:var(--ink-2)">${fmt(carry())}</span></div>
      <div class="field" style="margin:10px 0 2px"><label>${esc(P[1])}残高 <span class="hint">手入力</span></label><input class="finput num" id="he-yeon" inputmode="numeric" value="${esc(yzExpr)}" placeholder="例: 12000"></div>
      <div id="he-diffbox">${diffHtml(t)}</div>
      <div class="field" style="margin:10px 0 2px"><label>初期金額（今月の繰越金 ＋ 差額） <span class="hint" id="he-init-hint">${initHint(t)}</span></label><input class="finput num" id="he-init" inputmode="numeric" value="${esc(initExpr)}" placeholder="${initPh(t)}"></div>
      <div style="height:8px"></div>
    </div>
    <div class="hp-foot">
      <button class="sheetbtn" id="he-setinit" style="margin-top:0" ${mm?'disabled':''}>初期金額（今月の繰越金 ＋ 差額）を設定</button>
      <div class="hp-note">精算を開いている間、自動同期は一時停止します（戻ると再開）</div>
      <div class="hp-msg" id="hp-msg"></div>
    </div>`;
    bind();
  }
  function dropDraft(){
    rows=_hesanDefaultRows(); yzExpr=""; initExpr=""; draftMonth=null;
    typed=false; dirty=false; clearTimeout(saveTimer); saveTimer=null;
    _draftLocalSet(null); _draftPendingSet(false); lastSavedAt=Date.now(); baseSavedAt=lastSavedAt;
    if(window._draftSync) _draftSync.push(null);
  }
  function bind(){
    document.getElementById("hp-back").addEventListener("click",()=>closeHesan());
    document.getElementById("hp-deldraft").addEventListener("click",async ()=>{
      if(!isEmptyDraft()){ const ok=await _confirmDialog("この下書きを削除しますか？（相手の端末からも消えます）","削除する","やめる",true); if(!ok) return; }
      dropDraft(); build(); msg("下書きを削除しました");
    });
    document.getElementById("hp-gomonth")?.addEventListener("click",()=>{
      const t=draftMonth; if(!t || !db.months[t]){ msg(labelOf(t||"")+" のデータが見つかりません"); return; }
      finalizeClose(false); active=t; render(); setTimeout(()=>openHesan(true), 60);
    });
    document.getElementById("hp-dropdraft")?.addEventListener("click",async ()=>{
      const ok=await _confirmDialog(labelOf(draftMonth)+" の下書きを削除して "+labelOf(key)+" の精算を始めますか？","削除して始める","やめる",true); if(!ok) return;
      dropDraft(); build(); msg("下書きを削除しました");
    });
    page.querySelectorAll('[data-he]').forEach(inp=>inp.addEventListener("input",()=>{ rows[+inp.dataset.he].expr=inp.value; const heEl=inp.parentNode.querySelector(".he"); if(heEl) heEl.textContent=rowRight(inp.value); touch(); refresh(); }));
    page.querySelectorAll('[data-hl]').forEach(inp=>inp.addEventListener("input",()=>{ rows[+inp.dataset.hl].label=inp.value; touch(); }));
    page.querySelectorAll('[data-del]').forEach(b=>b.addEventListener("click",()=>{ rows.splice(+b.dataset.del,1); touch(); build(); }));
    document.getElementById("he-add").addEventListener("click",()=>{ rows.push({label:"項目",expr:""}); touch(); build(); });
    document.getElementById("he-yeon").addEventListener("input",function(){ yzExpr=this.value; touch(); refresh(); });
    document.getElementById("he-init").addEventListener("input",function(){ initExpr=this.value; touch(); });
    document.getElementById("he-setinit").addEventListener("click",async ()=>{
          if(mismatch()){ msg("下書きの月が違います。上の選択肢から選んでください"); return; }
      const ie=document.getElementById("he-init");
      const v=(ie && ie.value.trim())?_hesanNum(ie.value):initSuggest(calcTotal());
      if(v==null){ msg(P[1]+"残高 か 初期金額 を入力してください（金額を計算できません）"); return; }
      const val=Math.round(v);
      /* 相手が先に確定していないか(4 秒で見切り・オフラインなら省略) */
      if(window._peekRemote){
        msg("相手の状態を確認中…");
        const pk=await _peekRemote(4000); msg("");
        const rm=pk.ok && pk.data && pk.data.months && pk.data.months[key];
        if(rm && rm.startConfirmed && rm.start!==val){
          const go=await _confirmDialog("相手がすでに "+labelOf(key)+" の繰越金を <b>"+fmt(rm.start)+"</b> に設定済みです。<br>"+fmt(val)+" で上書きしますか？","上書きする","やめる",true);
          if(!go) return;
        }
      }
      const m=M();
      if(!m){ msg("この月のデータが見つかりません。戻ってやり直してください"); return; }
      m.start=val; m.startConfirmed=true;
      save();
      const chk=M();                                 // 書いた直後に読み直して確認
      if(chk && chk.start===val && chk.startConfirmed){
        /* 下書きの役目は終わり: 両端末から消す(翌月の「月違い」を防ぐ) */
        typed=false; dirty=false; clearTimeout(saveTimer); saveTimer=null;
        _draftLocalSet(null); _draftPendingSet(false);
        if(window._draftSync) _draftSync.push(null);
        finalizeClose(false); render();
        toast(labelOf(key)+" の繰越金を "+fmt(val)+" に確定しました ✓");
      }
      else { msg("反映できませんでした。もう一度お試しください"); }
    });
  }
  function currentDraftObj(){ return isEmptyDraft()?null:{month:key,rows:rows,yeonZan:yzExpr,initAmount:initExpr,savedAt:lastSavedAt||Date.now()}; }
  function finalizeClose(pushObj){
    if(!_hesanOpen) return; _hesanOpen=false;
    flushLocal();
    if(pushObj!==false && window._draftSync) _draftSync.push(pushObj);
    document.removeEventListener("visibilitychange", onVis);
    _unlockBody();
    _pageOut(page, ()=>page.remove());
    if(window._syncResume) setTimeout(window._syncResume, 400);   // 閉じたら同期を再開して 1 回取り込む
  }
  async function closeHesan(){
    if(!_hesanOpen || closing) return;
    flushLocal();
    if(!typed || !window._draftSync){ finalizeClose(false); return; }
    closing=true; msg("同期を確認中…");
    const r=await _draftSync.pullQuick(4000);
    closing=false; msg("");
    if(!_hesanOpen) return;
    if(!r.ok){ _draftPendingSet(true); finalizeClose(false); toast("オフラインのため、下書きは次に開いた時に同期します","warn"); return; }
    const rd=r.draft, remoteAt=rd?(rd.savedAt||0):0;
    const remoteDeleted=!!rd && (rd.month==null || !rd.rows || !rd.rows.length);
    if(rd && remoteAt>baseSavedAt){
      if(remoteDeleted){
        const drop=await _confirmDialog("相手が下書きを削除しました（精算を設定済みの可能性があります）。<br>この端末の下書きを破棄しますか？","破棄する","残して上書きする",true);
        if(drop){ _draftLocalSet(null); _draftPendingSet(false); typed=false; finalizeClose(false); return; }
      } else {
        const useRemote=await _confirmDialog("相手が "+_hm(remoteAt)+" に下書きを更新しています。どちらを残しますか？","相手の下書きを採用","自分の下書きで上書き");
        if(useRemote){ adopt(rd); finalizeClose(false); return; }
      }
    }
    _draftPendingSet(false); finalizeClose(currentDraftObj());
  }
  /* ページを開いたまま画面に戻ってきた時: 相手の更新を確認(打っていなければ静かに取り込む) */
  function onVis(){
    if(document.visibilityState!=="visible" || !_hesanOpen || !window._draftSync) return;
    _draftSync.pullQuick(4000).then(r=>{
      if(!r || !r.ok || !_hesanOpen) return;
      const rd=r.draft; if(!rd || (rd.savedAt||0)<=lastSavedAt) return;
      if(!typed && !pendingFlag){ adopt(rd); build(); } else showConflict(rd);
    }).catch(()=>{});
  }
  document.addEventListener("visibilitychange", onVis);
  build();
  _lockBody();
  _pageIn(page);
  /* リモート(draft.json)の下書きが新しければ取り込む(まだ打ち始めていない時だけ)。
     前回オフラインで送れなかった下書きがあれば、黙って上書きせず本人に選ばせる。 */
  if(window._draftSync){
    _draftSync.pull().then(r=>{
      if(!r || !r.ok || !_hesanOpen || typed) return;
      const rd=r.draft;
      if(!rd || (rd.savedAt||0) <= lastSavedAt){ if(!pendingFlag) return; }
      if(pendingFlag){ typed=true; if(rd && (rd.savedAt||0)>lastSavedAt) showConflict(rd); return; }   // 未送信の下書きあり: 閉じる時に送る/選ばせる
      adopt(rd); build();
    }).catch(()=>{});
  }
}

/* ---------------- settings / export (logic verbatim + 入力検査) ---------------- */
function openSettings(){
  const S=db.settings;
  openSheet(`<h2>設定</h2>
    <div class="desc">既定値(新しい月を作るときに使われます)。すべて変更できます。</div>
    <div class="frow"><div class="field"><label>名前 1</label><input class="finput" id="s-p0" value="${esc(S.people[0])}"></div>
      <div class="field"><label>名前 2</label><input class="finput" id="s-p1" value="${esc(S.people[1])}"></div></div>
    <div class="field"><label>既定の入金(1人あたり)</label><input class="finput num" id="s-inc" inputmode="numeric" value="${S.defaultIncome}"></div>
    <div class="frow"><div class="field"><label>既定の賃料</label><input class="finput num" id="s-rent" inputmode="numeric" value="${S.defaultRent}"></div>
      <div class="field"><label>既定の管理費</label><input class="finput num" id="s-mgmt" inputmode="numeric" value="${S.defaultMgmt}"></div></div>
    <div class="field"><label>既定の分類 <span class="hint">(カンマ区切り)</span></label><input class="finput" id="s-cats" value="${esc(S.defaultCategories.join("、"))}"></div>
    <button class="sheetbtn" id="s-save">保存</button>
    <button class="sheetbtn ghost" id="s-backup">JSON バックアップ（日付つきの控え）</button>
    <button class="sheetbtn ghost" id="s-csv">月別 CSV を書き出す（zip・Excel 用）</button>`);
  document.getElementById("s-save").addEventListener("click",async ()=>{
    const a=_readAmt("s-inc",{allowEmpty:false}), b=_readAmt("s-rent",{allowEmpty:false}), c=_readAmt("s-mgmt",{allowEmpty:false});
    if(!a.ok||!b.ok||!c.ok){ _focusFirstBad(); toast("入力を確認してください ⚠️","warn"); return; }
    const chg={ income:(a.v!==S.defaultIncome), rent:(b.v!==S.defaultRent), mgmt:(c.v!==S.defaultMgmt) };
    /* 金額の既定値が変わる → いつから既存の月に適用するかを本人に選ばせる (REV-20260902-07c) */
    let from=null;
    if(chg.income||chg.rent||chg.mgmt){
      from=await _askApplyDefaults({income:a.v,rent:b.v,mgmt:c.v}, chg);
      if(from===null) return;                                  // やめる
    }
    S.people=[document.getElementById("s-p0").value||"太郎",document.getElementById("s-p1").value||"花子"];
    S.defaultIncome=a.v; S.defaultRent=b.v; S.defaultMgmt=c.v;
    S.defaultCategories=document.getElementById("s-cats").value.split(/[、,]/).map(s=>s.trim()).filter(Boolean);
    let applied=[];
    if(from){ applied=_applyDefaults(from, {income:a.v,rent:b.v,mgmt:c.v}, chg); }
    save(); closeSheet(); render();
    toast("設定を保存しました"+(applied.length?"（"+applied.map(labelOf).join("・")+" に適用）":"")+" ✓");
  });
  document.getElementById("s-backup").addEventListener("click",exportBackup);
  document.getElementById("s-csv").addEventListener("click",exportCSV);
}
/* 既定値の変更をどの月から適用するか。戻り値: "now"|"next"|"none"(既存月は変えない)|null(やめる) */
function _applyTargets(from){
  const now=_nowYM(), next=shiftMonth(now,1);
  const ks = from==="now" ? [now,next] : (from==="next" ? [next] : []);
  return ks.filter(k=>!!db.months[k]);
}
function _askApplyDefaults(nv, chg){
  const S=db.settings, now=_nowYM(), next=shiftMonth(now,1);
  const lines=[];
  if(chg.rent)   lines.push("賃料 "+fmt(S.defaultRent)+" → <b>"+fmt(nv.rent)+"</b>");
  if(chg.mgmt)   lines.push("管理費 "+fmt(S.defaultMgmt)+" → <b>"+fmt(nv.mgmt)+"</b>");
  if(chg.income) lines.push("入金(1人) "+fmt(S.defaultIncome)+" → <b>"+fmt(nv.income)+"</b>");
  const rowOf=k=>{ const m=db.months[k]; if(!m) return ""; const parts=[];
    if(chg.rent)   parts.push("賃料 "+fmt(m.fixed.rent)+"→"+fmt(nv.rent));
    if(chg.mgmt)   parts.push("管理費 "+fmt(m.fixed.mgmt)+"→"+fmt(nv.mgmt));
    if(chg.income) parts.push("入金 "+m.income.map(i=>fmt(i.amount)).join("/")+"→"+fmt(nv.income));
    const warn=((chg.rent||chg.mgmt) && m.fixed.totalDebit!=null) ? '<br><span style="color:var(--clay)">※ 引き落とし総額を入力済み。保証料が変わるので総額を見直してください</span>' : '';
    return `<div class="mg-row"><span class="mg-m">${labelOf(k)}</span><span class="mg-d">${parts.join("・")}${warn}</span></div>`; };
  const nowRow=rowOf(now), nextRow=rowOf(next);
  return new Promise(res=>{
    openDialog('<h2>既定値を変更します</h2>'
      +'<div class="desc">'+lines.join("<br>")+'<br><br>'+labelOf(now)+'（今月）からの適用を選んでください。<b>過去の月は変わりません。</b>まだ無い月は作られる時に新しい値になります。</div>'
      +'<div class="mg-list" style="margin-bottom:12px">'+(nowRow||'<div class="vc-empty">'+labelOf(now)+' はまだありません</div>')+(nextRow||'')+'</div>'
      +'<button class="sheetbtn" id="ad-now">'+labelOf(now)+'（今月）から適用</button>'
      +'<button class="sheetbtn ghost" id="ad-next">'+labelOf(next)+'（来月）から適用</button>'
      +'<button class="sheetbtn ghost" id="ad-no">やめる</button>');
    document.getElementById("ad-now").addEventListener("click",()=>{ closeDialog(true); res("now"); });
    document.getElementById("ad-next").addEventListener("click",()=>{ closeDialog(true); res("next"); });
    document.getElementById("ad-no").addEventListener("click",()=>{ closeDialog(true); res(null); });
  });
}
/* 既存の 今月/来月 に新しい既定値を書く(過去月は絶対に触らない)。戻り値: 変えた月のキー */
function _applyDefaults(from, nv, chg){
  const ks=_applyTargets(from); const out=[];
  ks.forEach(k=>{ const m=db.months[k]; let t=false;
    if(chg.rent && m.fixed.rent!==nv.rent){ m.fixed.rent=nv.rent; t=true; }
    if(chg.mgmt && m.fixed.mgmt!==nv.mgmt){ m.fixed.mgmt=nv.mgmt; t=true; }
    if(chg.income){ (m.income||[]).forEach(i=>{ if(i.amount!==nv.income){ i.amount=nv.income; t=true; } }); }
    if(t) out.push(k); });
  return out;
}

/* ============================================================
   CSV 書き出し（旧レイアウト復刻・B 案）：月ごとに 合計/主表/家計 を
   個別ファイルにして zip にまとめる。純粋ロジック buildLedgerFiles と
   ライブラリ不要の makeZip に分離（ロジックは単体テスト済み）。
   ============================================================ */
function buildLedgerFiles(){
  const months = monthsAsc();
  const P = db.settings.people;

  const q   = c => { c = (c==null ? "" : String(c)); return /[",\n]/.test(c) ? '"' + c.replace(/"/g,'""') + '"' : c; };
  const row = arr => arr.map(q).join(",");
  const yen = n => (n==null || isNaN(n)) ? "" : "\u00A5\t" + Math.round(n).toLocaleString("en-US"); // ¥ + Tab + 千分位；null→空
  const tagOf = k => { const p = k.split("-"); return p[0] + "." + (+p[1]); };                        // 2026-05 → 2026.5
  const WD = ["日","月","火","水","木","金","土"];
  const isMoveIn = k => { const f=db.months[k].fixed, mo=db.months[k];                                // 引越し・アーカイブ月（2024-10）
    return f.rent==null && f.mgmt==null && (f.extra&&f.extra.length>0) && !(mo.entries&&mo.entries.length); };

  const files = [];

  months.forEach((k, idx) => {
    const mo  = db.months[k];
    const tag = tagOf(k);
    const isFirst = idx === 0;

    /* 合計 */
    {
      const L = [];
      const p0 = ((mo.income.find(i=>i.who===P[0])||mo.income[0]||{}).amount)||0;
      const p1 = ((mo.income.find(i=>i.who===P[1])||mo.income[1]||{}).amount)||0;
      const sougaku = (mo.start||0) + incomeTotal(k);
      if(isFirst){
        L.push(row(["合計", P[0]+"入金額", P[1]+"入金額", "合計支出", "残金"]));
        L.push(row([yen(sougaku), yen(p0), yen(p1), yen(totalSpend(k)), yen(balance(k))]));
      } else {
        L.push(row(["合計","前月繰越額", P[0]+"入金額", P[1]+"入金額","合計支出","残金"]));
        L.push(row([yen(sougaku), yen(mo.start), yen(p0), yen(p1), yen(totalSpend(k)), yen(balance(k))]));
      }
      files.push({name:`We_${tag}-合計.csv`, text:L.join("\r\n")});
    }

    /* 主表 */
    {
      const L = [];
      if(isMoveIn(k)){
        L.push(row(["引越し初期費用","金額"]));
        (mo.fixed.extra||[]).forEach(x => L.push(row([x.name, yen(x.amount)])));
        L.push(row(["合計", yen(fixedTotal(k))]));
      } else {
        const f = mo.fixed, hasCash = !!mo.cash;
        const fixedRows = [
          ["賃料＋管理費", (f.rent==null && f.mgmt==null) ? null : (f.rent||0)+(f.mgmt||0)],
          ["保証料＋引落手数料", hosho(k)],
          ["電気", f.denki],
          ["ガス", f.gas],
          ["水道", f.water],
        ];
        (f.extra||[]).forEach(x => fixedRows.push([x.name, x.amount]));
        const varRows  = mo.categories.map(c => [c, catAmount(k,c)]);
        const cashRows = hasCash ? [
          ["先月残額", mo.cash.start],
          ["合計入金", mo.cash.deposit],
          ["合計出金", cashSpent(k)],
        ] : [];

        const head = hasCash ? ["固定費","金額","変動費","金額2","現金","金額3"]
                             : ["固定費","金額","変動費","金額2"];
        L.push(row(head));
        const n = Math.max(fixedRows.length, varRows.length, cashRows.length);
        for(let r=0; r<n; r++){
          const fr = fixedRows[r] || ["",null], vr = varRows[r] || ["",null];
          const cells = [fr[0], yen(fr[1]), vr[0], yen(vr[1])];
          if(hasCash){ const cr = cashRows[r] || ["",null]; cells.push(cr[0], yen(cr[1])); }
          L.push(row(cells));
        }
        const tot = ["合計", yen(fixedTotal(k)), "合計", yen(varTotal(k))];
        if(hasCash) tot.push("今月残額", yen(cashRemain(k)));
        L.push(row(tot));
      }
      files.push({name:`We_${tag}-主表.csv`, text:L.join("\r\n")});
    }

    /* 家計（毎日 entries のある月のみ） */
    if(mo.entries && mo.entries.length){
      const L = [];
      const cats = mo.categories.slice();
      L.push(row(["日付", ...cats, "何現金"]));
      const [yy,mm] = k.split("-").map(Number);
      const days = new Date(yy, mm, 0).getDate();
      const catTot = {}; cats.forEach(c=>catTot[c]=0); let cashTot=0;
      for(let d=1; d<=days; d++){
        const dk = `${yy}-${String(mm).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const de = mo.entries.filter(e=>e.date===dk);
        const cells = [`${yy}/${mm}/${d} (${WD[new Date(yy, mm-1, d).getDay()]})`];
        cats.forEach(c=>{
          const s = de.filter(e=>e.category===c).reduce((a,e)=>a+(e.amount||0),0);
          cells.push(s? yen(s):""); catTot[c]+=s;
        });
        const cs = de.reduce((a,e)=>a+(e.cash||0),0);
        cells.push(cs? yen(cs):""); cashTot+=cs;
        L.push(row(cells));
      }
      L.push(row(["", ...cats.map(()=>""), ""]));
      L.push(row(["合計", ...cats.map(c=>yen(catTot[c])), yen(cashTot)]));
      files.push({name:`We_${tag}-家計.csv`, text:L.join("\r\n")});
    }
  });

  return files;
}

function makeZip(entries){   // entries: [{name, data:Uint8Array}] → Blob（store 無圧縮・ライブラリ不要）
  const T = (function(){ const t=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
  const crc32 = b => { let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=T[(c^b[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
  const enc = new TextEncoder();
  const u16 = n => new Uint8Array([n&0xFF,(n>>>8)&0xFF]);
  const u32 = n => new Uint8Array([n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF]);
  const cat = (...a)=>{ const out=new Uint8Array(a.reduce((s,x)=>s+x.length,0)); let o=0; for(const x of a){ out.set(x,o); o+=x.length; } return out; };

  const local=[], central=[]; let offset=0;
  for(const e of entries){
    const nb=enc.encode(e.name), data=e.data, crc=crc32(data), sz=data.length;
    const lfh=cat(u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(nb.length),u16(0),nb);
    local.push(lfh, data);
    central.push(cat(u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),
      u16(nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nb));
    offset += lfh.length + data.length;
  }
  const cStart=offset; let cSize=0; for(const c of central) cSize+=c.length;
  const eocd=cat(u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cSize),u32(cStart),u16(0));
  return new Blob([...local, ...central, eocd], {type:"application/zip"});
}

function exportCSV(){
  const enc = new TextEncoder();
  const files = buildLedgerFiles();
  const entries = files.map(f => ({ name:f.name, data: enc.encode("\uFEFF" + f.text) }));  // BOM：Excel 日本語対策
  const blob = makeZip(entries);
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "We_帳簿.zip"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast("CSV(zip) を書き出しました ✓");
}
document.getElementById("btn-settings").addEventListener("click",openSettings);
/* v11: ヘッダから設定ページへ移動（ほぼ押さないものが常時 2 つ並んでいた） */
function exportBackup(){
  const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download="we-kakeibo-backup.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast("バックアップ(JSON)を書き出しました ✓");
}

/* ---------------- renderers (logic verbatim; restyled markup + motion hooks) ---------------- */
function renderHeader(){
  if(_stripHesan()) save();
  _zoneAway=_zoneAwayNow(); _renderZoneBar();
  const now=_nowYM();
  const chip = active<now ? '<span class="mchip past">過去</span>' : (active>now ? '<span class="mchip future">未来</span>' : '');
  document.getElementById("monthlabel").innerHTML=esc(labelOf(active))+chip;
  updateLastmod();
}

function renderRhythm(){
  const[y,m]=active.split("-").map(Number);
  const days=new Date(y,m,0).getDate(); const now=_nowYM(); const isCur=(active===now); const today=_todayD();
  const done=(active<now);                                     // 過去の月: 全部「走り終えた」
  let bars="";
  const dow0=new Date(y,m-1,1).getDay();                        // その月の1日の曜日(0=日)
  for(let d=1;d<=days;d++){
    let cls="bar";
    if(d===PAYDAY) cls+=" payday";                                   // 給料日の黄色は常に残す
    if(isCur&&d===today) cls+=" today";                          // 10日と今日が重なっても両方付ける
    else if(isCur&&d<today&&d!==PAYDAY) cls+=" past";                 // 給料日は past にしない(従来通り)
    if((dow0+d-1)%7===0 && d!==PAYDAY && !(isCur&&d===today)) cls+=" sun";  // 日曜だけ少し高く(週の区切り)
    bars+=`<div class="${cls}"></div>`;
  }
  return `<div class="rhythm ${done?'done':''}"><div class="bars">${bars}</div><div class="labels"><span>1</span><span class="pay" style="left:calc(1px + (100% - 2px) * ${(PAYDAY-0.5)/days})">${PAYDAY} 給料日</span><span>${days}</span></div></div>`;
}

/* ============================================================
   概観モード (v11)
   ・db は読むだけ。会計関数(compute.js)もそのまま呼ぶだけ。
   ・図は「narrow question に 1 つ答える」ものだけ:
       ① お金はどこへ行ったか(額度消耗) ② 使うペースは速いか遅いか ③ 何に使ったか
   ============================================================ */
let ovwMode = "viz";                    // "viz" | "list"（statFilter と同じ、端末内の表示設定）
let _ovwSwap=false;                     // 人が切り替えた時だけ true。render() は保存や同期でも走るので毎回は動かさない

/* その月の変動費を「日ごとの累計」にする。entries が無い月は null（＝比較できない） */
function _dailyCum(key){
  const mo=db.months[key]; if(!mo||!mo.entries||!mo.entries.length) return null;
  const [y,m]=key.split("-").map(Number), days=new Date(y,m,0).getDate();
  const per=new Array(days+1).fill(0);
  mo.entries.forEach(e=>{
    const d=Number(String(e.date||"").slice(8,10));
    if(d>=1&&d<=days) per[d]+=(e.amount||0);
  });
  const cum=[]; let t=0;
  for(let d=1;d<=days;d++){ t+=per[d]; cum.push(t); }
  return cum;
}
/* ペースの材料。予測は線形外挿（単純さを優先）。月初は不安定なので 7 日目まで出さない */
function _paceData(key){
  const cur=_dailyCum(key); if(!cur) return null;
  const [y,m]=key.split("-").map(Number), days=new Date(y,m,0).getDate();
  const isCur=(key===_nowYM());
  const upto=isCur?Math.min(_todayD(),days):days;          // 過去月は月末まで
  const prev=_dailyCum(shiftMonth(key,-1));                 // 先月に日次が無ければ null
  const now=cur[upto-1]||0;
  const prevAt=prev?(prev[Math.min(upto,prev.length)-1]||0):null;
  const canProject = isCur && upto>=7 && upto<days;         // 月初と月末は予測を出さない
  const proj = canProject ? Math.round(now/upto*days) : null;
  return {cur,prev,days,upto,now,prevAt,proj,
          projBal: proj==null?null:((db.months[key].start||0)+incomeTotal(key)-fixedTotal(key)-proj)};
}
function _spark(p){
  const W=300,H=64, mx=Math.max(p.now, p.prevAt||0, ...(p.prev||[0]))||1;
  const px=d=>((d-1)/Math.max(1,p.days-1))*W, py=v=>H-(v/mx)*(H-4);
  const line=(arr,n)=>arr.slice(0,n).map((v,i)=>`${px(i+1).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const prevLine = p.prev ? `<polyline class="prev" points="${line(p.prev,p.prev.length)}"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line class="base" x1="0" y1="${H}" x2="${W}" y2="${H}"/>${prevLine}
    <polyline class="now" points="${line(p.cur,p.upto)}"/>
    <circle class="dot" cx="${px(p.upto).toFixed(1)}" cy="${py(p.now).toFixed(1)}" r="4"/></svg>`;
}
function _ovwViz(k){
  const mo=db.months[k], avail=(mo.start||0)+incomeTotal(k);
  const fx=fixedTotal(k), vr=varTotal(k), rest=avail-fx-vr;
  const pct=v=>avail>0?Math.max(0,v/avail*100):0;
  const pre=_isPrePayday(k);
  /* ① お金の行き先 */
  const flow=`<div class="sec-h"><span class="sec-t">今月のお金の行き先</span></div>
    <div class="flow"><div class="flowtop"><span class="fl">使えるお金 <small>繰越 ＋ 入金</small></span>
      <span class="fv num">${fmt(avail)}</span></div>
      <div class="fbar"><i class="f1" style="width:${pct(fx)}%"></i><i class="f2" style="width:${pct(vr)}%"></i><i class="f3" style="width:${pct(rest)}%"></i></div>
      <div class="flegend">
        <div><span class="fsw s1"></span>固定費<b class="num">${fmt(fx)}</b><em>${pct(fx).toFixed(0)}%</em></div>
        <div><span class="fsw s2"></span>変動費<b class="num">${fmt(vr)}</b><em>${pct(vr).toFixed(0)}%</em></div>
        <div><span class="fsw s3"></span>残り<b class="num">${fmt(rest)}</b><em>${pct(rest).toFixed(0)}%</em></div>
      </div>${pre?`<div class="flownote num">${PAYDAY}日に 入金 ${fmt(incomeTotal(k))} が入り、固定費 ${fmt(fx)} が引き落とされます</div>`:''}</div>`;
  /* ② 支出のペース */
  const p=_paceData(k);
  let pace;
  if(!p){
    pace=`<div class="zero"><b>日ごとの記録がありません</b>この月は月ごとの合計だけです。日次記帳をすると、ここにペースが出ます。</div>`;
  }else if(p.prevAt==null){
    pace=`<div class="zero"><b>先月とは比べられません</b>先月は月ごとの合計だけで、日ごとの記録がありません。<br>日次記帳をした月どうしなら比べられます。</div>`;
  }else{
    const diff=p.prevAt-p.now, more=diff<0;
    pace=`<div class="pace">${_spark(p)}
      <div class="pacelb"><span>1日</span><span class="hi">${p.upto}日時点</span><span>${p.days}日</span></div>
      <div class="pacelb"><span class="hi">—— 今月</span><span>- - - 先月</span></div></div>
      <div class="verdict${more?' warn':''}">先月の同じ日より <span class="num">${fmt(Math.abs(diff))}</span> ${more?'多い':'少ない'}
      ${p.proj!=null?`<small class="num">このペースだと月末の変動費は約 ${fmt(p.proj)}、残高は約 ${fmt(p.projBal)}</small>`:''}</div>`;
  }
  /* ③ 何に使ったか */
  const PAL=["#9C8246","#AD786D","#997AA6","#628AA3","#548F8D","#87876E","#A97C53","#8E8289"];
  const cd=mo.categories.map((c,i)=>({n:c,v:catAmount(k,c),col:PAL[i%PAL.length]})).filter(x=>x.v>0)
           .sort((a,b)=>b.v-a.v);
  const cs=cd.reduce((a,x)=>a+x.v,0);
  const cats = cs<=0
    ? `<div class="zero">今月はまだ変動費がありません。</div>`
    : `<div class="cbar">${cd.map(x=>`<i style="width:${(x.v/cs*100).toFixed(1)}%;background:${x.col}"></i>`).join("")}</div>
       <div class="clegend">${cd.map(x=>`<div class="ci"><span class="csw" style="background:${x.col}"></span>${esc(x.n)}
         <span class="cv num">${fmt(x.v)}</span><span class="cp">${(x.v/cs*100).toFixed(0)}%</span></div>`).join("")}</div>`;
  const cr2=cashRemain(k);
  return `<div class="stack">
    <div class="sec">${flow}</div>
    <div class="sec"><div class="sec-h"><span class="sec-t">支出のペース</span></div>${pace}</div>
    <div class="sec"><div class="sec-h"><span class="sec-t">何に使ったか</span><span class="sec-v num">${fmt(vr)}</span></div>${cats}</div>
    ${cr2!=null?`<div class="sec"><div class="sec-h"><span class="sec-t">現金（サブ台帳）</span><span class="sec-v num">${fmt(cr2)}</span>
      <button class="editlink" data-edit="cash">編集</button></div>
      <div class="row"><span class="k" style="color:var(--ink-3)">残高の計算には入りません</span></div></div>`:''}
  </div>`;
}

function renderOverview(){
  const k=active, mo=db.months[k], f=mo.fixed, h=hosho(k);
  const bal=balance(k);
  const nowYM=_nowYM();
  const kari=_isKari(k), carryMonth=_isCarryMonth(k);
  const ed=(t,label)=>`<button class="editlink" data-edit="${t}">${label||'編集'}</button>`;
  /* 1〜9日は「入金前」: 入金と固定費はまだ起きていない扱いで表示だけ変える(データは 1 日から全額のまま) (REV-20260902-07a) */
  const pre=_isPrePayday(k);
  const preVar=varTotal(k), preBal=(mo.start||0)-preVar;
  const soon=(amount)=>pre?`<span class="soon">${PAYDAY}日から（予定 ${fmt(amount)}）</span>`:'';
  const dimCls=pre?' dim':'';
  // 月末リマインダー: 当月かつ月末まで7日以内のときだけ表示。タップで精算を開く
  let remind="";
  if(k===nowYM){
    const [ry,rm]=k.split("-").map(Number);
    const left=new Date(ry,rm,0).getDate()-_todayD();
    if(left>=0 && left<=7){
      const msg=left>0?`月末まで あと ${left} 日 — 精算をしてお金を合わせましょう`:`今日は月末です。精算をしましょう`;
      remind=`<div class="carrynote remind-only"><div>${msg}</div></div>`;
    }
  }
  // 概観 / リストの切替（既定は概観。端末内だけの表示設定で、データには入らない）
  const ovwSwitch=`<div class="modes" id="ovw-modes">
    <button class="md${ovwMode==="viz"?" on":""}" data-ovw="viz">概観</button>
    <button class="md${ovwMode==="list"?" on":""}" data-ovw="list">リスト</button></div>`;
  // 仮の繰越金の知らせ(今月だけ・精算で確定すると消える)
  const nag = (k===nowYM && kari) ? `<div class="carrynote nag"><div><b>${labelOf(k)}の精算がまだです。</b>繰越金 ${fmt(mo.start)} は仮の値（前月の残高に自動で追従）。精算で確定すると自動では変わらなくなります。</div></div>` : "";
  const emptyRow=(label,v,extraCls)=>`<div class="row"><span class="k">${label}</span><span class="v num ${v==null?'empty':((extraCls||'')+dimCls)}">${v==null?'未入力':fmtN(v)}</span></div>`;
  const fixedRows=`
    ${emptyRow('賃料',f.rent)}
    ${emptyRow('管理費',f.mgmt)}
    ${emptyRow('電気',f.denki)}
    ${f.totalDebit!=null && f.denki==null
      ? `<div class="row"><span class="k">引き落とし総額 <small>電気未入力・総額で計上</small></span><span class="v num calc">${fmtN(f.totalDebit)}</span></div>`
      : `<div class="row"><span class="k">保証料+引落手数料 <small>自動</small></span><span class="v num ${h==null?'empty':('calc'+dimCls)}">${h==null?'未入力':fmtN(h)}</span></div>`}
    ${emptyRow('ガス',f.gas)}
    ${emptyRow('水道',f.water)}
    ${(f.extra||[]).map(x=>`<div class="row"><span class="k">${esc(x.name)}</span><span class="v num ${x.amount==null?'empty':dimCls}">${x.amount==null?'未入力':fmtN(x.amount)}</span></div>`).join("")}`;
  const varRows=mo.categories.map(c=>`<div class="row"><span class="k">${esc(c)}</span><span class="v num">${fmtN(catAmount(k,c))}</span></div>`).join("");
  const c=mo.cash, cr=cashRemain(k);
  const unused=_cashUnusedSince();
  const unusedRow = unused ? `<div class="row"><span class="k" style="color:var(--ink-3)">${labelOf(unused)}から現金の使用なし</span></div>` : "";
  const cashCard=c?`<div class="card cash"><div class="head"><span class="t">現金 <span class="chip-pay">サブ</span></span><div class="right"><span class="tot num">${fmt(cr)}</span>${ed('cash')}</div></div>
      <div class="row"><span class="k">先月の現金残</span><span class="v num">${fmtN(c.start)}</span></div>
      <div class="row"><span class="k">今月の引き出し</span><span class="v num">${fmtN(c.deposit)}</span></div>
      <div class="row"><span class="k">今月の現金支出</span><span class="v num">${fmtN(cashSpent(k))}</span></div>
      <div class="row final"><span class="k">今月の現金残</span><span class="v num">${fmtN(cr)}</span></div>${unusedRow}</div>`
    :`<div class="card cash"><div class="head"><span class="t">現金 <span class="chip-pay">サブ</span></span>${ed('cash','追加')}</div><div class="row"><span class="k" style="color:var(--ink-3)">現金データなし</span></div></div>`;
  // 精算ボタン: 今月・来月だけ。過去月は状態表示に変わる(タップで説明)
  let hesanBtn="";
  if(carryMonth) hesanBtn=`<button class="balbtn ${kari?'urge':''}" id="open-hesan"><div class="txt"><b>精算する</b>(${Number(k.split("-")[1])}月の繰越金を決める)<br>${kari?'繰越金を確定してください':'手元のお金を計算して繰越金を合わせる'}</div><div class="go">›</div></button>`;
  else hesanBtn=`<button class="balbtn past" id="hesan-past"><div class="txt"><b>精算 ${mo.startConfirmed?'済み ✓':'（自動の繰越金）'}</b><br>過去の月は精算できません。繰越金は「入金 / 繰越金」の編集から</div><div class="go">›</div></button>`;
  const startChip = kari ? ' <span class="chip-kari">仮</span>' : ((mo.startConfirmed && carryMonth) ? ' <span class="chip-ok">確定</span>' : '');

  document.getElementById("v-overview").innerHTML=`
    ${renderRhythm()}
    <div class="hero"><div class="lbl">今月の残高${pre?` <span class="dim">（${PAYDAY}日の入金前）</span>`:''}</div>
      <div class="amt num"><span class="yen">¥</span><span id="hero-amt">${fmtN(pre?preBal:bal)}</span></div>
      ${pre
        ? `<div class="sub num"><span class="in">入金 ¥0</span><i>·</i>支出 ${fmt(preVar)}</div>
           <div class="pre num">${PAYDAY}日に 入金 <b>${fmt(incomeTotal(k))}</b>・固定費 <b>${fmt(fixedTotal(k))}</b><br>入金後の残高 <b>${fmt(bal)}</b></div>`
        : `<div class="sub num"><span class="in">入金 ${fmt(incomeTotal(k))}</span><i>·</i>支出 ${fmt(totalSpend(k))}</div>`}
      ${kari?`<div class="kari">繰越 仮 ${fmt(mo.start)} — 精算で確定されます</div>`:''}</div>
    ${hesanBtn}
    ${nag}
    ${remind}
    ${ovwSwitch}
    ${ovwMode==="viz" ? _ovwViz(k) : `
    <div class="stack">
      <div class="card"><div class="head"><span class="t">固定費</span><div class="right"><span class="tot num">${pre?'¥0':fmt(fixedTotal(k))}${soon(fixedTotal(k))}</span>${ed('fixed')}</div></div>${fixedRows}</div>
      <div class="card"><div class="head"><span class="t">変動費</span><div class="right"><span class="tot num">${fmt(varTotal(k))}</span>${(k>=nowYM?'<button class="editlink" id="edit-varcats">編集</button>':(mo.entries&&mo.entries.length?'<button class="editlink" data-edit="goentry">記帳へ</button>':'<button class="editlink" data-edit="vartot">編集</button>'))}</div></div>${varRows}</div>
      ${cashCard}
      <div class="card"><div class="head"><span class="t">入金 / 繰越金</span><div class="right"><span class="tot num">${pre?'¥0':fmt(incomeTotal(k))}${soon(incomeTotal(k))}</span>${ed('income')}</div></div>
        ${mo.income.map(i=>`<div class="row"><span class="k">${esc(i.who)}</span><span class="v num${dimCls}">${fmtN(i.amount)}</span></div>`).join("")}
        <div class="row"><span class="k">前月繰越${startChip}</span><span class="v num">${fmtN(mo.start)}</span></div></div>
    </div>`}`;
  const heroEl=document.getElementById("hero-amt"); const shown=Math.round(pre?preBal:bal);
  if(heroEl){ if(_heroPrev!==null && _heroPrev!==shown) rollNumber(heroEl,_heroPrev,shown); _heroPrev=shown; }
  document.querySelectorAll("#ovw-modes .md").forEach(b=>b.addEventListener("click",()=>{
    if(ovwMode===b.dataset.ovw) return; ovwMode=b.dataset.ovw; _ovwSwap=true; render();
  }));
  if(_ovwSwap){                                  // 切替の瞬間だけ animate（描画のたびには動かさない）
    _ovwSwap=false;
    if(!REDUCED){
      document.querySelector("#ovw-modes .md.on")?.classList.add("mdpop");
      document.querySelector("#v-overview .stack")?.classList.add("swapin");
    }
  }
  document.getElementById("edit-varcats")?.addEventListener("click",()=>editVarCats());
  document.getElementById("hesan-past")?.addEventListener("click",()=>openHesan());
}
let _heroPrev=null;

let _qKeep=null;   // 記帳直後に日付・分類・現金の選択を保つ (BUG-20260901-15)
function renderEntry(){
  const k=active, mo=db.months[k];
  if(mo.migrated && !(mo.entries&&mo.entries.length)){
    const rows=mo.categories.map(c=>`<div class="row"><span class="k">${esc(c)}</span><span class="v num">${fmtN(catAmount(k,c))}</span></div>`).join("");
    document.getElementById("v-entry").innerHTML=`<div class="migbox"><div class="mh">この月は移行データです。日次の明細はありません。分類ごとの合計を編集できます。</div>
      <div class="card" style="box-shadow:none;border:none;padding:0">${rows}</div>
      <button class="sheetbtn" id="go-vartot" style="margin-top:14px">合計を編集</button></div>`;
    document.getElementById("go-vartot")?.addEventListener("click",editVarTotals); return;
  }
  const cats=mo.categories;
  const cur=(k===_nowYM());
  const keep=_qKeep; _qKeep=null;
  const [yQ,mQ]=k.split("-").map(Number); const qLast=new Date(yQ,mQ,0).getDate();
  const todayStr=_todayStr();
  const qDefault=keep?keep.date:(cur?todayStr:"");
  const qMin=k+"-01", qMax=k+"-"+String(qLast).padStart(2,"0");
  const initCat=(keep && cats.includes(keep.cat))?keep.cat:cats[0];
  let chips=cats.map(c=>`<button class="chip ${c===initCat?'on':''}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  const byDate={}; (mo.entries||[]).forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
  const dates=Object.keys(byDate).sort().reverse();
  const wd=["日","月","火","水","木","金","土"];
  let dayHtml=dates.map(d=>{
    const items=byDate[d]; const tot=items.reduce((a,e)=>a+e.amount,0);
    const dd=Number(d.split("-")[2]); const w=wd[new Date(d).getDay()];
    const tags=items.map(e=>`<span class="tag ${e.cash?'cash':''}" data-eid="${e.id}">${esc(e.category)} ${fmt(e.amount)}${e.cash?' · 現':''}</span>`).join("");
    return `<div class="day"><div class="date"><div class="d num">${dd}</div><div class="w">${w}</div></div><div class="items">${tags}</div><div class="dtot num">${fmt(tot)}</div></div>`;
  }).join("");
  if(!dates.length) dayHtml=`<div class="zero"><b>${labelOf(active)}の記録はまだありません</b>分類を選んで金額を入れると、ここに日ごとに並びます。</div>`;
  const now=_nowYM();
  const bar = cur ? "" : `<div class="entrybar"><span><b>${labelOf(k)}</b> に記帳します<small>（今日は ${_md(_todayStr())}）</small></span><button class="mini" id="q-gonow">今月へ</button></div>`;
  const quick = `<div class="quickadd">${bar}<div class="qh">支出を追加</div>
      <div class="chips" id="chips">${chips}</div>
      <div class="field" style="margin:2px 0 10px"><div class="datefield"><input class="finput" type="date" id="qdate" value="${qDefault}" min="${qMin}" max="${qMax}">${_dfBtn("qdate",qDefault)}</div>${cur?'':'<div class="qhint">日付を必ず選んでください</div>'}</div>
      <div class="qrow"><div class="amt-in"><span>¥</span><input inputmode="numeric" id="amtin" placeholder="0"></div>
        <div class="cash-toggle ${keep&&keep.cash?'on':''}" id="cashtog"><div class="switch"></div>現金</div></div>
      <button class="addbtn" id="quick-add">追加する</button></div>`;
  document.getElementById("v-entry").innerHTML=`${quick}<div class="entry-list">${dayHtml}</div>`;
  let qcat=initCat, qcash=!!(keep&&keep.cash);
  document.getElementById("q-gonow")?.addEventListener("click",()=>{ _userNav=true; active=now; if(!db.months[now]) ensureMonth(now); render(); });
  document.getElementById("chips").addEventListener("click",e=>{ const c=e.target.closest(".chip"); if(!c)return; document.querySelectorAll("#chips .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); qcat=c.dataset.c; });
  document.getElementById("cashtog").addEventListener("click",function(){ this.classList.toggle("on"); qcash=this.classList.contains("on"); });
  document.getElementById("quick-add").addEventListener("click",async ()=>{
      const ra=_readAmt("amtin",{allowEmpty:false,allowZero:false,allowNegative:false});
    const di=document.getElementById("qdate"); const date=di.value;
    let bad=!ra.ok;
    if(!date){ _markBad(di,"日付を選んでください ✏️"); bad=true; }
    else if(date<qMin||date>qMax){ _markBad(di,labelOf(k)+" の日付を選んでください ✏️"); bad=true; }
    if(bad){ _focusFirstBad(); return; }
    if(!(await _confirmAwayEntry(date))) return;           // 東京の外: 日付の確認
    const amt=ra.v;
    const m=db.months[k]; m.entries=m.entries||[];              // 追加の瞬間に取り直す
    const id="e"+Date.now();
    m.entries.push({id:id,date:date,category:qcat,amount:amt,cash:qcash?amt:0}); save();
    _qKeep={date:date,cat:qcat,cash:qcash}; _lastAddedId=id;
    render();
    toast(_md(date)+" · "+qcat+" "+fmt(amt)+(qcash?"（現金）":"")+" を追加しました ✓");
    _highlightEntry(id);
  });
  document.querySelectorAll("[data-eid]").forEach(t=>t.addEventListener("click",()=>editEntry(t.dataset.eid)));
}

let statFilter="half", statCat=null;
/* ---------------- 淡彩 環形グラフ (当月の変動費・分類別、零依存 SVG) ---------------- */
function _donutHtml(k){
  const mo=db.months[k], cats=mo.categories;
  /* 分類色 v11: 日本の伝統色ベース・低彩度。全て surface(#F8F5F0) に対し対比 3.4 で揃えてある。
     芥子色 / 蘇芳鼠 / 藤鼠 / 藍鼠 / 錆浅葱 / 利休鼠 / 丁子 / 鳩羽鼠 */
  const PAL=["#9C8246","#AD786D","#997AA6","#628AA3","#548F8D","#87876E","#A97C53","#8E8289"];
  const data=cats.map(c=>({n:c,v:catAmount(k,c),col:PAL[cats.indexOf(c)%PAL.length]})).filter(x=>x.v>0);
  const total=data.reduce((a,x)=>a+x.v,0);
  if(total<=0) return '<div class="donut-empty">変動費の記録がまだありません</div>';
  const R=46, C=2*Math.PI*R, GAP=(data.length>1?4:0);
  let off=0, segs="";
  data.forEach(x=>{ const len=x.v/total*C, dash=Math.max(0.01,len-GAP);
    segs+=`<circle class="ring-seg" cx="60" cy="60" r="${R}" stroke="${x.col}" stroke-width="14" stroke-dasharray="${dash.toFixed(2)} ${(C-dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"></circle>`;
    off+=len; });
  const leg=data.map(x=>`<div class="li"><span class="sw" style="background:${x.col}"></span>${esc(x.n)}<span class="lv num">${fmt(x.v)} · ${Math.round(x.v/total*100)}%</span></div>`).join("");
  return `<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 120 120" width="150" height="150"><circle class="ring-track" cx="60" cy="60" r="${R}" stroke-width="14"></circle>${segs}</svg><div class="ctr"><div class="cn num">${fmt(total)}</div><div class="cl">変動費</div></div></div><div class="donut-leg">${leg}</div></div>`;
}

function renderStats(){
  const months=rangeMonths();
  const max=Math.max(1,...months.map(m=>totalSpend(m)));
  const trend=months.map((m,i)=>{ const v=totalSpend(m); const cur=m===active; const[,mm]=m.split("-");
    return `<div class="barrow"><div class="bl">${Number(mm)}月</div><div class="bt"><div class="bf ${cur?'cur':''}" data-w="${Math.max(2,v/max*100)}" style="width:0%;transition-delay:${i*35}ms"></div></div><div class="bv num">${fmtN(v)}</div></div>`; }).join("");
  /* 比較のボタンは「今の月の分類」だけを出す。
     - 区間の全分類の合併だと、一度だけ使った分類(例: 2026-05 のお見舞い)が
       ずっと居座る上、選択チェックが当月基準なので押しても弾かれていた(旧バグ)。
     - 今月その分類を再び使えば、その月から自動でここに現れ、過去と比較できる。 */
  const cats=db.months[active].categories;
  const noCats=!cats.length;                                     // 2024-10(引越しアーカイブ月)は分類が無い
  if(!noCats && (!statCat||!cats.includes(statCat))) statCat=cats[0];
  const catChips=noCats?"":cats.map(c=>`<button class="sc ${c===statCat?'on':''}" data-sc="${esc(c)}">${esc(c)}</button>`).join("");
  let now=0, deltaHtml="";
  if(noCats){
    deltaHtml=`<div class="base">この月には分類がありません</div>`;
  } else {
    const hist=months.filter(m=>m!==active).map(m=>catAmount(m,statCat)).filter(v=>v>0);
    const avg=hist.length?hist.reduce((a,v)=>a+v,0)/hist.length:0;
    now=catAmount(active,statCat);
    if(avg>0){ const pct=Math.round((now-avg)/avg*100); const up=pct>0;
      deltaHtml=`<div class="delta ${up?'up':'down'}">${up?'▲':'▼'} 平均より ${Math.abs(pct)}% ${up?'高い':'低い'}</div><div class="base">${statFilter==="half"?"直近6ヶ月":"直近1年"}の平均 ${fmt(avg)}(${hist.length}ヶ月)</div>`; }
    else deltaHtml=`<div class="base">比較できる過去データがありません</div>`;
  }

  document.getElementById("v-stats").innerHTML=`
    <div class="filters">
      <button class="fil ${statFilter==='half'?'on':''}" data-fil="half">直近6ヶ月</button>
      <button class="fil ${statFilter==='year'?'on':''}" data-fil="year">直近1年</button></div>
    <div class="panel"><div class="ph">月別の総支出 <small>固定+変動</small></div>${trend}</div>
    <div class="panel"><div class="ph">${labelOf(active)} の分類内訳</div>${_donutHtml(active)}</div>
    <div class="panel"><div class="ph">分類の比較 <small>今月 vs 過去の平均</small></div>
      <div class="selcat">${catChips}</div>
      <div class="cmp">${noCats?'':`<div class="now num"><span class="yen">¥</span>${fmtN(now)}</div>`}${deltaHtml}</div></div>`;
  requestAnimationFrame(()=>document.querySelectorAll("#v-stats .bf").forEach(b=>{ if(b.dataset.w) b.style.width=b.dataset.w+"%"; }));
  document.querySelectorAll("[data-fil]").forEach(b=>b.addEventListener("click",()=>{ statFilter=b.dataset.fil; renderStats(); }));
  document.querySelectorAll("[data-sc]").forEach(b=>b.addEventListener("click",()=>{ statCat=b.dataset.sc; renderStats(); }));
}

let _histOpenYears=null;   // 展開中の年の集合。null = 初回に「activeの年」を開く
function renderHistory(){
  const all=monthsAsc().reverse();
  const byYear={}, yearOrder=[];
  all.forEach(k=>{ const y=k.split("-")[0]; if(!byYear[y]){ byYear[y]=[]; yearOrder.push(y); } byYear[y].push(k); });
  if(_histOpenYears===null){ _histOpenYears=new Set(); const ay=active.split("-")[0]; _histOpenYears.add(byYear[ay]?ay:(yearOrder[0]||ay)); }
  let html="";
  yearOrder.forEach(y=>{
    const keys=byYear[y], open=_histOpenYears.has(y), latest=keys[0];   // keys降順 → [0]がその年の最新月
    const summary=`${keys.length}ヶ月 · 残高 ${fmt(balance(latest))}`;
    html+=`<div class="yr ${open?'open':''}" data-yr="${y}"><div class="yl"><span class="chev">›</span><span class="yy">${y}</span></div><div class="ys">${summary}</div></div>`;
    const rows=keys.map(k=>{ const m=k.split("-")[1]; const mo=db.months[k];
      const tag=mo.migrated?(mo.entries&&mo.entries.length?'':'<small>移行データ・合計のみ</small>'):(_isKari(k)?'<small>日次記帳 · 繰越 仮</small>':'<small>日次記帳</small>');
      return `<div class="hrow ${k===active?'active':''}" data-go="${k}"><div class="m">${Number(m)}月 ${tag}</div><div class="bal"><div class="b num">${fmt(balance(k))}</div><div class="bl">残高</div></div></div>`;
    }).join("");
    html+=`<div class="yr-body ${open?'open':''}" data-yrbody="${y}">${rows}</div>`;
  });
  document.getElementById("v-history").innerHTML=`<div class="hist">${html}<div class="foot">全 ${all.length} ヶ月 · 年をタップで開閉 / 月をタップで編集</div></div>`;
  document.querySelectorAll("[data-yr]").forEach(h=>h.addEventListener("click",()=>{ const y=h.dataset.yr; if(_histOpenYears.has(y)) _histOpenYears.delete(y); else _histOpenYears.add(y); renderHistory(); }));
  document.querySelectorAll("[data-go]").forEach(r=>r.addEventListener("click",()=>{ _userNav=true; active=r.dataset.go; switchTab("overview"); }));
}

/* 「最終更新 ○分前」の表示を定期的に更新 + 月替わり/ロックの再判定(午前 0 時の見張り) */
setInterval(()=>{ try{ updateLastmod(); }catch(e){} try{ if(!_sheetOpen && !_hesanOpen && !_dlgOpen) ensureToday(); else { _zoneAway=_zoneAwayNow(); _renderZoneBar(); } }catch(e){} }, 30000);

/* ============================================================
   下部タブ: 二拍の切替 (REV-20260902-07e)
   - 指が触れた瞬間(pointerdown)に切替(iOS のタブバーと同じ)。main.js の click 束縛は残し、
     直前に pointerdown で切替済みなら capture 段で止めて二重描画を防ぐ。
   - 一拍目: 触れたアイコンに細い輪。二拍目(130ms 後): 旧タブが縮み新タブが広がる(CSS)。
   - 文字の実幅を測って --lw に入れる(width:auto は animate できないため)。
   ============================================================ */
(function bindTabbar(){
  const bar=document.querySelector(".tabbar"); if(!bar) return;
  const tabs=Array.from(bar.querySelectorAll(".tab"));
  function measure(){
    tabs.forEach(t=>{ const lab=t.querySelector(".lab"); if(!lab) return;
      const cs=getComputedStyle(lab); const probe=document.createElement("span");
      probe.textContent=lab.textContent;
      probe.style.cssText="position:absolute;visibility:hidden;white-space:nowrap;line-height:1";
      probe.style.fontFamily=cs.fontFamily; probe.style.fontSize=cs.fontSize; probe.style.fontWeight=cs.fontWeight; probe.style.letterSpacing=cs.letterSpacing;
      document.body.appendChild(probe);
      const w=Math.ceil(probe.getBoundingClientRect().width+1); probe.remove();
      if(w>1) t.style.setProperty("--lw", w+"px"); });
  }
  measure();
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener("resize", measure);
  let lastDown=0;
  function pulse(t){ tabs.forEach(x=>x.classList.remove("pulse")); void t.offsetWidth; t.classList.add("pulse"); t.addEventListener("animationend", ()=>t.classList.remove("pulse"), {once:true}); }
  tabs.forEach(t=>{
    t.addEventListener("pointerdown", e=>{
      if(e.button && e.button!==0) return;
      if(t.classList.contains("on")) return;                     // 既に選択中: 軽い押下だけ(pressing は文書側で付く)
      pulse(t); lastDown=Date.now();
      if(typeof switchTab==="function") switchTab(t.dataset.v);   // 触れた瞬間に切替
    });
  });
  /* main.js の click(=switchTab) は pointerdown 直後なら止める(同じタブへの再描画を避ける) */
  bar.addEventListener("click", e=>{ const t=e.target.closest(".tab"); if(!t) return;
    if(Date.now()-lastDown<600 && t.classList.contains("on")){ e.stopPropagation(); e.preventDefault(); } }, true);
})();

/* ---------------- damping press feedback (pointer-driven, document-level so it survives re-renders) ---------------- */
(function(){
  var SEL=".iconbtn,.mnav button,.tab,.editlink,.chip,.tag,.sc,.fil,.del,.addrow,.carrynote button,.hp-del,.balbtn,.addbtn,.sheetbtn,.hrow,.hero,.mini";
  function _down(e){ var el=e.target.closest && e.target.closest(SEL); if(el && !el.disabled) el.classList.add("pressing"); }
  function _up(){ var els=document.querySelectorAll(".pressing"); for(var i=0;i<els.length;i++) els[i].classList.remove("pressing"); }
  document.addEventListener("pointerdown",_down,{passive:true});
  document.addEventListener("pointerup",_up,{passive:true});
  document.addEventListener("pointercancel",_up,{passive:true});
  document.addEventListener("pointerleave",_up,{passive:true});
  window.addEventListener("blur",_up);
})();
