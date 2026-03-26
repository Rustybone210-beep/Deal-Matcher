'use strict';
require('dotenv').config();
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk').default;

const { scrapeDeals } = require('./scraper');
const { findBuyers } = require('./buyerFinder');
const { scanEdgar } = require('./edgarScanner');
const { scanCountyRecords } = require('./countyScanner');
const { runMatching } = require('./matcher');
const { sendDailyReport } = require('./reporter');
const { sendInvestorAlerts } = require('./alerter');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

class Bruce {
  constructor(db) {
    this.db = db;
    this.log = [];
    this.running = false;
  }

  record(msg) {
    const entry = { ts: new Date().toISOString(), msg };
    this.log.push(entry);
    console.log(`[BRUCE] ${entry.ts} — ${msg}`);
  }

  async run() {
    if (this.running) { console.log('[BRUCE] Already running'); return; }
    this.running = true;
    this.log = [];
    const startTime = Date.now();
    try {
      this.record('Bruce waking up — starting daily cycle');
      const dealsFound = await scrapeDeals(this.db);
      this.record(`Deals scraped: ${dealsFound}`);
      const buyersFound = await findBuyers(this.db);
      this.record(`Buyers found: ${buyersFound}`);
      const edgarLeads = await scanEdgar(this.db);
      this.record(`Edgar leads: ${edgarLeads}`);
      const countyLeads = await scanCountyRecords(this.db);
      this.record(`County leads: ${countyLeads}`);
      const matchResult = await runMatching(this.db);
      this.record(`Matches: ${matchResult.totalMatches}`);
      const alertsSent = await sendInvestorAlerts(this.db, client);
      this.record(`Alerts sent: ${alertsSent}`);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      await sendDailyReport(this.db, { dealsFound, buyersFound, edgarLeads, countyLeads, matchResult, alertsSent, elapsed, log: this.log });
      this.db.prepare(`
        INSERT INTO bruce_runs (status, deals_found, buyers_found, matches_total, alerts_sent, elapsed_seconds, log, created_at)
        VALUES ('success', ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(dealsFound, buyersFound, matchResult.totalMatches, alertsSent, elapsed, JSON.stringify(this.log));
      this.record(`Cycle complete in ${elapsed}s`);
    } catch (err) {
      this.record(`ERROR: ${err.message}`);
      console.error('[BRUCE ERROR]', err);
      this.db.prepare(`INSERT INTO bruce_runs (status, log, created_at) VALUES ('error', ?, datetime('now'))`).run(JSON.stringify(this.log));
    } finally {
      this.running = false;
    }
  }

  async chat(userId, message, conversationHistory = []) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const matches = this.db.prepare(`
      SELECT m.score, l.name as listing_name, l.city, l.state, l.industry, l.asking_price, m.reasons
      FROM matches m
      JOIN listings l ON l.id = m.listing_id
      ORDER BY m.score DESC LIMIT 5
    `).all();
    const stats = this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM listings) as deals,
             (SELECT COUNT(*) FROM investors) as investors,
             (SELECT COUNT(*) FROM matches WHERE score >= 50) as strong_matches
    `).get();
    const systemPrompt = `You are Bruce, the AI deal agent inside DealMatcher.
You are talking to ${user?.name || 'an investor'}.
Platform: ${stats.deals} deals, ${stats.investors} investors, ${stats.strong_matches} strong matches.
Top matches: ${matches.map(m => `${m.listing_name} (${m.city}, ${m.state}) | ${m.industry} | Score: ${m.score}`).join(' | ')}
Be professional, concise, under 4 sentences. Push toward action. Never disclose direct seller contact.`;
    const messages = [...conversationHistory, { role: 'user', content: message }];
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages
    });
    return {
      reply: response.content[0].text,
      history: [...messages, { role: 'assistant', content: response.content[0].text }]
    };
  }

  schedule() {
    cron.schedule('0 5 * * *', () => this.run(), { timezone: 'America/Chicago' });
    console.log('[BRUCE] Scheduled daily at 5am CT');
  }

  initDb() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS bruce_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'success',
      deals_found INTEGER DEFAULT 0,
      buyers_found INTEGER DEFAULT 0,
      matches_total INTEGER DEFAULT 0,
      alerts_sent INTEGER DEFAULT 0,
      elapsed_seconds INTEGER DEFAULT 0,
      log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS interest_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      investor_id INTEGER NOT NULL,
      listing_id INTEGER NOT NULL,
      match_id INTEGER,
      nda_sent INTEGER DEFAULT 0,
      nda_signed INTEGER DEFAULT 0,
      escrow_initiated INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS buyer_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      name TEXT,
      email TEXT,
      phone TEXT,
      raw_text TEXT,
      industries TEXT,
      locations TEXT,
      budget_min REAL,
      budget_max REAL,
      converted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS bruce_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      session_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  }
}

module.exports = Bruce;
