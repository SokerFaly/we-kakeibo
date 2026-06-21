"use strict";
/* ---------------- storage (沙箱では自動で内存にfallback) ---------------- */
const KEY="we_kakeibo_v1";
let MEM=null;
function load(){
  try{const s=localStorage.getItem(KEY); if(s) return JSON.parse(s);}catch(e){}
  if(MEM) return MEM;
  return JSON.parse(JSON.stringify(SEED));
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){ MEM=JSON.parse(JSON.stringify(db)); }
}
let db=load();
let active=Object.keys(db.months).sort().pop();
let curTab="overview";
