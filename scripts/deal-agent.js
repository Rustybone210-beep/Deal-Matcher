const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');

// ============================================
// DEALMATCHER AI AGENT
// Monitors public sources for deals and leads
// Run daily via cron or manually: node scripts/deal-agent.js
// ============================================

const SEARCH_QUERIES = {
  gas_station: [
    'gas station for sale NNN',
    '7-eleven for sale NNN lease',
    'convenience store for sale',
    'gas station NNN triple net',
    'wawa for sale NNN',
    'shell gas station for sale'
  ],
  multifamily: [
    'apartment complex for sale',
    'multifamily for sale 20 units',
    'multifamily portfolio for sale',
    'apartment building for sale',
    'BTR townhomes for sale'
  ],
  retail: [
    'retail center for sale NNN',
    'strip mall for sale',
    'shopping center for sale',
    'retail plaza for sale'
  ]
};

const INVESTOR_SEARCH_QUERIES = [
  'looking to buy gas station',
  'looking to buy apartment complex',
  'looking to acquire commercial real estate',
  'seeking multifamily investment',
  'investor seeking NNN properties',
  'looking to buy convenience store',
  'want to purchase gas station',
  'seeking commercial real estate deals'
];

// Track what we've already processed
db.exec(`CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  query TEXT,
  results_found INTEGER DEFAULT 0,
  leads_added INTEGER DEFAULT 0,
  listings_added INTEGER DEFAULT 0,
  run_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS agent_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  source_url TEXT,
  interest TEXT,
  location TEXT,
  budget TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  found_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email)
)`);

// ============================================
// SEC EDGAR — Find new real estate fund filings
// ============================================
async function searchSECEdgar() {
  console.log('[AGENT] Searching SEC EDGAR for RE fund filings...');
  try {
    const response = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22real+estate%22+%22fund%22&dateRange=custom&startdt=2026-01-01&forms=D', {
      headers: { 'User-Agent': 'DealMatcher/1.0 fields@dealmatcherapp.com' }
    });
    if (response.ok) {
      const text = await response.text();
      console.log('[AGENT] SEC EDGAR response received, length:', text.length);
      // Parse for fund names, managers, locations
      // These are real people raising capital for RE
    }
  } catch (e) {
    console.log('[AGENT] SEC EDGAR search:', e.message);
  }
  return [];
}

// ============================================
// Crexi Public Search
// ============================================
async function searchCrexi(query, industry) {
  console.log('[AGENT] Searching Crexi:', query);
  const now = new Date().toISOString();
  let added = 0;
  try {
    const searchUrl = `https://www.crexi.com/properties?searchText=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    if (response.ok) {
      const html = await response.text();
      // Extract property listings from HTML
      const nameMatches = html.match(/"propertyName":"([^"]+)"/g) || [];
      const priceMatches = html.match(/"listPrice":(\d+)/g) || [];
      const cityMatches = html.match(/"city":"([^"]+)"/g) || [];
      const stateMatches = html.match(/"state":"([^"]+)"/g) || [];
      const urlMatches = html.match(/"propertyUrl":"([^"]+)"/g) || [];

      for (let i = 0; i < Math.min(nameMatches.length, 10); i++) {
        try {
          const name = nameMatches[i]?.replace(/"propertyName":"/, '').replace(/"$/, '') || '';
          const price = priceMatches[i]?.replace(/"listPrice":/, '') || '0';
          const city = cityMatches[i]?.replace(/"city":"/, '').replace(/"$/, '') || '';
          const state = stateMatches[i]?.replace(/"state":"/, '').replace(/"$/, '') || '';
          const url = urlMatches[i]?.replace(/"propertyUrl":"/, '').replace(/"$/, '') || '';

          if (name && parseFloat(price) > 0) {
            try {
              db.prepare('INSERT INTO listings (name,city,state,asking_price,revenue,industry,url,source,status,scraped_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
                .run(name, city, state, parseFloat(price), 0, industry, 'https://www.crexi.com' + url, 'agent-crexi', 'new', now);
              added++;
            } catch (e) { /* duplicate */ }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    console.log('[AGENT] Crexi search error:', e.message);
  }
  console.log('[AGENT] Crexi added:', added, 'listings for', query);
  return added;
}

// ============================================
// BizBuySell Public Search
// ============================================
async function searchBizBuySell(query, industry) {
  console.log('[AGENT] Searching BizBuySell:', query);
  let added = 0;
  const now = new Date().toISOString();
  try {
    const searchUrl = `https://www.bizbuysell.com/businesses-for-sale/${encodeURIComponent(query.replace(/ /g, '-'))}/`;
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    if (response.ok) {
      const html = await response.text();
      // Extract listing data
      const titles = html.match(/<h2[^>]*class="[^"]*listing-title[^"]*"[^>]*>([^<]+)<\/h2>/gi) || [];
      const prices = html.match(/Asking Price:\s*\$[\d,]+/gi) || [];

      console.log('[AGENT] BizBuySell found:', titles.length, 'potential listings');
      for (let i = 0; i < Math.min(titles.length, 10); i++) {
        const name = titles[i]?.replace(/<[^>]+>/g, '').trim();
        const priceStr = prices[i]?.replace(/[^0-9]/g, '') || '0';
        if (name && parseFloat(priceStr) > 0) {
          try {
            db.prepare('INSERT INTO listings (name,city,state,asking_price,revenue,industry,url,source,status,scraped_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
              .run(name, '', '', parseFloat(priceStr), 0, industry, searchUrl, 'agent-bizbuysell', 'new', now);
            added++;
          } catch (e) { /* duplicate */ }
        }
      }
    }
  } catch (e) {
    console.log('[AGENT] BizBuySell search error:', e.message);
  }
  console.log('[AGENT] BizBuySell added:', added, 'listings');
  return added;
}

// ============================================
// Reddit/BiggerPockets — Find buyer leads
// ============================================
async function searchRedditForBuyers() {
  console.log('[AGENT] Searching Reddit for buyer leads...');
  let found = 0;
  const now = new Date().toISOString();

  for (const query of INVESTOR_SEARCH_QUERIES) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=week&limit=10`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'DealMatcher/1.0' }
      });
      if (response.ok) {
        const data = await response.json();
        const posts = data?.data?.children || [];
        for (const post of posts) {
          const d = post.data;
          if (d && d.author && d.title) {
            try {
              db.prepare('INSERT INTO agent_leads (name, source, source_url, interest, notes, found_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run('u/' + d.author, 'reddit', 'https://reddit.com' + d.permalink, query, d.title.substring(0, 200), now);
              found++;
            } catch (e) { /* duplicate or error */ }
          }
        }
      }
    } catch (e) {
      console.log('[AGENT] Reddit search error:', e.message);
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('[AGENT] Reddit found:', found, 'potential buyer leads');
  return found;
}

// ============================================
// County Records — Bexar County (San Antonio)
// ============================================
async function searchCountyRecords() {
  console.log('[AGENT] Checking Bexar County records...');
  let found = 0;
  try {
    // Bexar County real property search
    const url = 'https://bexar.trueautomation.com/clientdb/PropertySearch.aspx';
    console.log('[AGENT] Bexar County URL:', url);
    console.log('[AGENT] Note: County records require manual search or specialized scraper');
    // In production, this would use a headless browser to search recent commercial sales
  } catch (e) {
    console.log('[AGENT] County records:', e.message);
  }
  return found;
}

// ============================================
// MAIN AGENT RUN
// ============================================
async function runAgent() {
  console.log('===========================================');
  console.log('[AGENT] DealMatcher AI Agent Starting');
  console.log('[AGENT] Time:', new Date().toISOString());
  console.log('===========================================');

  let totalListings = 0;
  let totalLeads = 0;

  // 1. Search Crexi for each category
  for (const [industry, queries] of Object.entries(SEARCH_QUERIES)) {
    for (const q of queries) {
      const added = await searchCrexi(q, industry);
      totalListings += added;
      await new Promise(r => setTimeout(r, 2000)); // Rate limit
    }
  }

  // 2. Search BizBuySell
  for (const [industry, queries] of Object.entries(SEARCH_QUERIES)) {
    for (const q of queries.slice(0, 2)) { // Limit to avoid rate limiting
      const added = await searchBizBuySell(q, industry);
      totalListings += added;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // 3. Search Reddit for buyer leads
  totalLeads += await searchRedditForBuyers();

  // 4. Search SEC EDGAR
  await searchSECEdgar();

  // 5. Check county records
  await searchCountyRecords();

  // 6. Re-run matching engine
  const matches = runMatchingForAll();

  // 7. Log the run
  db.prepare('INSERT INTO agent_log (source, query, results_found, leads_added, listings_added) VALUES (?, ?, ?, ?, ?)')
    .run('full-run', 'all', totalListings + totalLeads, totalLeads, totalListings);

  console.log('===========================================');
  console.log('[AGENT] Run Complete');
  console.log('[AGENT] New listings:', totalListings);
  console.log('[AGENT] New leads:', totalLeads);
  console.log('[AGENT] Total matches:', matches);
  console.log('===========================================');

  return { totalListings, totalLeads, totalMatches: matches };
}

// ============================================
// DAILY REPORT — Email summary to J
// ============================================
async function sendDailyReport(results) {
  try {
    const { Resend } = require('resend');
    require('dotenv').config();
    const resend = new Resend(process.env.RESEND_API_KEY);

    const totalListings = db.prepare('SELECT COUNT(*) as c FROM listings').get().c;
    const totalMatches = db.prepare('SELECT COUNT(*) as c FROM matches').get().c;
    const totalInvestors = db.prepare('SELECT COUNT(*) as c FROM investors').get().c;
    const todayLeads = db.prepare("SELECT COUNT(*) as c FROM agent_leads WHERE found_at > datetime('now', '-1 day')").get().c;
    const todayListings = db.prepare("SELECT COUNT(*) as c FROM listings WHERE scraped_at > datetime('now', '-1 day')").get().c;

    await resend.emails.send({
      from: 'DealMatcher <fields@dealmatcherapp.com>',
      to: 'fields@dealmatcherapp.com',
      subject: '📊 Daily Agent Report: ' + todayListings + ' new listings, ' + todayLeads + ' new leads',
      html: `<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">
        <h1 style="color:#00d4aa;">📊 Daily Agent Report</h1>
        <p style="color:#888;">${new Date().toLocaleDateString()}</p>
        <div style="background:#16213e;padding:20px;border-radius:8px;margin:12px 0;">
          <h3 style="color:#00d4aa;">Today's Activity</h3>
          <p>New Listings Found: <strong style="color:#fff;">${todayListings}</strong></p>
          <p>New Leads Found: <strong style="color:#fff;">${todayLeads}</strong></p>
        </div>
        <div style="background:#16213e;padding:20px;border-radius:8px;margin:12px 0;">
          <h3 style="color:#00d4aa;">Platform Totals</h3>
          <p>Total Listings: <strong style="color:#fff;">${totalListings}</strong></p>
          <p>Total Matches: <strong style="color:#fff;">${totalMatches}</strong></p>
          <p>Total Investors: <strong style="color:#fff;">${totalInvestors}</strong></p>
        </div>
        <p style="color:#888;font-size:12px;">DealMatcher AI Agent • Automated Report</p></div>`
    });
    console.log('[AGENT] Daily report sent');
  } catch (e) {
    console.log('[AGENT] Daily report failed:', e.message);
  }
}

// Run if called directly
if (require.main === module) {
  runAgent().then(results => {
    sendDailyReport(results).then(() => process.exit(0));
  });
} else {
  module.exports = { runAgent, sendDailyReport, searchCrexi, searchBizBuySell, searchRedditForBuyers, searchSECEdgar };
}
