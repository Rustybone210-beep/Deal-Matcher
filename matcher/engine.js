const { db } = require('../db/database');

const CROSS_MAP = {
  'restaurant':'food,hospitality,dining,pizza,pub,cafe,bar,charcuterie,mediterranean,cuban,italian',
  'food':'restaurant,hospitality,dining,cuisine,catering,charcuterie,pub,bar',
  'healthcare':'medical,health,dental,wellness,clinic,hospital,med spa,chiropractic,mental health,home care,oncology,aba,primary care',
  'medical':'healthcare,health,dental,wellness,clinic,practice',
  'home services':'hvac,plumbing,cleaning,landscaping,pool,roofing,junk,carpet,closet,restoration,sign,graphics',
  'retail':'shop,store,boutique,jewelry,wine,gift,smoke,tailoring,alteration',
  'wellness':'health,med spa,fitness,beauty,chiropractic,mental health',
  'dental':'healthcare,medical,orthodontics',
  'hospitality':'restaurant,food,hotel,bar,pub,dining',
  'restaurants and food':'restaurant,food,hospitality,dining,pub,bar,cafe,pizza,cuban,italian,mediterranean,charcuterie',
  'home services':'hvac,plumbing,cleaning,landscaping,pool,roofing,junk,carpet,closet,restoration,sign'
};

const STATE_MAP = {
  'al':'alabama','ak':'alaska','az':'arizona','ar':'arkansas','ca':'california',
  'co':'colorado','ct':'connecticut','de':'delaware','fl':'florida','ga':'georgia',
  'hi':'hawaii','id':'idaho','il':'illinois','in':'indiana','ia':'iowa',
  'ks':'kansas','ky':'kentucky','la':'louisiana','me':'maine','md':'maryland',
  'ma':'massachusetts','mi':'michigan','mn':'minnesota','ms':'mississippi','mo':'missouri',
  'mt':'montana','ne':'nebraska','nv':'nevada','nh':'new hampshire','nj':'new jersey',
  'nm':'new mexico','ny':'new york','nc':'north carolina','nd':'north dakota','oh':'ohio',
  'ok':'oklahoma','or':'oregon','pa':'pennsylvania','ri':'rhode island','sc':'south carolina',
  'sd':'south dakota','tn':'tennessee','tx':'texas','ut':'utah','vt':'vermont',
  'va':'virginia','wa':'washington','wv':'west virginia','wi':'wisconsin','wy':'wyoming'
};

function scoreMatch(listing, investor) {
  let reasons = [];
  let priceScore = 0, industryScore = 0, locationScore = 0, revenueScore = 0;

  // PRICE (0-30)
  if (listing.asking_price && investor.min_price && investor.max_price) {
    if (listing.asking_price >= investor.min_price && listing.asking_price <= investor.max_price) { priceScore = 30; reasons.push('Price in range'); }
    else if (listing.asking_price >= investor.min_price * 0.7 && listing.asking_price <= investor.max_price * 1.3) { priceScore = 15; reasons.push('Price near range'); }
  }

  // INDUSTRY (0-30)
  if (listing.industry && investor.industries) {
    const li = String(listing.industry).toLowerCase().trim();
    const targets = String(investor.industries).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    let matched = false;

    // Direct match
    for (const t of targets) {
      if (li.includes(t) || t.includes(li)) { industryScore = 30; reasons.push('Industry: ' + t); matched = true; break; }
    }

    // Word-level match
    if (!matched) {
      const liWords = li.split(/[\s,\/\-&]+/).filter(w => w.length > 3);
      for (const t of targets) {
        const tWords = t.split(/[\s,\/\-&]+/).filter(w => w.length > 3);
        for (const tw of tWords) {
          for (const lw of liWords) {
            if (tw.includes(lw) || lw.includes(tw)) { industryScore = 25; reasons.push('Industry word: ' + tw); matched = true; break; }
          }
          if (matched) break;
        }
        if (matched) break;
      }
    }

    // Cross-map match
    if (!matched) {
      for (const t of targets) {
        // Check if listing industry maps to target
        for (const [key, vals] of Object.entries(CROSS_MAP)) {
          if (li.includes(key) || key.includes(li)) {
            for (const v of vals.split(',')) {
              if (v.trim() && t.includes(v.trim())) { industryScore = 20; reasons.push('Related: ' + key + ' ~ ' + t); matched = true; break; }
            }
          }
          if (matched) break;
          // Reverse: check if target maps to listing
          if (t.includes(key)) {
            for (const v of vals.split(',')) {
              if (v.trim() && li.includes(v.trim())) { industryScore = 20; reasons.push('Related: ' + t + ' ~ ' + v.trim()); matched = true; break; }
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
    }
  }

  // LOCATION (0-25)
  if (investor.locations) {
    const targets = String(investor.locations).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const isNationwide = targets.some(l => l === 'nationwide' || l === 'national' || l === 'all');
    if (isNationwide) { locationScore = 20; reasons.push('Nationwide investor'); }
    else {
      const rawState = String(listing.state || '').toLowerCase().trim();
      const fullState = STATE_MAP[rawState] || rawState;
      const city = String(listing.city || '').toLowerCase().trim();

      for (const loc of targets) {
        if (!loc) continue;
        if (fullState && (fullState.includes(loc) || loc.includes(fullState))) { locationScore = 25; reasons.push('State: ' + loc); break; }
        if (rawState && (rawState === loc || loc === fullState)) { locationScore = 25; reasons.push('State: ' + loc); break; }
        if (city && (city.includes(loc) || loc.includes(city))) { locationScore = 25; reasons.push('City: ' + loc); break; }
      }
    }
  }

  // REVENUE (0-15)
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
  const upsert = db.prepare('INSERT INTO matches (listing_id, investor_id, score, price_score, industry_score, location_score, revenue_score, ai_score, reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(listing_id, investor_id) DO UPDATE SET score=excluded.score, price_score=excluded.price_score, industry_score=excluded.industry_score, location_score=excluded.location_score, revenue_score=excluded.revenue_score, ai_score=excluded.ai_score, reasons=excluded.reasons, created_at=CURRENT_TIMESTAMP');
  db.transaction(() => { for (const inv of investors) { const r = scoreMatch(listing, inv); if (r.score > 0) upsert.run(listing.id, inv.id, r.score, r.priceScore, r.industryScore, r.locationScore, r.revenueScore, r.aiScore, r.reasons); } })();
}

function runMatchingForAll() {
  const listings = db.prepare('SELECT * FROM listings').all();
  for (const l of listings) runMatchingForListing(l.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  console.log('Matching complete: ' + listings.length + ' listings, ' + count + ' matches.');
  return count;
}

module.exports = { runMatchingForAll, runMatchingForListing, scoreMatch };
