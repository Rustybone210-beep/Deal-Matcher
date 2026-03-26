'use strict';

async function scanCountyRecords(db) {
  try {
    const existing = db.prepare("SELECT id FROM buyer_leads WHERE source = 'Bexar County' ORDER BY id DESC LIMIT 1").get();
    if (!existing) {
      db.prepare(`INSERT INTO buyer_leads (source, name, raw_text, locations, created_at) VALUES ('Bexar County', 'Manual Review Needed', 'Bexar County records require manual pull — check BCAD this week', 'San Antonio, TX', datetime('now'))`).run();
    }
  } catch (err) {
    console.error('[COUNTY]', err.message);
  }
  return 0;
}

module.exports = { scanCountyRecords };
