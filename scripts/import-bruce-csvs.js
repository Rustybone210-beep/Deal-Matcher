const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');

const CSV_DIR = path.join(require('os').homedir(), '.openclaw/workspace/cashclaw/dealmatcher');
const now = new Date().toISOString();

function parseCSV(filepath) {
  if (!fs.existsSync(filepath)) return [];
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = [];
    let current = '';
    let inQuote = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { parts.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    parts.push(current.trim());
    if (parts[0]) rows.push(parts);
  }
  return rows;
}

let totalImported = 0;

const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv') && f.includes('new'));
if (csvFiles.length === 0) {
  console.log('No new CSV files found in ' + CSV_DIR);
  process.exit(0);
}

for (const file of csvFiles) {
  const filepath = path.join(CSV_DIR, file);
  const rows = parseCSV(filepath);
  let count = 0;

  for (const row of rows) {
    const name = row[0] || '';
    const city = row[1] || '';
    const state = row[2] || '';
    const price = parseFloat(row[3]) || 0;
    const revenue = parseFloat(row[4]) || 0;
    const industry = row[5] || '';
    const url = row[6] || '';

    if (!name || price === 0) continue;

    try {
      db.prepare('INSERT INTO listings (name, city, state, asking_price, revenue, industry, url, source, status, scraped_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(name, city, state, price, revenue, industry, url, 'bruce-' + file.replace('.csv', ''), 'new', now);
      count++;
    } catch (e) {
      if (!e.message.includes('UNIQUE')) {
        console.log('SKIP: ' + name + ' — ' + e.message);
      }
    }
  }

  console.log(file + ': ' + count + ' deals imported');
  totalImported += count;

  // Rename file so it doesn't get imported again
  const donePath = filepath.replace('.csv', '-imported-' + Date.now() + '.csv');
  fs.renameSync(filepath, donePath);
}

if (totalImported > 0) {
  const matchCount = runMatchingForAll();
  console.log('\n' + totalImported + ' total deals imported. ' + matchCount + ' matches.');
} else {
  console.log('No new deals to import.');
}
