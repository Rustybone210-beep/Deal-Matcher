'use strict';
const axios = require('axios');

const SUBREDDITS = ['realestateinvesting', 'smallbusiness', 'Entrepreneur', 'investing', 'CommercialRealEstate'];
const BUY_KEYWORDS = ['looking to buy', 'want to buy', 'seeking to acquire', 'looking for gas station', 'looking for multifamily', 'want to acquire', 'interested in buying', 'first acquisition', 'trying to buy'];

async function findBuyers(db) {
  let totalFound = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO buyer_leads (source, name, raw_text, industries, locations, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  for (const sub of SUBREDDITS) {
    try {
      const url = `https://www.reddit.com/r/${sub}/new.json?limit=50`;
      const res = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'DealMatcher/1.0 (deal matching platform)' }
      });
      const posts = (res.data?.data?.children || []).map(c => c.data);
      for (const post of posts) {
        const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
        const isBuyer = BUY_KEYWORDS.some(kw => text.includes(kw));
        if (!isBuyer) continue;
        const industry = text.includes('gas') ? 'Gas Station' : text.includes('multi') ? 'Multifamily' : text.includes('retail') ? 'Retail' : 'Business';
        try {
          const r = insert.run('Reddit r/' + sub, post.author, (post.title + ' ' + (post.selftext || '')).slice(0, 500), industry, '');
          if (r.changes) totalFound++;
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[BUYER_FINDER] r/${sub}: ${err.message}`);
    }
  }
  return totalFound;
}

module.exports = { findBuyers };
