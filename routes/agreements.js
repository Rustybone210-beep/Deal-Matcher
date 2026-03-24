const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { Resend } = require('resend');
const crypto = require('crypto');
const resend = new Resend(process.env.RESEND_API_KEY);
const J_EMAIL = 'fields@dealmatcherapp.com';

// Create agreements table if not exists
db.exec(`CREATE TABLE IF NOT EXISTS agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  investor_id INTEGER,
  listing_id INTEGER,
  investor_name TEXT,
  investor_email TEXT,
  seller_name TEXT,
  seller_email TEXT,
  listing_name TEXT,
  deal_value REAL,
  facilitation_fee REAL,
  investor_signed_at TEXT,
  seller_signed_at TEXT,
  investor_signature TEXT,
  seller_signature TEXT,
  agreement_hash TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS escrow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_id INTEGER,
  listing_id INTEGER,
  investor_id INTEGER,
  deal_value REAL,
  facilitation_fee REAL,
  escrow_agent TEXT,
  status TEXT DEFAULT 'initiated',
  initiated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  funded_at TEXT,
  closed_at TEXT,
  notes TEXT
)`);

// POST /api/agreements/create — generate NDA for a deal introduction
router.post('/create', async (req, res) => {
  try {
    const { investor_id, listing_id } = req.body;
    if (!investor_id || !listing_id) return res.status(400).json({ error: 'Missing data' });

    const investor = db.prepare('SELECT * FROM investors WHERE id = ?').get(investor_id);
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
    if (!investor || !listing) return res.status(404).json({ error: 'Not found' });

    const deal_value = listing.asking_price;
    const facilitation_fee = deal_value * 0.02;
    const hash = crypto.createHash('sha256').update(investor_id + '-' + listing_id + '-' + Date.now()).digest('hex');

    const result = db.prepare(
      'INSERT INTO agreements (type, investor_id, listing_id, investor_name, investor_email, listing_name, deal_value, facilitation_fee, agreement_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('nda_noncircumvent', investor_id, listing_id, investor.contact_name, investor.contact_email, listing.name, deal_value, facilitation_fee, hash, 'pending');

    // Email investor with NDA
    try {
      await resend.emails.send({
        from: 'DealMatcher <fields@dealmatcherapp.com>', to: investor.contact_email,
        subject: 'NDA Required: ' + listing.name + ' — DealMatcher',
        html: '<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">' +
          '<h2 style="color:#00d4aa;">Non-Disclosure & Non-Circumvention Agreement</h2>' +
          '<p>Before we proceed with the introduction for <strong>' + listing.name + '</strong>, please review and sign the following agreement:</p>' +
          '<div style="background:#16213e;padding:20px;border-radius:8px;margin:16px 0;font-size:13px;line-height:1.6;">' +
          '<p><strong>1. Confidentiality:</strong> All deal information shared is confidential and may not be disclosed to third parties.</p>' +
          '<p><strong>2. Non-Circumvention:</strong> Neither party shall circumvent DealMatcher to complete this transaction independently.</p>' +
          '<p><strong>3. Facilitation Fee:</strong> DealMatcher is entitled to a 2% facilitation fee ($' + facilitation_fee.toLocaleString() + ') on the completed transaction, payable at closing through escrow.</p>' +
          '<p><strong>4. Escrow:</strong> All transactions must be completed through a mutually agreed-upon escrow agent.</p>' +
          '</div>' +
          '<p>To sign, reply to this email with "I AGREE" or click the link below:</p>' +
          '<p><a href="https://dealmatcherapp.com/portal.html" style="color:#00d4aa;font-size:16px;">Sign Agreement →</a></p>' +
          '<p style="color:#888;font-size:11px;">Agreement ID: ' + hash.substring(0, 12) + ' | DealMatcher</p></div>'
      });
    } catch (e) { console.error('[NDA] Email failed:', e.message); }

    // Notify J
    try {
      await resend.emails.send({
        from: 'DealMatcher <fields@dealmatcherapp.com>', to: J_EMAIL,
        subject: '📋 NDA Created: ' + investor.contact_name + ' ↔ ' + listing.name,
        html: '<div style="font-family:Arial;background:#1a1a2e;color:#e0e0e0;padding:20px;border-radius:12px;">' +
          '<h3 style="color:#00d4aa;">NDA/Non-Circumvention Created</h3>' +
          '<p>Investor: ' + investor.contact_name + ' (' + investor.firm_name + ')</p>' +
          '<p>Listing: ' + listing.name + '</p>' +
          '<p>Deal Value: $' + deal_value.toLocaleString() + '</p>' +
          '<p>Your Fee (2%): $' + facilitation_fee.toLocaleString() + '</p>' +
          '<p>Status: Pending signature</p></div>'
      });
    } catch (e) {}

    res.json({ success: true, agreement_id: result.lastInsertRowid, hash: hash.substring(0, 12), facilitation_fee });
  } catch (e) {
    console.error('[NDA]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/agreements/sign — investor signs the NDA
router.post('/sign', (req, res) => {
  try {
    const { agreement_id, signature, role } = req.body;
    if (!agreement_id) return res.status(400).json({ error: 'Missing agreement_id' });

    const now = new Date().toISOString();
    if (role === 'seller') {
      db.prepare('UPDATE agreements SET seller_signed_at = ?, seller_signature = ?, status = CASE WHEN investor_signed_at IS NOT NULL THEN ? ELSE status END WHERE id = ?')
        .run(now, signature || 'e-signed', 'fully_signed', agreement_id);
    } else {
      db.prepare('UPDATE agreements SET investor_signed_at = ?, investor_signature = ?, status = CASE WHEN seller_signed_at IS NOT NULL THEN ? ELSE ? END WHERE id = ?')
        .run(now, signature || 'e-signed', 'fully_signed', 'investor_signed', agreement_id);
    }

    const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(agreement_id);

    // If both signed, auto-initiate escrow
    if (agreement.status === 'fully_signed') {
      db.prepare('INSERT INTO escrow (agreement_id, listing_id, investor_id, deal_value, facilitation_fee, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(agreement_id, agreement.listing_id, agreement.investor_id, agreement.deal_value, agreement.facilitation_fee, 'initiated');
      console.log('[ESCROW] Auto-initiated for agreement', agreement_id);
    }

    res.json({ success: true, status: agreement.status });
  } catch (e) { res.status(500).json({ error: 'Sign failed' }); }
});

// GET /api/agreements/list — get all agreements (admin)
router.get('/list', (req, res) => {
  try {
    const agreements = db.prepare('SELECT * FROM agreements ORDER BY created_at DESC').all();
    const escrows = db.prepare('SELECT * FROM escrow ORDER BY initiated_at DESC').all();
    res.json({ success: true, agreements, escrows });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
