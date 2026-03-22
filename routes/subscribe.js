const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');

const resend = new Resend(process.env.RESEND_API_KEY);
const SUBS_FILE = path.join(__dirname, '..', 'data', 'subscribers.json');
const J_EMAIL = 'fields@dealmatcherapp.com';

function loadSubs() {
  try {
    if (!fs.existsSync(SUBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch (e) { return []; }
}

function saveSubs(d) {
  const dir = path.dirname(SUBS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SUBS_FILE, JSON.stringify(d, null, 2));
}

// Add subscriber to investors table automatically
function addToInvestors(sub) {
  try {
    // Check if investor with this email already exists
    const existing = db.prepare('SELECT id FROM investors WHERE contact_email = ?').get(sub.email);
    if (existing) return existing.id;

    const result = db.prepare(`
      INSERT INTO investors (firm_name, contact_name, contact_email, contact_phone, industries, locations, min_price, max_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sub.company || sub.name + ' (Individual)',
      sub.name,
      sub.email,
      sub.phone || '',
      sub.industries || '',
      sub.locations || '',
      sub.min_price || null,
      sub.max_price || null,
      'Auto-added from subscriber signup. Plan: ' + (sub.plan || 'free')
    );
    return result.lastInsertRowid;
  } catch (e) {
    console.error('[SUBSCRIBE] Failed to add investor:', e.message);
    return null;
  }
}

// Send J an alert email
async function alertJ(sub, investorId, matchCount) {
  try {
    await resend.emails.send({
      from: 'DealMatcher <fields@dealmatcherapp.com>',
      to: J_EMAIL,
      subject: '🎯 New DealMatcher Subscriber: ' + sub.name,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">
          <h1 style="color:#00d4aa;margin-top:0;">🎯 New Subscriber!</h1>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#888;">Name</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${sub.name}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Company</td><td style="padding:8px 0;color:#fff;">${sub.company || 'N/A'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Email</td><td style="padding:8px 0;color:#fff;">${sub.email}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Phone</td><td style="padding:8px 0;color:#fff;">${sub.phone || 'N/A'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Industries</td><td style="padding:8px 0;color:#00d4aa;">${sub.industries || 'Not specified'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Locations</td><td style="padding:8px 0;color:#fff;">${sub.locations || 'Not specified'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Price Range</td><td style="padding:8px 0;color:#fff;">$${(sub.min_price||0).toLocaleString()} - $${(sub.max_price||0).toLocaleString()}</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Plan</td><td style="padding:8px 0;color:#ffd700;font-weight:bold;">${(sub.plan||'free').toUpperCase()}</td></tr>
          </table>
          <hr style="border-color:#333;margin:20px 0;">
          <p style="color:#00d4aa;">✅ Auto-added as Investor #${investorId || 'N/A'}</p>
          <p style="color:#00d4aa;">✅ Matching engine ran — ${matchCount} total matches in system</p>
          <p style="margin-top:20px;color:#888;font-size:12px;">DealMatcher Alert System • ${new Date().toLocaleString()}</p>
        </div>
      `
    });
    console.log('[EMAIL] Alert sent to J for subscriber: ' + sub.name);
  } catch (e) {
    console.error('[EMAIL] Failed to alert J:', e.message);
  }
}

// Send welcome email to new subscriber
async function welcomeEmail(sub) {
  try {
    await resend.emails.send({
      from: 'DealMatcher <fields@dealmatcherapp.com>',
      to: sub.email,
      subject: 'Welcome to DealMatcher — Your Deal Criteria is Locked In',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">
          <h1 style="color:#00d4aa;margin-top:0;">Welcome to DealMatcher, ${sub.name}!</h1>
          <p>Your investment criteria has been registered and our AI matching engine is already scanning deals for you.</p>
          <div style="background:#16213e;padding:20px;border-radius:8px;margin:20px 0;">
            <h3 style="color:#00d4aa;margin-top:0;">Your Criteria</h3>
            <p><strong>Industries:</strong> ${sub.industries || 'All'}</p>
            <p><strong>Locations:</strong> ${sub.locations || 'All'}</p>
            <p><strong>Price Range:</strong> $${(sub.min_price||0).toLocaleString()} - $${(sub.max_price||0).toLocaleString()}</p>
            <p><strong>Plan:</strong> ${(sub.plan||'free').toUpperCase()}</p>
          </div>
          <h3 style="color:#fff;">What Happens Next</h3>
          <p>1️⃣ Our engine scans 500+ active deals daily</p>
          <p>2️⃣ You'll receive your top matched deals every week</p>
          <p>3️⃣ When you're ready to pursue a deal, we handle introductions</p>
          <p style="margin-top:20px;">Questions? Reply to this email or contact us at <a href="mailto:fields@dealmatcherapp.com" style="color:#00d4aa;">fields@dealmatcherapp.com</a></p>
          <hr style="border-color:#333;margin:20px 0;">
          <p style="color:#888;font-size:12px;">DealMatcher • AI-Powered Deal Matching • San Antonio, TX</p>
        </div>
      `
    });
    console.log('[EMAIL] Welcome sent to: ' + sub.email);
  } catch (e) {
    console.error('[EMAIL] Failed to send welcome:', e.message);
  }
}

// POST - New subscriber signup
router.post('/', async (req, res) => {
  try {
    const { name, email, company, phone, industries, locations, plan, min_price, max_price } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!name) return res.status(400).json({ error: 'Name required' });

    const subs = loadSubs();
    if (subs.some(s => s.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'Already subscribed' });
    }

    const sub = {
      id: Date.now().toString(),
      name,
      email: email.toLowerCase(),
      company: company || '',
      phone: phone || '',
      industries: industries || '',
      locations: locations || '',
      plan: plan || 'free',
      min_price: min_price ? Number(min_price) : null,
      max_price: max_price ? Number(max_price) : null,
      status: 'active',
      signed_up: new Date().toISOString()
    };

    // Save to JSON
    subs.push(sub);
    saveSubs(subs);

    // Auto-add to investors table
    const investorId = addToInvestors(sub);

    // Run matching engine
    const matchCount = runMatchingForAll();

    // Send emails (don't block the response)
    alertJ(sub, investorId, matchCount);
    welcomeEmail(sub);

    console.log('[SUBSCRIBE] New subscriber: ' + sub.name + ' (' + sub.email + ') -> Investor #' + investorId);

    res.json({ success: true, subscriber: sub, investorId });
  } catch (e) {
    console.error('[SUBSCRIBE] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET - List all subscribers
router.get('/', (req, res) => {
  res.json(loadSubs());
});

// GET - Subscriber count
router.get('/count', (req, res) => {
  const s = loadSubs();
  res.json({
    total: s.length,
    free: s.filter(x => x.plan === 'free').length,
    pro: s.filter(x => x.plan === 'pro').length,
    enterprise: s.filter(x => x.plan === 'enterprise').length
  });
});

module.exports = router;
