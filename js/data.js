"use strict";
/* ---------------- seed (空テンプレート / 公開可・本物の数字なし) ----------------
   公開リポジトリ用の最小シード。履歴・ダミー数値なし。当月(空)だけ。
   token を貼って同期(後日の手順)すると、ここは表示されず本物データに置き換わる。 */
function inc(){return [{who:"太郎",amount:120000},{who:"花子",amount:120000}];}
const SEED={
  settings:{people:["太郎","花子"],defaultIncome:120000,defaultRent:88000,defaultMgmt:7000,
    defaultCategories:["食費","日用品","外食","ペット","娯楽"]},
  months:{
    "2026-06":{start:0,income:inc(),fixed:{rent:88000,mgmt:7000,denki:null,gas:null,water:null,totalDebit:null,extra:[]},categories:["食費","日用品","外食","ペット","娯楽"],categoryTotals:{},entries:[],cash:{start:0,deposit:0},migrated:false}
  }
};
