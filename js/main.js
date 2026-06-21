"use strict";
/* ---------------- routing ---------------- */
function render(){
  renderHeader();
  if(curTab==="overview") renderOverview();
  else if(curTab==="entry") renderEntry();
  else if(curTab==="stats") renderStats();
  else if(curTab==="history") renderHistory();
  // overview delegated edit buttons
  if(curTab==="overview"){
    const v=document.getElementById("v-overview");
    const hb=document.getElementById("open-hesan"); if(hb) hb.addEventListener("click",openHesan);
    const uc=document.getElementById("usecarry"); if(uc) uc.addEventListener("click",()=>{ const prev=shiftMonth(active,-1); db.months[active].start=Math.round(balance(prev)); save(); render(); });
    v.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{
      const t=b.dataset.edit;
      if(t==="fixed")editFixed(); else if(t==="income")editIncome(); else if(t==="cash")editCash();
      else if(t==="vartot")editVarTotals(); else if(t==="goentry")switchTab("entry");
    }));
  }
}
function switchTab(name){
  curTab=name;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x.dataset.v===name));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("on"));
  document.getElementById("v-"+name).classList.add("on");
  window.scrollTo(0,0); render();
}
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>switchTab(t.dataset.v)));
document.getElementById("prev").addEventListener("click",()=>{ active=shiftMonth(active,-1); ensureMonth(active); render(); });
document.getElementById("next").addEventListener("click",()=>{ active=shiftMonth(active,1); ensureMonth(active); render(); });

render();
