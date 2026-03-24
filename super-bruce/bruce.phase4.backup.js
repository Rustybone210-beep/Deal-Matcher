const axios = require("axios");
const cheerio = require("cheerio");
const Database = require("better-sqlite3");

// ==========================
// 🗄️ DATABASE / MEMORY
// ==========================
const db = new Database("bruce.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT UNIQUE,
    source TEXT,
    text TEXT,
    price INTEGER,
    revenue INTEGER,
    score INTEGER,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ==========================
// 🧠 BOOG SCORING
// ==========================
function scoreDeal(deal) {
  let score = 0;
  const price = Number(deal.price || 0);
  const revenue = Number(deal.revenue || 0);
  const text = (deal.text || "").toLowerCase();
  const title = (deal.title || "").toLowerCase();

  if (price >= 25000 && revenue >= 50000) {
    const ratio = revenue / price;
    if (ratio >= 0.5 && ratio <= 15) {
      score += ratio * 20;
    }
  }

  if (text.includes("recurring")) score += 18;
  if (text.includes("absentee")) score += 12;
  if (text.includes("semi-absentee")) score += 10;
  if (text.includes("cash flow")) score += 15;
  if (text.includes("seller financing")) score += 12;
  if (text.includes("owner financing")) score += 12;
  if (text.includes("sba")) score += 8;
  if (text.includes("established")) score += 6;
  if (text.includes("turnkey")) score += 6;

  if (title.includes("restaurant")) score -= 8;
  if (title.includes("service")) score += 8;
  if (title.includes("hvac")) score += 12;
  if (title.includes("route")) score += 8;
  if (title.includes("medical")) score += 8;
  if (title.includes("cleaning")) score += 6;

  if (price > 0) score += 4;
  if (revenue > 0) score += 4;

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return Math.round(score);
}

// ==========================
// 🔗 CLEAN LINKS
// ==========================
function cleanLink(rawLink) {
  if (!rawLink) return "";

  let link = rawLink.trim();

  if (link.startsWith("//")) {
    link = "https:" + link;
  }

  try {
    const url = new URL(link);
    const real = url.searchParams.get("uddg");
    if (real) return decodeURIComponent(real);
    return link;
  } catch {
    return link;
  }
}

// ==========================
// 🌐 SEARCH
// ==========================
async function searchDeals(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml"
    },
    timeout: 10000
  });

  const $ = cheerio.load(res.data);
  const results = [];

  $("a.result__a").each((i, el) => {
    const title = $(el).text().trim();
    const rawLink = $(el).attr("href");
    const link = cleanLink(rawLink);

    if (title && link) {
      let source = "";
      try {
        source = new URL(link).hostname;
      } catch {
        source = "unknown";
      }

      results.push({ title, link, source });
    }
  });

  return results.slice(0, 10);
}

// ==========================
// 🔍 SCRAPE PAGE TEXT
// ==========================
async function scrapePage(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 8000,
      maxRedirects: 5
    });

    const $ = cheerio.load(res.data);
    $("script, style, noscript").remove();

    const text = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);

    return text;
  } catch {
    return "";
  }
}

// ==========================
// 💵 MONEY HELPERS
// ==========================
function convertShorthandMoney(raw) {
  if (!raw) return 0;

  const str = String(raw).trim().toLowerCase();
  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(num)) return 0;

  if (str.includes("million") || /\b\d+(\.\d+)?m\b/.test(str)) {
    return Math.round(num * 1000000);
  }

  if (str.includes("thousand") || /\b\d+(\.\d+)?k\b/.test(str)) {
    return Math.round(num * 1000);
  }

  return Math.round(num);
}

function isPlausibleMoney(val, min, max) {
  return Number.isFinite(val) && val >= min && val <= max;
}

function extractMatches(text, regex) {
  const matches = [];
  for (const match of text.matchAll(regex)) {
    if (match[1]) {
      const val = convertShorthandMoney(match[1]);
      matches.push(val);
    }
  }
  return matches;
}

function pickBestValue(values, min, max) {
  const filtered = values.filter(v => isPlausibleMoney(v, min, max));
  if (!filtered.length) return 0;
  filtered.sort((a, b) => a - b);
  return filtered[0];
}

// ==========================
// 💵 BETTER FINANCIAL EXTRACTION
// ==========================
function extractFinancials(text) {
  const lower = (text || "").toLowerCase();

  const priceCandidates = [
    ...extractMatches(lower, /asking price[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /sale price[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /price[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /buying price[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi)
  ];

  const revenueCandidates = [
    ...extractMatches(lower, /gross revenue[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /annual revenue[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /revenue[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /gross sales[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi),
    ...extractMatches(lower, /sales[^a-z0-9$]{0,50}(\$?\s*[0-9,.]+\s*(?:m|k|million|thousand)?)/gi)
  ];

  let price = pickBestValue(priceCandidates, 25000, 10000000);
  let revenue = pickBestValue(revenueCandidates, 50000, 50000000);

  // Weak fallback only if nothing labeled found
  if (!price) {
    const fallback = extractMatches(lower, /\$\s*([0-9][0-9,]{4,})/g);
    price = pickBestValue(fallback, 25000, 10000000);
  }

  if (!revenue) {
    const fallback = extractMatches(lower, /\$\s*([0-9][0-9,]{5,})/g);
    revenue = pickBestValue(fallback, 50000, 50000000);
  }

  // Sanity checks
  if (price && revenue) {
    if (price === revenue) {
      // identical values are suspicious on broad category pages
      price = 0;
      revenue = 0;
    }

    const ratio = revenue / price;
    if (ratio < 0.2 || ratio > 20) {
      // likely junk extraction
      revenue = 0;
    }
  }

  return { price, revenue };
}

// ==========================
// 🧠 MEMORY HELPERS
// ==========================
function hasSeenLink(link) {
  const stmt = db.prepare("SELECT id FROM deals WHERE link = ?");
  return stmt.get(link);
}

function saveDeal(deal) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO deals
    (title, link, source, text, price, revenue, score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    deal.title,
    deal.link,
    deal.source,
    deal.text,
    deal.price,
    deal.revenue,
    deal.score
  );
}

function getTopRememberedDeals(limit = 10) {
  const stmt = db.prepare(`
    SELECT title, link, source, price, revenue, score, first_seen
    FROM deals
    ORDER BY score DESC, first_seen DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

// ==========================
// 🚀 MAIN ENGINE
// ==========================
async function runBruce() {
  console.log("\n🧠 BRUCE scanning REAL web with memory...\n");

  const query = "business for sale Florida under 1 million";
  const searchResults = await searchDeals(query);

  let newCount = 0;
  let skippedCount = 0;

  for (const result of searchResults) {
    if (hasSeenLink(result.link)) {
      skippedCount++;
      continue;
    }

    const pageText = await scrapePage(result.link);
    const financials = extractFinancials(pageText);

    const deal = {
      title: result.title,
      link: result.link,
      source: result.source,
      text: pageText,
      price: financials.price,
      revenue: financials.revenue
    };

    deal.score = scoreDeal(deal);
    saveDeal(deal);
    newCount++;
  }

  const topDeals = getTopRememberedDeals(5);

  console.log(`New deals saved: ${newCount}`);
  console.log(`Already seen/skipped: ${skippedCount}\n`);

  if (!topDeals.length) {
    console.log("No remembered deals found.");
    return;
  }

  topDeals.forEach((deal, i) => {
    console.log(`🔥 BOOG TOP DEAL #${i + 1}`);
    console.log({
      title: deal.title,
      source: deal.source,
      link: deal.link,
      price: deal.price,
      revenue: deal.revenue,
      score: deal.score,
      first_seen: deal.first_seen
    });
    console.log("-------------------");
  });
}

runBruce();
