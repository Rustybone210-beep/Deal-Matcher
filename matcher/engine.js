const { db } = require('../db/database');
function scoreMatch(listing, investor) {
  let reasons = [];
  let priceScore = 0, industryScore = 0, locationScore = 0, revenueScore = 0;
  if (listing.asking_price && investor.min_price && investor.max_price) {
    if (listing.asking_price >= investor.min_price && listing.asking_price <= investor.max_price) { priceScore = 30; reasons.push('Price in range'); }
    else if (listing.asking_price >= investor.min_price * 0.7 && listing.asking_price <= investor.max_price * 1.3) { priceScore = 15; reasons.push('Price near range'); }
  }
  if (listing.industry && investor.industries) {
    const li = String(listing.industry).toLowerCase();
    const liWords = li.split(/[\s,\/\-&]+/).filter(w => w.length > 2);
    const targets = String(investor.industries).toLowerCase().split(',').map(s => s.trim());
    let matched = false;
    for (const t of targets) {
      if (!t) continue;
      if (li.includes(t) || t.includes(li)) { industryScore = 30; reasons.push('Industry: ' + t); matched = true; break; }
      const tWords = t.split(/[\s,\/\-&]+/).filter(w => w.length > 2);
      for (const tw of tWords) {
        for (const lw of liWords) {
          if (tw.length > 3 && lw.length > 3 && (tw.includes(lw) || lw.includes(tw))) { industryScore = 25; reasons.push('Industry match: ' + tw); matched = true; break; }
        }
        if (matched) break;
      }
      if (matched) break;
    }
    if (!matched) {
      const crossMap = {
        'restaurant':'food,hospitality,dining,pizza,pub,cafe,bar',
        'food':'restaurant,hospitality,dining,cuisine,catering',
        'healthcare':'medical,health,dental,wellness,clinic,hospital,med spa,chiropractic,mental health,home care,oncology',
        'medical':'healthcare,health,dental,wellness,clinic',
        'home services':'hvac,plumbing,cleaning,landscaping,pool,roofing,junk,carpet,closet,restoration',
        'retail':'shop,store,boutique,jewelry,wine,gift,smoke',
        'wellness':'health,med spa,fitness,beauty,chiropractic,mental health',
        'dental':'healthcare,medical,orthodontics',
        'hospitality':'restaurant,food,hotel,bar,pub,dining'
      };
      for (const t of targets) {
        const expansions = crossMap[t] || '';
        if (expansions) {
          for (const exp of expansions.split(',')) {
            if (exp && li.includes(exp.trim())) { industryScore = 20; reasons.push('Related industry: ' + t + ' ~ ' + exp.trim()); matched = true; break; }
          }
        }
        if (matched) break;
        for (const [key, vals] of Object.entries(crossMap)) {
          if (li.includes(key)) {
            for (const v of vals.split(',')) {
              if (v.trim() && t.includes(v.trim())) { industryScore = 15; reasons.push('Cross-match: ' + key + ' ~ ' + t); matched = true; break; }
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
    }
  }
  if (investor.locations) {
    const targets = String(investor.locations).toLowerCase().split(',').map(s => s.trim());
    const isNationwide = targets.some(l => l === 'nationwide' || l === 'national' || l === 'all');
    if (isNationwide) { locationScore = 20; reasons.push('Nationwide investor'); }
    else {
      const ls = String(listing.state || '').toLowerCase().trim();
      const lc = String(listing.city || '').toLowerCase().trim();
      for (const loc of targets) {
        if (!loc) continue;
        if (ls && (ls.includes(loc) || loc.includes(ls))) { locationScore = 25; reasons.push('State match: ' + loc); break; }
        if (ls === 'fl' && loc.includes('florida')) { locationScore = 25; reasons.push('Location: Florida'); break; }
        if (ls === 'tx' && loc.includes('texas')) { locationScore = 25; reasons.push('Location: Texas'); break; }
        if (ls === 'ca' && loc.includes('california')) { locationScore = 25; reasons.push('Location: California'); break; }
        if (ls === 'ga' && loc.includes('georgia')) { locationScore = 25; reasons.push('Location: Georgia'); break; }
        if (ls === 'ny' && loc.includes('new york')) { locationScore = 25; reasons.push('Location: New York'); break; }
        if (lc && (lc.includes(loc) || loc.includes(lc))) { locationScore = 25; reasons.push('City match: ' + loc); break; }
      }
    }
  }
  if (listing.revenue && investor.min_revenue && investor.max_revenue) {
    if (listing.revenue >= investor.min_revenue && listing.revenue <= investor.max_revenue) { revenueScore = 15; reasons.push('Revenue in range'); }
    else if (listing.revenue >= investor.min_revenue * 0.6 && listing.revenue <= investor.max_revenue * 1.4) { revenueScore = 8; reasons.push('Revenue near range'); }
  }
  return { score: Math.min(priceScore + industryScore + locationScore + revenueScore, 100), priceScore, industryScore, locationScore, revenueScore, aiScore: 0, reasons: reasons.join('; ') };
}
function runMatchingForListing(listingId) {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
  if (!listing) return;
  const investors = db.prepare('SELECT * FROM investors').all();
  const upsert = db.prepare('INSERT INTO matches (listing_id, investor_id, score, price_score, industry_score, location_score, revenue_score, ai_score, reasons) VALUES (@listing_id, @investor_id, @score, @price_score, @industry_score, @location_score, @revenue_score, @ai_score, @reasons) ON CONFLICT(listing_id, investor_id) DO UPDATE SET score=excluded.score, price_score=excluded.price_score, industry_score=excluded.industry_score, location_score=excluded.location_score, revenue_score=excluded.revenue_score, ai_score=excluded.ai_score, reasons=excluded.reasons, created_at=CURRENT_TIMESTAMP');
  db.transaction(() => { for (const inv of investors) { const r = scoreMatch(listing, inv); if (r.score > 0) upsert.run({ listing_id: listing.id, investor_id: inv.id, ...r }); } })();
}
function runMatchingForAll() {
  const listings = db.prepare('SELECT * FROM listings').all();
  for (const l of listings) runMatchingForListing(l.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  console.log('Matching complete: ' + listings.length + ' listings, ' + count + ' matches.');
  return count;
}
module.exports = { runMatchingForAll, runMatchingForListing, scoreMatch };
