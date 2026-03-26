'use strict';
const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeDeals(db) {
  let totalInserted = 0;
  const sources = [
    { name: 'BizBuySell-Gas', url: 'https://www.bizbuysell.com/gas-stations-for-sale/', industry: 'Gas Station' },
    { name: 'BizBuySell-Multi', url: 'https://www.bizbuysell.com/commercial-real-estate-for-sale/', industry: 'Multifamily' },
    { name: 'BizBuySell-Retail', url: 'https://www.bizbuysell.com/retail-businesses-for-sale/', industry: 'Retail' }
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO listings (source, name, city, state, asking_price, industry, description, url, status, scraped_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'))
  `);
  for (const src of sources) {
    try {
      const res = await axios.get(src.url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
      });
      const $ = cheerio.load(res.data);
      $('h2 a, h3 a, .listing-name a, .bizListingName').each((i, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href');
        if (!name || !href || name.length < 5) return;
        const fullUrl = href.startsWith('http') ? href : 'https://www.bizbuysell.com' + href;
        try {
          const r = insert.run(src.name, name, '', '', null, src.industry, '', fullUrl);
          if (r.changes) totalInserted++;
        } catch (e) {}
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[SCRAPER] ${src.name}: ${err.message}`);
    }
  }
  return totalInserted;
}

module.exports = { scrapeDeals };
