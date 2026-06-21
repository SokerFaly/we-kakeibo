"use strict";
/* ---------------- helpers ---------------- */
function fmt(n){ if(n===null||n===undefined||isNaN(n)) return "—"; return "¥"+Math.round(n).toLocaleString("ja-JP"); }
function fmtN(n){ if(n===null||n===undefined||isNaN(n)) return "—"; return Math.round(n).toLocaleString("ja-JP"); }
function evalExpr(s){
  if(s===null||s===undefined) return null;
  s=String(s).trim(); if(!s) return null;
  if(!/^[0-9+\-*/(). ]+$/.test(s)) return null;
  try{ const v=Function('"use strict";return ('+s+')')(); return (typeof v==="number"&&isFinite(v))?v:null; }catch(e){ return null; }
}
function monthsAsc(){ return Object.keys(db.months).sort(); }
function shiftMonth(key,delta){
  let[y,m]=key.split("-").map(Number); m+=delta;
  while(m<1){m+=12;y--;} while(m>12){m-=12;y++;}
  return y+"-"+String(m).padStart(2,"0");
}
function ensureMonth(key){
  if(db.months[key]) return;
  const prev=shiftMonth(key,-1);
  const sugg=db.months[prev]?balance(prev):0;
  const S=db.settings;
  db.months[key]={start:sugg,income:S.people.map(p=>({who:p,amount:S.defaultIncome})),
    fixed:{rent:S.defaultRent,mgmt:S.defaultMgmt,denki:null,gas:null,water:null,totalDebit:null,extra:[]},
    categories:S.defaultCategories.slice(),categoryTotals:{},entries:[],
    cash:{start:db.months[prev]&&db.months[prev].cash?cashRemain(prev):0,deposit:0},migrated:false};
  save();
}
function labelOf(key){ const[y,m]=key.split("-"); return y+"年 "+Number(m)+"月"; }

/* ---------------- compute ---------------- */
function catAmount(key,cat){
  const mo=db.months[key];
  if(mo.entries&&mo.entries.length) return mo.entries.filter(e=>e.category===cat).reduce((a,e)=>a+(e.amount||0),0);
  return (mo.categoryTotals&&mo.categoryTotals[cat])||0;
}
function varTotal(key){
  const mo=db.months[key];
  if(mo.entries&&mo.entries.length) return mo.entries.reduce((a,e)=>a+(e.amount||0),0);
  return Object.values(mo.categoryTotals||{}).reduce((a,v)=>a+(v||0),0);
}
function hosho(key){
  const f=db.months[key].fixed;
  if(f.totalDebit==null||f.denki==null) return null;
  return f.totalDebit-(f.rent||0)-(f.mgmt||0)-(f.denki||0);
}
function fixedTotal(key){
  const f=db.months[key].fixed; const h=hosho(key);
  let t=(f.rent||0)+(f.mgmt||0)+(f.denki||0)+(h||0)+(f.gas||0)+(f.water||0);
  (f.extra||[]).forEach(x=>t+=(x.amount||0));
  return t;
}
function incomeTotal(key){ return db.months[key].income.reduce((a,i)=>a+(i.amount||0),0); }
function balance(key){ return (db.months[key].start||0)+incomeTotal(key)-fixedTotal(key)-varTotal(key); }
function cashSpent(key){
  const mo=db.months[key];
  if(mo.entries&&mo.entries.length) return mo.entries.reduce((a,e)=>a+(e.cash||0),0);
  return (mo.cash&&mo.cash.spent)||0;
}
function cashRemain(key){ const c=db.months[key].cash; if(!c) return null; return (c.start||0)+(c.deposit||0)-cashSpent(key); }
function totalSpend(key){ return fixedTotal(key)+varTotal(key); }

function isCurrentRealMonth(key){ const d=new Date(); return key===d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }

function rangeMonths(){
  const all=monthsAsc(); if(statFilter==="all") return all;
  const n=statFilter==="half"?6:12; return all.slice(-n);
}
