CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,external_id TEXT,name TEXT NOT NULL,city TEXT,state TEXT,asking_price REAL,revenue REAL,noi REAL,industry TEXT,property_type TEXT,square_footage REAL,description TEXT,url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',scraped_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK (status IN ('new','reviewed','ready_to_send','sent','interested','closed','archived')));
CREATE TABLE IF NOT EXISTS investors (id INTEGER PRIMARY KEY AUTOINCREMENT,firm_name TEXT NOT NULL,contact_name TEXT,contact_email TEXT,contact_phone TEXT,industries TEXT,locations TEXT,min_price REAL,max_price REAL,min_revenue REAL,max_revenue REAL,fund_size REAL,preferred_structure TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT,listing_id INTEGER NOT NULL,investor_id INTEGER NOT NULL,score INTEGER NOT NULL,price_score INTEGER DEFAULT 0,industry_score INTEGER DEFAULT 0,location_score INTEGER DEFAULT 0,revenue_score INTEGER DEFAULT 0,ai_score INTEGER DEFAULT 0,reasons TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(listing_id,investor_id),FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,FOREIGN KEY(investor_id) REFERENCES investors(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS outreach (id INTEGER PRIMARY KEY AUTOINCREMENT,match_id INTEGER NOT NULL,listing_id INTEGER NOT NULL,investor_id INTEGER NOT NULL,email_to TEXT,subject TEXT,body TEXT,status TEXT NOT NULL DEFAULT 'draft',sent_at TEXT,opened_at TEXT,replied_at TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK (status IN ('draft','sent','opened','replied','interested','meeting','closed','declined')),FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,FOREIGN KEY(investor_id) REFERENCES investors(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS digest_log (id INTEGER PRIMARY KEY AUTOINCREMENT,investor_id INTEGER NOT NULL,sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,total_matches INTEGER DEFAULT 0,FOREIGN KEY(investor_id) REFERENCES investors(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_matches_score ON matches(score DESC);
CREATE INDEX IF NOT EXISTS idx_matches_listing ON matches(listing_id);
CREATE INDEX IF NOT EXISTS idx_matches_investor ON matches(investor_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status);
CREATE INDEX IF NOT EXISTS idx_outreach_investor ON outreach(investor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_url_unique ON listings(url);

-- Subscriptions (Stripe)
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Users (auth)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Agreements & Escrow
CREATE TABLE IF NOT EXISTS agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  listing_id INTEGER,
  investor_id INTEGER,
  seller_email TEXT,
  investor_email TEXT,
  status TEXT DEFAULT 'draft',
  document_url TEXT,
  signed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(listing_id) REFERENCES listings(id),
  FOREIGN KEY(investor_id) REFERENCES investors(id)
);

CREATE TABLE IF NOT EXISTS escrow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_id INTEGER,
  amount REAL,
  status TEXT DEFAULT 'pending',
  funded_at TEXT,
  released_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(agreement_id) REFERENCES agreements(id)
);

-- Bruce Agent
CREATE TABLE IF NOT EXISTS bruce_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  status TEXT,
  results TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interest_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER,
  listing_id INTEGER,
  status TEXT DEFAULT 'new',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buyer_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  interest TEXT,
  budget_min REAL,
  budget_max REAL,
  location TEXT,
  industry TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  source TEXT DEFAULT 'portal',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bruce_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  role TEXT,
  content TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Deal Agent
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  query TEXT,
  results_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  name TEXT,
  url TEXT UNIQUE,
  city TEXT,
  state TEXT,
  asking_price REAL,
  revenue REAL,
  industry TEXT,
  description TEXT,
  status TEXT DEFAULT 'new',
  scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
