'use strict';
const axios = require('axios');

async function scanEdgar(db) {
  let found = 0;
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22real+estate%22+%22acquisition%22&dateRange=custom&startdt=${weekAgo}&enddt=${today}&forms=D`;
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'DealMatcher research@dealmatcher.com' }
    });
    const hits = res.data?.hits?.hits || [];
    for (const hit of hits.slice(0, 10)) {
      const src = hit._source || {};
      const name = src.entity_name || 'Unknown Fund';
      const existing = db.prepare("SELECT id FROM buyer_leads WHERE source = 'SEC EDGAR' AND name = ?").get(name);
      if (!existing) {
        db.prepare(`INSERT INTO buyer_leads (source, name, raw_text, industries, created_at) VALUES ('SEC EDGAR', ?, ?, 'Real Estate', datetime('now'))`).run(name, `SEC D filing: ${src.file_date || ''}`);
        found++;
      }
    }
  } catch (err) {
    console.error(`[EDGAR] ${err.message}`);
  }
  return found;
}

module.exports = { scanEdgar };
