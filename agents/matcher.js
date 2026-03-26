'use strict';

async function runMatching(db) {
  const listings = db.prepare("SELECT * FROM listings WHERE status != 'archived'").all();
  const investors = db.prepare('SELECT * FROM investors').all();
  if (!listings.length || !investors.length) return { totalMatches: 0 };
  const upsert = db.prepare(`
    INSERT INTO matches (listing_id, investor_id, score, price_score, industry_score, location_score, revenue_score, reasons, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(listing_id, investor_id) DO UPDATE SET
      score=excluded.score, price_score=excluded.price_score,
      industry_score=excluded.industry_score, location_score=excluded.location_score,
      revenue_score=excluded.revenue_score, reasons=excluded.reasons
  `);
  let totalMatches = 0;
  const runAll = db.transaction(() => {
    for (const l of listings) {
      for (const inv of investors) {
        const result = score(l, inv);
        if (result.score > 0) {
          upsert.run(l.id, inv.id, result.score, result.price_score, result.industry_score, result.location_score, result.revenue_score, result.reasons);
          totalMatches++;
        }
      }
    }
  });
  runAll();
  return { totalMatches, listings: listings.length, investors: investors.length };
}

function score(listing, investor) {
  let price_score = 0, industry_score = 0, location_score = 0, revenue_score = 0;
  const reasons = [];
  if (listing.asking_price && (investor.min_price || investor.max_price)) {
    const min = investor.min_price || 0;
    const max = investor.max_price || Infinity;
    if (listing.asking_price >= min && listing.asking_price <= max) { price_score = 30; reasons.push('Price in range'); }
    else if (listing.asking_price >= min * 0.8 && listing.asking_price <= max * 1.25) { price_score = 18; reasons.push('Price near range'); }
  } else { price_score = 10; }
  if (listing.industry && investor.industries) {
    const li = listing.industry.toLowerCase();
    const ii = investor.industries.toLowerCase().split(',').map(s => s.trim());
    if (ii.some(i => li.includes(i) || i.includes(li))) { industry_score = 30; reasons.push('Industry match'); }
    else { industry_score = 5; }
  } else { industry_score = 10; }
  if (investor.locations) {
    const locs = investor.locations.toLowerCase();
    if (locs.includes('nationwide') || locs.includes('national')) { location_score = 20; reasons.push('Nationwide buyer'); }
    else if ((listing.state || '').toLowerCase() && locs.includes((listing.state || '').toLowerCase())) { location_score = 20; reasons.push('State match'); }
    else { location_score = 5; }
  } else { location_score = 10; }
  if (listing.revenue && (investor.min_revenue || investor.max_revenue)) {
    const minR = investor.min_revenue || 0;
    const maxR = investor.max_revenue || Infinity;
    if (listing.revenue >= minR && listing.revenue <= maxR) { revenue_score = 20; reasons.push('Revenue in range'); }
    else { revenue_score = 5; }
  } else { revenue_score = 10; }
  return { score: price_score + industry_score + location_score + revenue_score, price_score, industry_score, location_score, revenue_score, reasons: reasons.join(' · ') };
}

module.exports = { runMatching };
