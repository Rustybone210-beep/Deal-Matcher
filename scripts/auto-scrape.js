const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');

// Auto-scrape: fetches deals from public listing APIs
// Run via cron: node scripts/auto-scrape.js
// Or triggered via API: POST /api/admin/scrape

const SOURCES = [
  // Crexi search URLs — gas stations
  { name: 'Crexi Gas Stations', industry: 'gas station',
    searchTerms: ['gas station NNN', '7-eleven NNN', 'convenience store NNN', 'wawa NNN'] },
  // Crexi search URLs — multifamily
  { name: 'Crexi Multifamily', industry: 'multifamily',
    searchTerms: ['multifamily apartments', 'apartment complex', 'multifamily portfolio'] },
  // Crexi search URLs — retail
  { name: 'Crexi Retail', industry: 'retail',
    searchTerms: ['retail center', 'strip mall', 'shopping center NNN'] },
];

async function scrapeDeals() {
  console.log('[AUTO-SCRAPE] Starting deal scrape at', new Date().toISOString());
  let totalNew = 0;
  const now = new Date().toISOString();

  for (const source of SOURCES) {
    for (const term of source.searchTerms) {
      try {
        // Use web search to find active listings
        const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(term + ' for sale site:crexi.com') + '&num=10';
        console.log('[AUTO-SCRAPE] Searching:', term);

        // Parse results would go here in production
        // For now, log the search term for manual follow-up
        console.log('[AUTO-SCRAPE] Would search:', searchUrl);

      } catch (e) {
        console.error('[AUTO-SCRAPE] Error:', e.message);
      }
    }
  }

  // Re-run matching after any new imports
  const matches = runMatchingForAll();
  console.log('[AUTO-SCRAPE] Complete. New deals:', totalNew, '| Total matches:', matches);
  return { newDeals: totalNew, totalMatches: matches };
}

// Import from CSV automatically (used by cron)
function importFromCSV(filepath) {
  const fs = require('fs');
  if (!fs.existsSync(filepath)) { console.log('File not found:', filepath); return 0; }
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n');
  const now = new Date().toISOString();
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = []; let cur = ''; let q = false;
    for (const c of lines[i]) { if (c === '"') { q = !q; continue; } if (c === ',' && !q) { parts.push(cur.trim()); cur = ''; continue; } cur += c; }
    parts.push(cur.trim());
    const [name,city,state,price,rev,industry,url] = parts;
    if (!name || !parseFloat(price)) continue;
    try {
      db.prepare('INSERT INTO listings (name,city,state,asking_price,revenue,industry,url,source,status,scraped_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(name,city,state,parseFloat(price),parseFloat(rev)||0,industry,url,'auto-scrape','new',now);
      count++;
    } catch(e) { if (!e.message.includes('UNIQUE')) console.log('SKIP:', name); }
  }
  console.log('[AUTO-SCRAPE] Imported', count, 'deals from CSV');
  const matches = runMatchingForAll();
  console.log('[AUTO-SCRAPE] Re-matched:', matches, 'total matches');
  return count;
}

// Watch for new CSV files in data/ directory
function watchForCSVs() {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const processedFile = path.join(dataDir, '.processed');
  const processed = fs.existsSync(processedFile) ? fs.readFileSync(processedFile, 'utf8').split('\n') : [];

  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && !processed.includes(f));
  files.forEach(f => {
    console.log('[AUTO-SCRAPE] Found new CSV:', f);
    importFromCSV(path.join(dataDir, f));
    processed.push(f);
  });

  fs.writeFileSync(processedFile, processed.join('\n'));
}

if (require.main === module) {
  watchForCSVs();
  scrapeDeals().then(() => process.exit(0));
} else {
  module.exports = { scrapeDeals, importFromCSV, watchForCSVs };
}
