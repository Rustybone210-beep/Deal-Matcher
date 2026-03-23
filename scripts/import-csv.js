const fs = require('fs');
const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');
const file = process.argv[2];
if (!file) { console.log('Usage: node scripts/import-csv.js <csvfile>'); process.exit(1); }
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
const now = new Date().toISOString();
let count = 0;
for (let i = 1; i < lines.length; i++) {
  const parts = []; let cur = ''; let q = false;
  for (const c of lines[i]) { if (c === '"') { q = !q; continue; } if (c === ',' && !q) { parts.push(cur.trim()); cur = ''; continue; } cur += c; }
  parts.push(cur.trim());
  const [name,city,state,price,rev,industry,url] = parts;
  if (!name || !parseFloat(price)) continue;
  try {
    db.prepare('INSERT INTO listings (name,city,state,asking_price,revenue,industry,url,source,status,scraped_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(name,city,state,parseFloat(price),parseFloat(rev)||0,industry,url,'claude-search','new',now);
    count++;
  } catch(e) { if (!e.message.includes('UNIQUE')) console.log('SKIP:', name, e.message); }
}
console.log(count + ' deals imported');
const m = runMatchingForAll();
console.log(m + ' total matches');
