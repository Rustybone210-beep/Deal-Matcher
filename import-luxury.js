const fs=require('fs');
const{db}=require('./db/database');
const lines=fs.readFileSync('/Users/jfields/.openclaw/workspace/cashclaw/dealmatcher/luxury-deals.csv','utf8').trim().split('\n');
let count=0;
const now=new Date().toISOString();
for(let i=1;i<lines.length;i++){
  const parts=[];
  let current='';
  let inQuote=false;
  for(const ch of lines[i]){
    if(ch==='"'){inQuote=!inQuote;continue}
    if(ch===','&&!inQuote){parts.push(current.trim());current='';continue}
    current+=ch;
  }
  parts.push(current.trim());
  const name=parts[0],city=parts[1],state=parts[2],price=parseFloat(parts[3])||0,rev=parseFloat(parts[4])||0,industry=parts[5],url=parts[6];
  if(!name||price===0)continue;
  try{
    db.prepare('INSERT INTO listings (name,city,state,asking_price,revenue,industry,url,source,status,scraped_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(name,city,state,price,rev,industry,url,'crexi','new',now);
    count++;
  }catch(e){
    console.log('FAILED:',name,'|',e.message);
  }
}
console.log(count+' deals imported');
const{runMatchingForAll}=require('./matcher/engine');
runMatchingForAll();
