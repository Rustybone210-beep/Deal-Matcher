const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');

// ============================================
// DEALMATCHER AI AGENT
// Monitors public sources for deals and leads
// Run daily via cron or manually: node scripts/deal-agent.js
// ============================================

const SEARCH_QUERIES = {
  gas_station: ['gas station for sale', 'convenience store for sale', 'gas station NNN'],
  multifamily: ['apartment complex for sale', 'multifamily for sale', 'apartment building for sale'],
  retail: ['retail center for sale', 'strip mall for sale', 'shopping center for sale'],
  restaurant: ['restaurant for sale', 'franchise for sale'],
  healthcare: ['medical practice for sale', 'dental practice for sale', 'pharmacy for sale'],
  industrial: ['warehouse for sale', 'manufacturing business for sale'],
};

const INVESTOR_SEARCH_QUERIES = [
  'looking to buy gas station',
  'looking to buy apartment complex',
  'seeking commercial real estate deals',
  'investor seeking NNN properties',
  'want to purchase business',
  'looking to acquire franchise',
];

// ============================================
// LoopNet / Crexi via Google Search API
// ============================================
async function searchListingSites(query, industry) {
  console.log('[AGENT] Searching listings:', query);
  let added = 0;
  const now = new Date().toISOString();

  // Use DuckDuckGo HTML search (no API key needed)
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' for sale site:crexi.com OR site:loopnet.com OR site:bizbuysell.com')}`;
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });

    if (response.ok) {
      const html = await response.text();
      // Extract result URLs and titles
      const results = [];
      const linkMatches = html.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi) || [];

      for (const match of linkMatches) {
        const urlMatch = match.match(/href="([^"]+)"/);
        const titleMatch = match.match(/>([^<]+)<\/a>/);
        if (urlMatch && titleMatch) {
          let url = urlMatch[1];
          // DuckDuckGo wraps URLs
          const uddg = url.match(/uddg=([^&]+)/);
          if (uddg) url = decodeURIComponent(uddg[1]);
          const title = titleMatch[1].trim();

          if ((url.includes('crexi.com') || url.includes('loopnet.com') || url.includes('bizbuysell.com')) && title.length > 10) {
            results.push({ title, url });
          }
        }
      }

      // Extract price from titles
      for (const r of results.slice(0, 15)) {
        const priceMatch = r.title.match(/\$[\d,]+(?:\.\d+)?[KkMm]?/);
        let price = 0;
        if (priceMatch) {
          let priceStr = priceMatch[0].replace(/[$,]/g, '');
          if (priceStr.match(/[Kk]$/)) price = parseFloat(priceStr) * 1000;
          else if (priceStr.match(/[Mm]$/)) price = parseFloat(priceStr) * 1000000;
          else price = parseFloat(priceStr);
        }

        // Extract location from title
        const stateMatch = r.title.match(/,\s*([A-Z]{2})\b/);
        const cityMatch = r.title.match(/in\s+([A-Za-z\s]+),/);

        try {
          db.prepare('INSERT INTO listings (name, city, state, asking_price, revenue, industry, url, source, status, scraped_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
              r.title.substring(0, 200),
              cityMatch ? cityMatch[1].trim() : '',
              stateMatch ? stateMatch[1] : '',
              price,
              0,
              industry,
              r.url,
              'agent-search',
              'new',
              now
            );
          added++;
        } catch (e) { /* duplicate URL */ }
      }
    }
  } catch (e) {
    console.log('[AGENT] Search error:', e.message);
  }

  console.log('[AGENT] Added:', added, 'listings for', query);
  return added;
}

// ============================================
// BizBuySell RSS Feeds (most reliable)
// ============================================
async function searchBizBuySellRSS(industry) {
  console.log('[AGENT] Checking BizBuySell RSS for:', industry);
  let added = 0;
  const now = new Date().toISOString();

  const categoryMap = {
    gas_station: 'gas-stations',
    retail: 'retail',
    restaurant: 'restaurants-and-food',
    healthcare: 'health-care-and-fitness',
    industrial: 'manufacturing',
    multifamily: 'real-estate',
  };

  const cat = categoryMap[industry] || industry;

  try {
    const url = `https://www.bizbuysell.com/rss/${cat}-businesses-for-sale/`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'DealMatcher/1.0 fields@dealmatcherapp.com' }
    });

    if (response.ok) {
      const xml = await response.text();
      // Parse RSS items
      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

      for (const item of items.slice(0, 20)) {
        const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
        const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1] || '';

        if (!title || !link) continue;

        // Extract price
        const priceMatch = (title + ' ' + desc).match(/\$[\d,]+(?:\.\d+)?/);
        let price = 0;
        if (priceMatch) price = parseFloat(priceMatch[0].replace(/[$,]/g, ''));

        // Extract location
        const locMatch = desc.match(/([A-Za-z\s]+),\s*([A-Z]{2})/);

        try {
          db.prepare('INSERT INTO listings (name, city, state, asking_price, revenue, industry, url, source, status, scraped_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
              title.substring(0, 200),
              locMatch ? locMatch[1].trim() : '',
              locMatch ? locMatch[2] : '',
              price,
              0,
              industry,
              link,
              'agent-bizbuysell-rss',
              'new',
              now
            );
          added++;
        } catch (e) { /* duplicate */ }
      }
    }
  } catch (e) {
    console.log('[AGENT] BizBuySell RSS error:', e.message);
  }

  console.log('[AGENT] BizBuySell RSS added:', added, 'for', industry);
  return added;
}

// ============================================
// Reddit — Find buyer leads
// ============================================
async function searchRedditForBuyers() {
  console.log('[AGENT] Searching Reddit for buyer leads...');
  let found = 0;
  const now = new Date().toISOString();

  for (const query of INVESTOR_SEARCH_QUERIES) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=week&limit=10`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'DealMatcher/1.0 fields@dealmatcherapp.com' }
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
            } catch (e) { /* duplicate */ }
          }
        }
      }
    } catch (e) {
      console.log('[AGENT] Reddit error:', e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('[AGENT] Reddit found:', found, 'leads');
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

  // 1. Search via DuckDuckGo for each category
  for (const [industry, queries] of Object.entries(SEARCH_QUERIES)) {
    for (const q of queries) {
      const added = await searchListingSites(q, industry);
      totalListings += added;
      await new Promise(r => setTimeout(r, 3000)); // Rate limit
    }
  }

  // 2. BizBuySell RSS feeds
  for (const industry of Object.keys(SEARCH_QUERIES)) {
    const added = await searchBizBuySellRSS(industry);
    totalListings += added;
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Reddit buyer leads
  totalLeads += await searchRedditForBuyers();

  // 4. Re-run matching
  const matches = runMatchingForAll();

  // 5. Log the run
  try {
    db.prepare('INSERT INTO agent_log (source, query, results_found, leads_added, listings_added) VALUES (?, ?, ?, ?, ?)')
      .run('full-run', 'all', totalListings + totalLeads, totalLeads, totalListings);
  } catch (e) {}

  console.log('===========================================');
  console.log('[AGENT] Run Complete');
  console.log('[AGENT] New listings:', totalListings);
  console.log('[AGENT] New leads:', totalLeads);
  console.log('[AGENT] Total matches:', matches);
  console.log('===========================================');

  return { totalListings, totalLeads, totalMatches: matches };
}

// ============================================
// DAILY REPORT
// ============================================
async function sendDailyReport(results) {
  try {
    const { Resend } = require('resend');
    require('dotenv').config();
    if (!process.env.RESEND_API_KEY) return;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const reportEmail = process.env.REPORT_EMAIL || 'fields@dealmatcherapp.com';

    const totalListings = db.prepare('SELECT COUNT(*) as c FROM listings').get().c;
    const totalMatches = db.prepare('SELECT COUNT(*) as c FROM matches').get().c;
    const totalInvestors = db.prepare('SELECT COUNT(*) as c FROM investors').get().c;
    let todayLeads = 0;
    let todayListings = 0;
    try {
      todayLeads = db.prepare("SELECT COUNT(*) as c FROM agent_leads WHERE found_at > datetime('now', '-1 day')").get().c;
      todayListings = db.prepare("SELECT COUNT(*) as c FROM listings WHERE scraped_at > datetime('now', '-1 day')").get().c;
    } catch (e) {}

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'DealMatcher <fields@dealmatcherapp.com>',
      to: reportEmail,
      subject: 'Daily Agent Report: ' + todayListings + ' new listings, ' + todayLeads + ' new leads',
      html: `<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">
        <h1 style="color:#00d4aa;">Daily Agent Report</h1>
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
        <p style="color:#888;font-size:12px;">DealMatcher AI Agent</p></div>`
    });
    console.log('[AGENT] Daily report sent');
  } catch (e) {
    console.log('[AGENT] Daily report failed:', e.message);
  }
}

if (require.main === module) {
  runAgent().then(results => {
    sendDailyReport(results).then(() => process.exit(0));
  });
} else {
  module.exports = { runAgent, sendDailyReport };
}
