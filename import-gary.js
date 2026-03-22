const fs=require('fs');
const{db}=require('./db/database');
const lines=fs.readFileSync('/Users/jfields/.openclaw/workspace/cashclaw/dealmatcher/gary-deals.csv','utf8').trim().split('\n');
let count=0;
for(let i=1;i<lines.length;i++){
  const parts=[];
  let current='';
  let inQuotes=false;
  for(const ch of lines[i]){
    if(ch==='"'){inQuotes=!inQuotes;continue;}
    if(ch===','&&!inQuotes){parts.push(current.trim());current='';continue;}
    current+=ch;
  }
  parts.push(current.trim());
  const name=parts[0]||'';
  const city=parts[1]||'';
  const state=parts[2]||'';
  const price=parseFloat(parts[3])||0;
  const revenue=parseFloat(parts[4])||0;
  const industry=parts[5]||'';
  const url=parts[6]||'';
  if(!name||price===0)continue;
  db.prepare('INSERT OR IGNORE INTO listings (name,city,state,asking_price,revenue,industry,url,source,status) VALUES (?,?,?,?,?,?,?,?,?)').run(name,city,state,price,revenue,industry,url,'crexi','active');
  count++;
}
console.log(count+' deals imported');
const{runMatchingForAll}=require('./matcher/engine');
runMatchingForAll();
