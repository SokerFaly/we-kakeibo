"use strict";
/* ============================================================
   ui.js — presentation + interaction (redesign)
   Logic identical to the verified single-file version; only the
   markup styling and a native (zero-dependency) motion layer change.
   Pure compute/data/storage live in their own files, untouched.
   ============================================================ */

/* ---------------- last-modified time + save hook ---------------- */
// Stamp the data's last-modified time on every save — done here so storage.js stays byte-identical.
const _origSave = save;
save = function(){ db.lastModified = Date.now(); return _origSave.apply(this, arguments); };
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
  if(!db.lastModified){ el.innerHTML = ""; return; }
  el.innerHTML = '<span class="dot"></span>最終更新 ' + relTime(db.lastModified);
}

/* ---------------- motion: spring sampler + WAAPI (no libraries) ---------------- */
const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches);

// integrate a damped spring 0->1; return sampled progress frames + settle duration
function springSample(stiffness, damping, mass){
  const dt = 1/60; let x = 0, v = 0, t = 0; const frames = []; const maxT = 4;
  while(t < maxT){
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; frames.push(x); t += dt;
    if(Math.abs(1 - x) < 0.0008 && Math.abs(v) < 0.0008) break;
  }
  if(frames.length < 2) frames.push(1);
  return { frames, duration: Math.max(200, frames.length * dt * 1000) };
}
// presets tuned to the brief (stiffness 260–380 / damping 24–34 / mass 0.8–1.1)
const SP_SHEET = springSample(320, 30, 1.0);   // sheet settle — barely any overshoot
const SP_TAB   = springSample(340, 26, 0.9);   // tab indicator — a touch springier

// animate a transform along a spring (interruptible); build(value)->transform string
function springAnim(el, build, p0, p1, preset, onDone){
  if(REDUCED || !el.animate){ el.style.transform = build(p1); if(onDone) onDone(); return null; }
  const kf = preset.frames.map(p => ({ transform: build(p0 + (p1 - p0) * p) }));
  kf[kf.length - 1] = { transform: build(p1) };
  const anim = el.animate(kf, { duration: preset.duration, easing: "linear", fill: "forwards" });
  anim.onfinish = () => { el.style.transform = build(p1); try{ anim.cancel(); }catch(e){} if(onDone) onDone(); };
  return anim;
}

/* ---------------- floating bottom sheet ---------------- */
const overlay = document.getElementById("overlay"), sheet = document.getElementById("sheet");
let _sheetOpen = false;
function openSheet(html){
  const content = '<div class="sheet-grab" aria-hidden="true"></div>' + html;
  if(_sheetOpen){ sheet.innerHTML = content; attachSheetDrag(); return; } // already open: swap, no re-animate
  sheet.innerHTML = content; attachSheetDrag();
  sheet.style.transition = "none";
  sheet.style.transform = "translateY(100%)";
  overlay.classList.add("on");
  _sheetOpen = true; sheet.scrollTop = 0;
  requestAnimationFrame(() => {
    if(REDUCED){ sheet.style.transform = "translateY(0)"; return; }
    springAnim(sheet, v => "translateY(" + v + "%)", 100, 0, SP_SHEET);
  });
}
let _onSheetClose = null;
function closeSheet(){
  if(!_sheetOpen) return; _sheetOpen = false;
  if(_onSheetClose){ const cb=_onSheetClose; _onSheetClose=null; try{ cb(); }catch(e){} }
  if(REDUCED || !sheet.animate){ overlay.classList.remove("on"); sheet.innerHTML = ""; return; }
  sheet.style.transition = "transform .34s cubic-bezier(.4,0,1,1)";
  sheet.style.transform = "translateY(106%)";
  const done = () => {
    overlay.classList.remove("on");
    sheet.style.transition = "none"; sheet.style.transform = "translateY(0)"; sheet.innerHTML = "";
    sheet.removeEventListener("transitionend", done);
  };
  sheet.addEventListener("transitionend", done);
}
function attachSheetDrag(){
  const grab = sheet.querySelector(".sheet-grab"); if(!grab) return;
  let startY = 0, lastY = 0, lastT = 0, vel = 0, dy = 0, dragging = false;
  grab.addEventListener("pointerdown", e => {
    dragging = true; startY = lastY = e.clientY; lastT = performance.now(); vel = 0; dy = 0;
    sheet.style.transition = "none"; try{ grab.setPointerCapture(e.pointerId); }catch(_){}
  });
  grab.addEventListener("pointermove", e => {
    if(!dragging) return;
    dy = e.clientY - startY; if(dy < 0) dy = dy * 0.22;            // rubber-band pulling up
    const now = performance.now(), dt = now - lastT; if(dt > 0) vel = (e.clientY - lastY) / dt;
    lastY = e.clientY; lastT = now;
    sheet.style.transform = "translateY(" + dy + "px)";
  });
  const end = e => {
    if(!dragging) return; dragging = false; try{ grab.releasePointerCapture(e.pointerId); }catch(_){}
    if(dy > 120 || vel > 0.7){ closeSheet(); }
    else { sheet.style.transition = "transform .5s var(--spring)"; sheet.style.transform = "translateY(0)"; }
  };
  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
}
overlay.addEventListener("click", e => { if(e.target === overlay) closeSheet(); });

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

/* ---------------- editors (logic verbatim; restyled markup) ---------------- */
function editFixed(){
  const f=db.months[active].fixed;
  let extraHtml=(f.extra||[]).map((x,i)=>`<div class="frow" style="align-items:flex-end;margin-bottom:14px"><div class="field" style="margin-bottom:0"><label>その他の名前</label><input class="finput" data-ex="name" data-i="${i}" value="${x.name||""}"></div><div class="field" style="margin-bottom:0"><label>金額</label><input class="finput num" data-ex="amount" data-i="${i}" inputmode="numeric" value="${x.amount!=null?x.amount:""}"></div><button class="del" data-rmex="${i}" style="margin-bottom:10px">×</button></div>`).join("");
  openSheet(`<h2>固定費の編集</h2>
    <div class="desc">賃料・管理費は自動入力(変更可)。「引き落とし総額」と「電気」を入れると保証料を自動で逆算します。ガス・水道は手入力。</div>
    <div class="frow"><div class="field"><label>賃料</label><input class="finput num" id="f-rent" inputmode="numeric" value="${f.rent!=null?f.rent:""}"></div>
      <div class="field"><label>管理費</label><input class="finput num" id="f-mgmt" inputmode="numeric" value="${f.mgmt!=null?f.mgmt:""}"></div></div>
    <div class="field"><label>引き落とし総額 <span class="hint">(賃料+管理費+保証料+電気)</span></label><input class="finput num" id="f-total" inputmode="numeric" value="${f.totalDebit!=null?f.totalDebit:""}"></div>
    <div class="field"><label>電気</label><input class="finput num" id="f-denki" inputmode="numeric" value="${f.denki!=null?f.denki:""}"></div>
    <div class="computed"><span>保証料 + 引落手数料(自動)</span><span id="f-hosho">—</span></div>
    <div style="height:13px"></div>
    <div class="frow"><div class="field"><label>ガス</label><input class="finput num" id="f-gas" inputmode="numeric" value="${f.gas!=null?f.gas:""}"></div>
      <div class="field"><label>水道</label><input class="finput num" id="f-water" inputmode="numeric" value="${f.water!=null?f.water:""}"></div></div>
    ${extraHtml}
    <button class="addrow" id="f-addextra">+ その他の固定費を追加</button>
    <button class="sheetbtn" id="f-save">保存</button>`);
  function recompute(){
    const t=evalExpr(g("f-total")), d=evalExpr(g("f-denki")), r=evalExpr(g("f-rent")), m=evalExpr(g("f-mgmt"));
    const el=document.getElementById("f-hosho");
    if(t!=null&&d!=null){ el.textContent=fmt(t-(r||0)-(m||0)-d); } else el.textContent="—";
  }
  function g(id){ const e=document.getElementById(id); return e?e.value:""; }
  ["f-total","f-denki","f-rent","f-mgmt"].forEach(id=>document.getElementById(id).addEventListener("input",recompute));
  recompute();
  function snap(){ f.rent=evalExpr(g("f-rent")); f.mgmt=evalExpr(g("f-mgmt")); f.totalDebit=evalExpr(g("f-total")); f.denki=evalExpr(g("f-denki")); f.gas=evalExpr(g("f-gas")); f.water=evalExpr(g("f-water")); document.querySelectorAll('[data-ex]').forEach(inp=>{ const i=+inp.dataset.i,kk=inp.dataset.ex; if(f.extra[i]) f.extra[i][kk]= kk==="amount"?evalExpr(inp.value):inp.value; }); }
  document.getElementById("f-addextra").addEventListener("click",()=>{ f.extra=f.extra||[]; snap(); f.extra.push({name:"",amount:null}); editFixedReopen(); });
  document.querySelectorAll('[data-rmex]').forEach(b=>b.addEventListener("click",()=>{ snap(); f.extra.splice(+b.dataset.rmex,1); editFixedReopen(); }));
  document.getElementById("f-save").addEventListener("click",()=>{
    f.rent=evalExpr(g("f-rent")); f.mgmt=evalExpr(g("f-mgmt")); f.totalDebit=evalExpr(g("f-total"));
    f.denki=evalExpr(g("f-denki")); f.gas=evalExpr(g("f-gas")); f.water=evalExpr(g("f-water"));
    document.querySelectorAll('[data-ex]').forEach(inp=>{
      const i=+inp.dataset.i, k=inp.dataset.ex; if(!f.extra[i]) return;
      f.extra[i][k]= k==="amount"?evalExpr(inp.value):inp.value;
    });
    f.extra=(f.extra||[]).filter(x=>x.name||x.amount!=null);
    save(); closeSheet(); render();
  });
}
function editFixedReopen(){ editFixed(); }

function editIncome(){
  const mo=db.months[active];
  let rows=mo.income.map((i,idx)=>`<div class="frow"><div class="field"><label>名前</label><input class="finput" data-in="who" data-i="${idx}" value="${i.who}"></div><div class="field"><label>入金額</label><input class="finput num" data-in="amount" data-i="${idx}" inputmode="numeric" value="${i.amount!=null?i.amount:""}"></div></div>`).join("");
  openSheet(`<h2>入金 / 繰越金の編集</h2>
    <div class="desc">「今月の繰越金」は通常は精算で設定しますが、ここでも直接変更できます。</div>
    <div class="field"><label>今月の繰越金 <span class="hint">(＝先月の繰越)</span></label><input class="finput num" id="i-start" inputmode="numeric" value="${mo.start!=null?mo.start:""}"></div>
    <div style="height:6px"></div>${rows}
    <button class="sheetbtn" id="i-save">保存</button>`);
  document.getElementById("i-save").addEventListener("click",()=>{
    mo.start=evalExpr(document.getElementById("i-start").value)||0;
    document.querySelectorAll('[data-in]').forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.in; mo.income[i][k]= k==="amount"?(evalExpr(inp.value)||0):inp.value; });
    save(); closeSheet(); render();
  });
}
function editCash(){
  const c=db.months[active].cash||{start:0,deposit:0}; db.months[active].cash=c;
  openSheet(`<h2>現金の編集</h2>
    <div class="desc">現金だけを管理するサブ台帳です。日々の「現金で払った額」は記帳の現金タグから自動集計されます。</div>
    <div class="field"><label>先月の現金残</label><input class="finput num" id="c-start" inputmode="numeric" value="${c.start!=null?c.start:""}"></div>
    <div class="field"><label>今月の引き出し額</label><input class="finput num" id="c-dep" inputmode="numeric" value="${c.deposit!=null?c.deposit:""}"></div>
    <button class="sheetbtn" id="c-save">保存</button>`);
  document.getElementById("c-save").addEventListener("click",()=>{
    c.start=evalExpr(document.getElementById("c-start").value)||0; c.deposit=evalExpr(document.getElementById("c-dep").value)||0;
    save(); closeSheet(); render();
  });
}
function editVarTotals(){
  const mo=db.months[active];
  let rows=mo.categories.map(cat=>`<div class="frow"><div class="field"><label>${cat}</label><input class="finput num" data-ct="${cat}" inputmode="numeric" value="${mo.categoryTotals[cat]!=null?mo.categoryTotals[cat]:""}"></div></div>`).join("");
  openSheet(`<h2>変動費(合計)の編集</h2>
    <div class="desc">この月は移行データ(合計のみ)です。分類ごとの合計を直接編集できます。</div>
    ${rows}<button class="sheetbtn" id="vt-save">保存</button>`);
  document.getElementById("vt-save").addEventListener("click",()=>{
    document.querySelectorAll('[data-ct]').forEach(inp=>{ mo.categoryTotals[inp.dataset.ct]=evalExpr(inp.value)||0; });
    save(); closeSheet(); render();
  });
}
function editVarCats(reassignCat){
  const mo=db.months[active];
  const defaults=db.settings.defaultCategories||[];
  const cnt=cat=>(mo.entries||[]).filter(e=>e.category===cat).length;
  let rows=mo.categories.map(cat=>{
    if(defaults.includes(cat)) return `<div class="frow" style="align-items:center;margin-bottom:13px"><span style="flex:1;font-size:14.5px;color:var(--ink)">${cat}</span></div>`;
    if(reassignCat===cat){
      const opts=mo.categories.filter(c=>c!==cat).map(c=>`<option value="${c}">${c}</option>`).join("");
      return `<div class="frow" style="flex-wrap:wrap;gap:8px;background:var(--clay-soft);padding:10px;border-radius:12px"><div class="field" style="flex:1 1 100%"><label>「${cat}」の記録(${cnt(cat)}件)を移動 →</label><select class="finput" id="vc-target">${opts}</select></div><button class="sheetbtn danger" id="vc-domove" style="flex:1;margin:0">移動して削除</button><button class="addrow" id="vc-cancel" style="flex:0 0 auto;margin:0;width:auto;padding:0 14px">キャンセル</button></div>`;
    }
    return `<div class="frow" style="align-items:center;margin-bottom:13px"><span style="flex:1;font-size:14.5px;color:var(--ink)">${cat}</span><button class="del" data-rmcat="${cat}">×</button></div>`;
  }).join("");
  openSheet(`<h2>変動費の分類</h2>
    <div class="desc">この月の大分類です。元の5つは固定。新しい分類を追加・削除できます。合計は記帳から自動集計され、翌月は5つに戻ります。</div>
    ${rows}
    <button class="addrow" id="vc-add">+ 変動費の分類を追加</button>
    <input class="finput" id="vc-newcat" placeholder="新しい分類名" style="display:none;margin-top:8px">
    <button class="sheetbtn" id="vc-done" style="margin-top:14px">完了</button>`);
  const newcat=document.getElementById("vc-newcat");
  document.getElementById("vc-add").addEventListener("click",()=>{ newcat.style.display="block"; newcat.focus(); });
  const commitAdd=()=>{ const n=newcat.value.trim(); if(n && !mo.categories.includes(n)){ mo.categories.push(n); save(); } editVarCats(); };
  newcat.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); commitAdd(); } else if(e.key==="Escape"){ newcat.style.display="none"; newcat.value=""; } });
  document.querySelectorAll('[data-rmcat]').forEach(b=>b.addEventListener("click",()=>{ const cat=b.dataset.rmcat; if(cnt(cat)>0){ editVarCats(cat); } else { mo.categories=mo.categories.filter(c=>c!==cat); save(); editVarCats(); } }));
  document.getElementById("vc-domove")?.addEventListener("click",()=>{ const t=document.getElementById("vc-target").value; (mo.entries||[]).forEach(e=>{ if(e.category===reassignCat) e.category=t; }); mo.categories=mo.categories.filter(c=>c!==reassignCat); save(); editVarCats(); });
  document.getElementById("vc-cancel")?.addEventListener("click",()=>editVarCats());
  document.getElementById("vc-done").addEventListener("click",()=>{ closeSheet(); });
  _onSheetClose=()=>render();
}
function editEntry(id){
  const mo=db.months[active]; const e=id?mo.entries.find(x=>x.id===id):null;
  const cats=mo.categories;
  const [ey,em]=active.split("-").map(Number); const eMin=active+"-01", eMax=active+"-"+String(new Date(ey,em,0).getDate()).padStart(2,"0");
  const eDefault=e?e.date:(isCurrentRealMonth(active)?active+"-"+String(new Date().getDate()).padStart(2,"0"):eMin);
  let chips=cats.map(c=>`<button class="chip ${e&&e.category===c?'on':(!e&&c===cats[0]?'on':'')}" data-c="${c}">${c}</button>`).join("");
  openSheet(`<h2>${e?"記録を編集":"記録を追加"}</h2>
    <div class="field"><label>日付</label><input class="finput" id="e-date" type="date" value="${eDefault}" min="${eMin}" max="${eMax}"></div>
    <div class="field"><label>分類</label><div class="chips" id="e-chips">${chips}</div></div>
    <div class="qrow"><div class="amt-in"><span>¥</span><input inputmode="numeric" id="e-amt" placeholder="0" value="${e?e.amount:''}"></div>
      <div class="cash-toggle ${e&&e.cash?'on':''}" id="e-cash"><div class="switch"></div>現金</div></div>
    <button class="sheetbtn" id="e-save" style="margin-top:16px">${e?"保存":"追加する"}</button>
    ${e?'<button class="sheetbtn danger" id="e-del">削除</button>':''}`);
  let cat=e?e.category:cats[0], isCash=!!(e&&e.cash);
  document.getElementById("e-chips").addEventListener("click",ev=>{ const c=ev.target.closest(".chip"); if(!c) return; document.querySelectorAll("#e-chips .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); cat=c.dataset.c; });
  document.getElementById("e-cash").addEventListener("click",function(){ this.classList.toggle("on"); isCash=this.classList.contains("on"); });
  document.getElementById("e-save").addEventListener("click",()=>{
    const amt=evalExpr(document.getElementById("e-amt").value); if(!amt){ return; }
    const date=document.getElementById("e-date").value||active+"-01";
    if(e){ e.category=cat; e.amount=amt; e.cash=isCash?amt:0; e.date=date; }
    else{ mo.entries.push({id:"e"+Date.now(),date:date,category:cat,amount:amt,cash:isCash?amt:0}); }
    save(); closeSheet(); render();
  });
  if(e){ document.getElementById("e-del").addEventListener("click",()=>{ mo.entries=mo.entries.filter(x=>x.id!==id); save(); closeSheet(); render(); }); }
}

/* ---------------- 精算 draft (logic verbatim) ---------------- */
function openHesan(){
  const mo=db.months[active];
  const P=db.settings.people;
  let defRows = mo.hesan && mo.hesan.rows ? mo.hesan.rows
    : [ {label:P[0]+" pay",expr:""},{label:P[0]+" 現金",expr:""},{label:P[1]+" 現金",expr:""},{label:P[1]+" pay",expr:""},{label:P[1]+" カード",expr:""} ];
  let yzExpr = (mo.hesan && mo.hesan.yeonZan!=null) ? String(mo.hesan.yeonZan) : "";
  let initExpr = (mo.hesan && mo.hesan.initAmount!=null) ? String(mo.hesan.initAmount) : "";   // 初期金額の上書き(任意)。空欄=自動(公式値)
  function carry(){ return mo.start!=null?mo.start:0; }                                          // 今月の繰越金(前月繰越)=読み取り専用
  function rowRight(expr){ const v=evalExpr(expr); if(v==null) return '未入力'; return /[+\-*/]/.test(String(expr)) ? fmtN(v) : ''; } // 数値のみ→右は空、式→計算結果
  function rowHtml(r,i){ return `<div class="hesanrow"><input class="hi hl-edit" data-hl="${i}" value="${r.label}" style="width:80px;border:none;background:none;font-size:12.5px;color:var(--ink);padding:0;flex:none"><input class="hi" data-he="${i}" value="${r.expr||''}" placeholder="例: 5349+890"><span class="he">${rowRight(r.expr)}</span><button class="del" data-del="${i}">×</button></div>`; }
  function calcTotal(){ let t=0; defRows.forEach(r=>{ const v=evalExpr(r.expr); if(v!=null) t+=v; }); return t; }
  function initSuggest(total){ const yz=evalExpr(yzExpr); return yz==null?null:Math.round(total-yz); } // 初期金額 = 今月の繰越金 ＋ 差額 = 実際 − 相手残高
  function diffHtml(total){
    const yz=evalExpr(yzExpr);
    const theoryLine=`<div class="htotal" style="border-top:1px dashed var(--hair);margin-top:0"><span style="color:var(--ink-2)">理論上の残高 <small style="font-weight:400;color:var(--ink-3)">(${P[1]}残高 ＋ 繰越金)</small></span><span class="num" style="color:var(--ink-2)">${yz!=null?fmt(yz+carry()):'—'}</span></div>`;
    if(yz==null) return theoryLine+`<div class="htotal" style="border-top:1px dashed var(--hair);margin-top:0"><span style="color:var(--ink-3)">差額(実際 − 理論)</span><span style="color:var(--ink-3)">—</span></div>`;
    const d=Math.round(total-(yz+carry())); const col=d>0?'var(--sage)':(d<0?'var(--clay)':'var(--ink)'); const sign=d>0?'+':(d<0?'−':'±'); const word=d>0?'多い・余り':(d<0?'少ない・不足':'一致');
    return theoryLine+`<div class="htotal" style="border-top:1px dashed var(--hair);margin-top:0"><span>差額(実際 − 理論)</span><span style="color:${col}">${sign}¥${Math.abs(d).toLocaleString("ja-JP")} <small style="font-weight:400;color:var(--ink-2)">${word}</small></span></div>`;
  }
  function initHint(total){ const s=initSuggest(total); return s!=null ? ('空欄なら自動 '+fmt(s)) : ('※ '+P[1]+'残高を入れると自動計算'); }
  function initPh(total){ const s=initSuggest(total); return s!=null ? fmtN(s) : ''; }
  function saveDraft(){ const el=document.getElementById("he-init"); const ov=(el && el.value.trim())?evalExpr(el.value):null; mo.hesan={rows:defRows,yeonZan:evalExpr(yzExpr),initAmount:ov}; save(); }
  function build(){
    const total=calcTotal();
    openSheet(`<h2>精算(下書き)</h2>
      <div class="desc">手元のお金を計算して、今月の<b>初期金額</b>(繰越金)を出すための下書きです。記帳データとは連動しません。各欄は <b>5349+890</b> のように式で書けます。</div>
      <div id="he-rows">${defRows.map(rowHtml).join("")}</div>
      <button class="addrow" id="he-add">+ 行を追加</button>
      <div class="htotal"><span>実際に残ったお金</span><span class="num" id="he-total">${fmt(total)}</span></div>
      <div class="htotal" style="border-top:1px dashed var(--hair)"><span style="color:var(--ink-2)">今月の繰越金 <small style="font-weight:400;color:var(--ink-3)">前月繰越・自動</small></span><span class="num" style="color:var(--ink-2)">${fmt(carry())}</span></div>
      <div class="field" style="margin:10px 0 2px"><label>${P[1]}残高 <span class="hint">手入力</span></label><input class="finput num" id="he-yeon" inputmode="numeric" value="${yzExpr}" placeholder="理論上 残るはずの金額"></div>
      <div id="he-diffbox">${diffHtml(total)}</div>
      <div class="field" style="margin:10px 0 2px"><label>初期金額（今月の繰越金 ＋ 差額） <span class="hint" id="he-init-hint">${initHint(total)}</span></label><input class="finput num" id="he-init" inputmode="numeric" value="${initExpr}" placeholder="${initPh(total)}"></div>
      <button class="sheetbtn" id="he-setinit">初期金額（今月の繰越金 ＋ 差額）を設定</button>`);
    function refresh(){ const t=calcTotal(); document.getElementById("he-total").textContent=fmt(t); document.getElementById("he-diffbox").innerHTML=diffHtml(t); const h=document.getElementById("he-init-hint"); if(h) h.textContent=initHint(t); const ie=document.getElementById("he-init"); if(ie) ie.placeholder=initPh(t); }
    document.querySelectorAll('[data-he]').forEach(inp=>inp.addEventListener("input",()=>{ defRows[+inp.dataset.he].expr=inp.value; inp.parentNode.querySelector(".he").textContent=rowRight(inp.value); refresh(); }));
    document.querySelectorAll('[data-hl]').forEach(inp=>inp.addEventListener("input",()=>{ defRows[+inp.dataset.hl].label=inp.value; }));
    document.querySelectorAll('[data-del]').forEach(b=>b.addEventListener("click",()=>{ defRows.splice(+b.dataset.del,1); build(); }));
    document.getElementById("he-add").addEventListener("click",()=>{ defRows.push({label:"項目",expr:""}); build(); });
    document.getElementById("he-yeon").addEventListener("input",function(){ yzExpr=this.value; refresh(); });
    document.getElementById("he-init").addEventListener("input",function(){ initExpr=this.value; });
    document.getElementById("he-setinit").addEventListener("click",()=>{ const ie=document.getElementById("he-init"); const v=(ie && ie.value.trim())?evalExpr(ie.value):initSuggest(calcTotal()); if(v!=null) mo.start=Math.round(v); _onSheetClose=null; saveDraft(); closeSheet(); render(); });
    _onSheetClose = saveDraft;
  }
  build();
}

/* ---------------- settings / export (logic verbatim) ---------------- */
function openSettings(){
  const S=db.settings;
  openSheet(`<h2>設定</h2>
    <div class="desc">既定値(新しい月を作るときに使われます)。すべて変更できます。</div>
    <div class="frow"><div class="field"><label>名前 1</label><input class="finput" id="s-p0" value="${S.people[0]}"></div>
      <div class="field"><label>名前 2</label><input class="finput" id="s-p1" value="${S.people[1]}"></div></div>
    <div class="field"><label>既定の入金(1人あたり)</label><input class="finput num" id="s-inc" inputmode="numeric" value="${S.defaultIncome}"></div>
    <div class="frow"><div class="field"><label>既定の賃料</label><input class="finput num" id="s-rent" inputmode="numeric" value="${S.defaultRent}"></div>
      <div class="field"><label>既定の管理費</label><input class="finput num" id="s-mgmt" inputmode="numeric" value="${S.defaultMgmt}"></div></div>
    <div class="field"><label>既定の分類 <span class="hint">(カンマ区切り)</span></label><input class="finput" id="s-cats" value="${S.defaultCategories.join("、")}"></div>
    <button class="sheetbtn" id="s-save">保存</button>
    <button class="sheetbtn ghost" id="s-csv">月別 CSV を書き出す（zip・Excel 用）</button>`);
  document.getElementById("s-save").addEventListener("click",()=>{
    S.people=[document.getElementById("s-p0").value||"太郎",document.getElementById("s-p1").value||"花子"];
    S.defaultIncome=evalExpr(document.getElementById("s-inc").value)||100000;
    S.defaultRent=evalExpr(document.getElementById("s-rent").value)||0;
    S.defaultMgmt=evalExpr(document.getElementById("s-mgmt").value)||0;
    S.defaultCategories=document.getElementById("s-cats").value.split(/[、,]/).map(s=>s.trim()).filter(Boolean);
    save(); closeSheet(); render();
  });
  document.getElementById("s-csv").addEventListener("click",exportCSV);
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
}
document.getElementById("btn-settings").addEventListener("click",openSettings);
document.getElementById("btn-export").addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download="we-kakeibo-backup.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});

/* ---------------- renderers (logic verbatim; restyled markup + motion hooks) ---------------- */
function renderHeader(){ document.getElementById("monthlabel").textContent=labelOf(active); positionTabIndicator(true); updateLastmod(); }

function renderRhythm(){
  const[y,m]=active.split("-").map(Number);
  const days=new Date(y,m,0).getDate(); const isCur=isCurrentRealMonth(active); const today=new Date().getDate();
  let bars="";
  for(let d=1;d<=days;d++){
    let cls="bar"; if(d===10)cls+=" payday"; else if(isCur&&d===today)cls+=" today"; else if(isCur&&d<today)cls+=" past";
    bars+=`<div class="${cls}"></div>`;
  }
  return `<div class="rhythm"><div class="bars">${bars}</div><div class="labels"><span>1</span><span class="pay">10 給料日</span><span>${days}</span></div></div>`;
}

function renderOverview(){
  const k=active, mo=db.months[k], f=mo.fixed, h=hosho(k);
  const bal=balance(k);
  const nowYM=new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0");
  // 月末リマインダー: 当月かつ月末まで7日以内のときだけ表示。タップで精算を開く
  let remind="";
  if(isCurrentRealMonth(k)){
    const [ry,rm]=k.split("-").map(Number);
    const left=new Date(ry,rm,0).getDate()-new Date().getDate();
    if(left>=0 && left<=7){
      const msg=left>0?`月末まで あと ${left} 日 — 精算をしてお金を合わせましょう`:`今日は月末です。精算をしましょう`;
      remind=`<div class="carrynote" id="monthend-remind" style="cursor:pointer"><div>${msg}</div><div style="font-size:18px;color:var(--clay);line-height:1">›</div></div>`;
    }
  }
  const fixedRows=`
    <div class="row"><span class="k">賃料</span><span class="v num">${fmt(f.rent)}</span></div>
    <div class="row"><span class="k">管理費</span><span class="v num">${fmt(f.mgmt)}</span></div>
    <div class="row"><span class="k">電気</span><span class="v num ${f.denki==null?'empty':''}">${f.denki==null?'未入力':fmt(f.denki)}</span></div>
    <div class="row"><span class="k">保証料+引落手数料 <small>自動</small></span><span class="v num ${h==null?'empty':'calc'}">${h==null?'未入力':fmt(h)}</span></div>
    <div class="row"><span class="k">ガス</span><span class="v num ${f.gas==null?'empty':''}">${f.gas==null?'未入力':fmt(f.gas)}</span></div>
    <div class="row"><span class="k">水道</span><span class="v num ${f.water==null?'empty':''}">${f.water==null?'未入力':fmt(f.water)}</span></div>
    ${(f.extra||[]).map(x=>`<div class="row"><span class="k">${x.name}</span><span class="v num">${fmt(x.amount)}</span></div>`).join("")}`;
  const varRows=mo.categories.map(c=>`<div class="row"><span class="k">${c}</span><span class="v num">${fmt(catAmount(k,c))}</span></div>`).join("");
  const c=mo.cash, cr=cashRemain(k);
  const cashCard=c?`<div class="card cash"><div class="head"><span class="t">現金 <span class="chip-pay">サブ</span></span><div class="right"><span class="tot num">${fmt(cr)}</span><button class="editlink" data-edit="cash">編集</button></div></div>
      <div class="row"><span class="k">先月の現金残</span><span class="v num">${fmt(c.start)}</span></div>
      <div class="row"><span class="k">今月の引き出し</span><span class="v num">${fmt(c.deposit)}</span></div>
      <div class="row"><span class="k">今月の現金支出</span><span class="v num">${fmt(cashSpent(k))}</span></div>
      <div class="row final"><span class="k">今月の現金残</span><span class="v num">${fmt(cr)}</span></div></div>`
    :`<div class="card cash"><div class="head"><span class="t">現金 <span class="chip-pay">サブ</span></span><button class="editlink" data-edit="cash">追加</button></div><div class="row"><span class="k" style="color:var(--ink-3)">現金データなし</span></div></div>`;

  document.getElementById("v-overview").innerHTML=`
    ${renderRhythm()}
    <div class="hero"><div class="lbl">今月の残高</div>
      <div class="amt num"><span class="yen">¥</span><span id="hero-amt">${fmtN(bal)}</span></div>
      <div class="sub num"><span class="in">入金 ${fmt(incomeTotal(k))}</span><i>·</i>支出 ${fmt(totalSpend(k))}</div></div>
    <button class="balbtn" id="open-hesan"><div class="txt"><b>精算する</b>(月末の計算)<br>手元のお金を計算して繰越金を合わせる</div><div class="go">›</div></button>
    ${remind}
    <div class="stack">
      <div class="card"><div class="head"><span class="t">固定費</span><div class="right"><span class="tot num">${fmt(fixedTotal(k))}</span><button class="editlink" data-edit="fixed">編集</button></div></div>${fixedRows}</div>
      <div class="card"><div class="head"><span class="t">変動費</span><div class="right"><span class="tot num">${fmt(varTotal(k))}</span>${k>=nowYM?'<button class="editlink" id="edit-varcats">編集</button>':(mo.entries&&mo.entries.length?'<button class="editlink" data-edit="goentry">記帳へ</button>':'<button class="editlink" data-edit="vartot">編集</button>')}</div></div>${varRows}</div>
      ${cashCard}
      <div class="card"><div class="head"><span class="t">入金 / 繰越金</span><div class="right"><span class="tot num">${fmt(incomeTotal(k))}</span><button class="editlink" data-edit="income">編集</button></div></div>
        ${mo.income.map(i=>`<div class="row"><span class="k">${i.who}</span><span class="v num">${fmt(i.amount)}</span></div>`).join("")}
        <div class="row"><span class="k">前月繰越</span><span class="v num">${fmt(mo.start)}</span></div></div>
    </div>`;
  const heroEl=document.getElementById("hero-amt");
  if(heroEl){ if(_heroPrev!==null && _heroPrev!==Math.round(bal)) rollNumber(heroEl,_heroPrev,Math.round(bal)); _heroPrev=Math.round(bal); }
  document.getElementById("monthend-remind")?.addEventListener("click",openHesan);
  document.getElementById("edit-varcats")?.addEventListener("click",()=>editVarCats());
}
let _heroPrev=null;

function renderEntry(){
  const k=active, mo=db.months[k];
  if(mo.migrated && !(mo.entries&&mo.entries.length)){
    const rows=mo.categories.map(c=>`<div class="row"><span class="k">${c}</span><span class="v num">${fmt(catAmount(k,c))}</span></div>`).join("");
    document.getElementById("v-entry").innerHTML=`<div class="migbox"><div class="mh">この月は移行データです。日次の明細はありません。分類ごとの合計を編集できます。</div>
      <div class="card" style="box-shadow:none;border:none;padding:0">${rows}</div>
      <button class="sheetbtn" id="go-vartot" style="margin-top:14px">合計を編集</button></div>`;
    document.getElementById("go-vartot").addEventListener("click",editVarTotals); return;
  }
  const cats=mo.categories;
  const [yQ,mQ]=k.split("-").map(Number); const qLast=new Date(yQ,mQ,0).getDate();
  const qDefault=isCurrentRealMonth(k)?k+"-"+String(new Date().getDate()).padStart(2,"0"):k+"-01";
  const qMin=k+"-01", qMax=k+"-"+String(qLast).padStart(2,"0");
  let chips=cats.map((c,i)=>`<button class="chip ${i===0?'on':''}" data-c="${c}">${c}</button>`).join("");
  const byDate={}; (mo.entries||[]).forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
  const dates=Object.keys(byDate).sort().reverse();
  const wd=["日","月","火","水","木","金","土"];
  let dayHtml=dates.map(d=>{
    const items=byDate[d]; const tot=items.reduce((a,e)=>a+e.amount,0);
    const dd=Number(d.split("-")[2]); const w=wd[new Date(d).getDay()];
    const tags=items.map(e=>`<span class="tag ${e.cash?'cash':''}" data-eid="${e.id}">${e.category} ${fmt(e.amount)}${e.cash?' · 現':''}</span>`).join("");
    return `<div class="day"><div class="date"><div class="d num">${dd}</div><div class="w">${w}</div></div><div class="items">${tags}</div><div class="dtot num">${fmt(tot)}</div></div>`;
  }).join("");
  if(!dates.length) dayHtml=`<div class="listhint">まだ記録がありません。上から追加できます。</div>`;
  document.getElementById("v-entry").innerHTML=`
    <div class="quickadd"><div class="qh">支出を追加</div>
      <div class="chips" id="chips">${chips}</div>
      <div style="margin:2px 0 10px"><input class="finput" type="date" id="qdate" value="${qDefault}" min="${qMin}" max="${qMax}" style="font-size:14px"></div>
      <div class="qrow"><div class="amt-in"><span>¥</span><input inputmode="numeric" id="amtin" placeholder="0"></div>
        <div class="cash-toggle" id="cashtog"><div class="switch"></div>現金</div></div>
      <button class="addbtn" id="quick-add">追加する</button></div>
    <div class="entry-list">${dayHtml}</div>`;
  let qcat=cats[0], qcash=false;
  document.getElementById("chips").addEventListener("click",e=>{ const c=e.target.closest(".chip"); if(!c||c.classList.contains("add"))return; document.querySelectorAll("#chips .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); qcat=c.dataset.c; });
  document.getElementById("cashtog").addEventListener("click",function(){ this.classList.toggle("on"); qcash=this.classList.contains("on"); });
  document.getElementById("quick-add").addEventListener("click",()=>{
    const amt=evalExpr(document.getElementById("amtin").value); if(!amt) return;
    const date=document.getElementById("qdate").value || qDefault;
    mo.entries.push({id:"e"+Date.now(),date:date,category:qcat,amount:amt,cash:qcash?amt:0}); save(); render();
  });
  document.querySelectorAll("[data-eid]").forEach(t=>t.addEventListener("click",()=>editEntry(t.dataset.eid)));
}

let statFilter="half", statCat=null;
function renderStats(){
  const months=rangeMonths();
  const max=Math.max(1,...months.map(m=>totalSpend(m)));
  const trend=months.map((m,i)=>{ const v=totalSpend(m); const cur=m===active; const[,mm]=m.split("-");
    return `<div class="barrow"><div class="bl">${Number(mm)}月</div><div class="bt"><div class="bf ${cur?'cur':''}" data-w="${Math.max(2,v/max*100)}" style="width:0%;transition-delay:${i*35}ms"></div></div><div class="bv num">${fmtN(v)}</div></div>`; }).join("");
  const cats=db.months[active].categories;
  const cmax=Math.max(1,...cats.map(c=>catAmount(active,c)));
  const breakdown=cats.map((c,i)=>{ const v=catAmount(active,c);
    return `<div class="barrow"><div class="bl">${c}</div><div class="bt"><div class="bf" data-w="${Math.max(2,v/cmax*100)}" style="width:0%;transition-delay:${i*35}ms"></div></div><div class="bv num">${fmtN(v)}</div></div>`; }).join("");
  if(!statCat||!cats.includes(statCat)) statCat=cats[0];
  const catChips=Array.from(new Set(months.flatMap(m=>db.months[m].categories))).map(c=>`<button class="sc ${c===statCat?'on':''}" data-sc="${c}">${c}</button>`).join("");
  const hist=months.filter(m=>m!==active).map(m=>catAmount(m,statCat)).filter(v=>v>0);
  const avg=hist.length?hist.reduce((a,v)=>a+v,0)/hist.length:0;
  const now=catAmount(active,statCat);
  let deltaHtml="";
  if(avg>0){ const pct=Math.round((now-avg)/avg*100); const up=pct>0;
    deltaHtml=`<div class="delta ${up?'up':'down'}">${up?'▲':'▼'} 平均より ${Math.abs(pct)}% ${up?'高い':'低い'}</div><div class="base">${statFilter==="half"?"直近6ヶ月":"直近1年"}の平均 ${fmt(avg)}(${hist.length}ヶ月)</div>`; }
  else deltaHtml=`<div class="base">比較できる過去データがありません</div>`;

  document.getElementById("v-stats").innerHTML=`
    <div class="filters">
      <button class="fil ${statFilter==='half'?'on':''}" data-fil="half">直近6ヶ月</button>
      <button class="fil ${statFilter==='year'?'on':''}" data-fil="year">直近1年</button></div>
    <div class="panel"><div class="ph">月別の総支出 <small>固定+変動</small></div>${trend}</div>
    <div class="panel"><div class="ph">${labelOf(active)} の分類内訳</div>${breakdown}</div>
    <div class="panel"><div class="ph">分類の比較 <small>今月 vs 過去の平均</small></div>
      <div class="selcat">${catChips}</div>
      <div class="cmp"><div class="now num"><span class="yen">¥</span>${fmtN(now)}</div>${deltaHtml}</div></div>`;
  requestAnimationFrame(()=>document.querySelectorAll("#v-stats .bf").forEach(b=>{ if(b.dataset.w) b.style.width=b.dataset.w+"%"; }));
  document.querySelectorAll("[data-fil]").forEach(b=>b.addEventListener("click",()=>{ statFilter=b.dataset.fil; renderStats(); }));
  document.querySelectorAll("[data-sc]").forEach(b=>b.addEventListener("click",()=>{ statCat=b.dataset.sc; renderStats(); }));
}

function renderHistory(){
  const all=monthsAsc().reverse(); let html=""; let curYear=null;
  all.forEach(k=>{ const[y]=k.split("-"); if(y!==curYear){ curYear=y; html+=`<div class="yr">${y}</div>`; }
    const[,m]=k.split("-"); const mo=db.months[k];
    const tag=mo.migrated?(mo.entries&&mo.entries.length?'':'<small>移行データ・合計のみ</small>'):'<small>日次記帳</small>';
    html+=`<div class="hrow ${k===active?'active':''}" data-go="${k}"><div class="m">${Number(m)}月 ${tag}</div><div class="bal"><div class="b num">${fmt(balance(k))}</div><div class="bl">残高</div></div></div>`; });
  document.getElementById("v-history").innerHTML=`<div class="hist">${html}<div class="foot">全 ${all.length} ヶ月 · タップで開いて編集できます</div></div>`;
  document.querySelectorAll("[data-go]").forEach(r=>r.addEventListener("click",()=>{ active=r.dataset.go; switchTab("overview"); }));
}

/* ---------------- tab indicator (sliding shared background) ---------------- */
const _tabbar=document.querySelector(".tabbar"); let _tabInd=null, _tabX=null;
function positionTabIndicator(animate){
  if(!_tabbar) return;
  _tabInd = _tabInd || _tabbar.querySelector(".tabind"); if(!_tabInd) return;
  const a=_tabbar.querySelector(".tab.on"); if(!a) return;
  const x=a.offsetLeft, w=a.offsetWidth;
  _tabInd.style.width=w+"px";
  if(_tabX===null || !animate || REDUCED || !_tabInd.animate){ _tabInd.style.transform="translateX("+x+"px)"; }
  else { springAnim(_tabInd, v=>"translateX("+v+"px)", _tabX, x, SP_TAB); }
  _tabX=x;
}
window.addEventListener("resize", ()=>positionTabIndicator(false));
setInterval(()=>{ try{ updateLastmod(); }catch(e){} }, 30000);
