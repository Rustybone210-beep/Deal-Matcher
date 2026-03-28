const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'dealmatcher.db');
const schemaPath = path.join(__dirname, 'schema.sql');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function columnExists(table, column) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().some(x => x.name === column);
}

function migrateListingsTable() {
  if (!columnExists('listings', 'status')) {
    db.prepare("ALTER TABLE listings ADD COLUMN status TEXT NOT NULL DEFAULT 'new'").run();
  }

  // Remove duplicate URLs
  const dups = db.prepare('SELECT url, COUNT(*) AS c FROM listings GROUP BY url HAVING c > 1').all();
  for (const d of dups) {
    const rows = db.prepare('SELECT id FROM listings WHERE url = ? ORDER BY created_at ASC, id ASC').all(d.url);
    const toDelete = rows.slice(1).map(r => r.id);
    const delMatches = db.prepare('DELETE FROM matches WHERE listing_id = ?');
    const delListing = db.prepare('DELETE FROM listings WHERE id = ?');
    db.transaction(ids => {
      for (const id of ids) {
        delMatches.run(id);
        delListing.run(id);
      }
    })(toDelete);
  }

  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_url_unique ON listings(url)').run();
}

function seedInvestors() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM investors').get().c;
  if (count > 0) return;

  const ins = db.prepare(`
    INSERT INTO investors (firm_name, contact_name, contact_email, contact_phone,
      industries, locations, min_price, max_price, min_revenue, max_revenue,
      fund_size, preferred_structure, notes)
    VALUES (@firm_name, @contact_name, @contact_email, @contact_phone,
      @industries, @locations, @min_price, @max_price, @min_revenue, @max_revenue,
      @fund_size, @preferred_structure, @notes)
  `);

  const investors = [
    { firm_name: 'Lone Star Healthcare Partners', contact_name: 'Marcus Rivera', contact_email: 'marcus@lonestarhealth.com', contact_phone: '210-555-1001', industries: 'healthcare, medical practice, dental, pharmacy', locations: 'texas, oklahoma, louisiana', min_price: 500000, max_price: 3000000, min_revenue: 800000, max_revenue: 8000000, fund_size: 25000000, preferred_structure: 'acquisition', notes: 'Healthcare roll-ups in the Sun Belt' },
    { firm_name: 'Pacific Rim Capital', contact_name: 'Jennifer Tanaka', contact_email: 'jen@pacificrimcap.com', contact_phone: '310-555-2002', industries: 'hospitality, restaurant, food service, hotel', locations: 'california, hawaii, nevada, oregon', min_price: 1000000, max_price: 5000000, min_revenue: 2000000, max_revenue: 15000000, fund_size: 60000000, preferred_structure: 'acquisition, jv', notes: 'Hospitality on the West Coast' },
    { firm_name: 'Meridian Real Estate Group', contact_name: 'Brian Whitfield', contact_email: 'brian@meridianreg.com', contact_phone: '404-555-3003', industries: 'multifamily, commercial real estate, retail', locations: 'florida, texas, georgia, carolina', min_price: 2000000, max_price: 15000000, min_revenue: 500000, max_revenue: 5000000, fund_size: 120000000, preferred_structure: 'acquisition', notes: 'Value-add multifamily and retail' },
    { firm_name: 'Atlas Industrial Fund', contact_name: 'Robert Kessler', contact_email: 'rkessler@atlasindustrial.com', contact_phone: '312-555-4004', industries: 'manufacturing, industrial, logistics, warehouse', locations: 'nationwide', min_price: 5000000, max_price: 20000000, min_revenue: 3000000, max_revenue: 50000000, fund_size: 350000000, preferred_structure: 'acquisition', notes: 'Lower middle market industrial' },
    { firm_name: 'Greenfield Family Office', contact_name: 'Amanda Chen', contact_email: 'amanda@greenfieldfo.com', contact_phone: '415-555-5005', industries: 'saas, technology, software, ecommerce', locations: 'nationwide', min_price: 1000000, max_price: 10000000, min_revenue: 500000, max_revenue: 20000000, fund_size: 80000000, preferred_structure: 'acquisition, growth equity', notes: 'Tech-enabled recurring revenue' },
    { firm_name: 'Bayou Ventures', contact_name: 'Philippe Landry', contact_email: 'phil@bayouventures.com', contact_phone: '504-555-6006', industries: 'food, beverage, restaurant, franchise', locations: 'texas, louisiana, mississippi, alabama, florida', min_price: 500000, max_price: 2000000, min_revenue: 600000, max_revenue: 5000000, fund_size: 15000000, preferred_structure: 'acquisition, jv', notes: 'Food and beverage in the South' },
    { firm_name: 'Summit Dental Acquisitions', contact_name: 'Dr. Sarah Palmer', contact_email: 'sarah@summitdental.com', contact_phone: '602-555-7007', industries: 'dental, orthodontics, oral surgery', locations: 'nationwide', min_price: 300000, max_price: 2000000, min_revenue: 400000, max_revenue: 4000000, fund_size: 30000000, preferred_structure: 'acquisition', notes: 'Dental practice consolidation' },
    { firm_name: 'Heartland Property Group', contact_name: 'Tom Briggs', contact_email: 'tom@heartlandpg.com', contact_phone: '816-555-8008', industries: 'retail, strip mall, commercial, mixed use', locations: 'missouri, kansas, iowa, nebraska, illinois, indiana', min_price: 1000000, max_price: 8000000, min_revenue: 300000, max_revenue: 3000000, fund_size: 45000000, preferred_structure: 'acquisition', notes: 'Midwest commercial and retail' },
    { firm_name: 'Coastal Wellness Fund', contact_name: 'Diana Reyes', contact_email: 'diana@coastalwellness.com', contact_phone: '786-555-9009', industries: 'med spa, wellness, fitness, beauty, chiropractic', locations: 'california, florida, texas, new york', min_price: 500000, max_price: 3000000, min_revenue: 400000, max_revenue: 6000000, fund_size: 20000000, preferred_structure: 'acquisition, jv', notes: 'Wellness sector roll-up' },
    { firm_name: 'Ironbridge PE', contact_name: 'William Drake', contact_email: 'wdrake@ironbridgepe.com', contact_phone: '214-555-0010', industries: 'logistics, transportation, trucking, fleet', locations: 'nationwide', min_price: 3000000, max_price: 15000000, min_revenue: 5000000, max_revenue: 40000000, fund_size: 200000000, preferred_structure: 'acquisition', notes: 'Transportation platform acquisitions' },
  ];

  db.transaction(rows => {
    for (const r of rows) ins.run(r);
  })(investors);

  console.log('Seeded 10 investors.');
}

function initDb() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  migrateListingsTable();
  seedInvestors();
  console.log('Database initialized.');
}

module.exports = { db, initDb };
