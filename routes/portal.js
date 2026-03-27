const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { Resend } = require('resend');
const crypto = require('crypto');
const resend = new Resend(process.env.RESEND_API_KEY);
const J_EMAIL = process.env.REPORT_EMAIL || 'fields@dealmatcherapp.com';

// In-memory portal sessions (investor side)
const portalSessions = new Map();

// Send a login code to investor's email
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const investor = db.prepare('SELECT * FROM investors WHERE contact_email = ?').get(email.toLowerCase());
    if (!investor) return res.status(404).json({ error: 'No account found for this email. Sign up at /subscribe.html' });

    // Generate 6-digit code, valid 10 minutes
    const code = crypto.randomInt(100000, 999999).toString();
    portalSessions.set(email.toLowerCase(), { code, investorId: investor.id, expires: Date.now() + 600000 });

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'DealMatcher <fields@dealmatcherapp.com>',
      to: email,
      subject: 'Your DealMatcher Login Code',
      html: '<div style="font-family:Arial;max-width:400px;margin:0 auto;padding:30px;">' +
        '<h2 style="color:#00d4aa;">DealMatcher Login</h2>' +
        '<p>Your verification code is:</p>' +
        '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#fff;background:#1a1a2e;padding:20px;text-align:center;border-radius:8px;">' + code + '</p>' +
        '<p style="color:#888;">This code expires in 10 minutes.</p></div>'
    });

    res.json({ success: true, message: 'Login code sent to your email' });
  } catch (e) {
    console.error('[PORTAL] Login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify login code and issue session token
router.post('/verify', (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const pending = portalSessions.get(email.toLowerCase());
    if (!pending || pending.code !== code) {
      return res.status(401).json({ error: 'Invalid code' });
    }
    if (Date.now() > pending.expires) {
      portalSessions.delete(email.toLowerCase());
      return res.status(401).json({ error: 'Code expired. Request a new one.' });
    }

    // Issue session token
    const token = crypto.randomBytes(32).toString('hex');
    portalSessions.delete(email.toLowerCase());
    portalSessions.set('session:' + token, { investorId: pending.investorId, created: Date.now() });

    // Clean old sessions
    for (const [k, v] of portalSessions) {
      if (k.startsWith('session:') && Date.now() - v.created > 86400000) portalSessions.delete(k);
    }

    const investor = db.prepare('SELECT * FROM investors WHERE id = ?').get(pending.investorId);
    const matches = db.prepare(`
      SELECT m.score, m.reasons, l.id as listing_id, l.name, l.city, l.state,
             l.asking_price, l.revenue, l.industry, l.url
      FROM matches m JOIN listings l ON l.id = m.listing_id
      WHERE m.investor_id = ? AND m.score >= 30
      ORDER BY m.score DESC LIMIT 25
    `).all(investor.id);
    const totalMatches = db.prepare('SELECT COUNT(*) as c FROM matches WHERE investor_id = ? AND score >= 30').get(investor.id).c;
    const strongMatches = db.prepare('SELECT COUNT(*) as c FROM matches WHERE investor_id = ? AND score >= 50').get(investor.id).c;

    res.json({
      success: true,
      token,
      investor: {
        id: investor.id, name: investor.contact_name, firm: investor.firm_name,
        email: investor.contact_email, industries: investor.industries,
        locations: investor.locations, min_price: investor.min_price, max_price: investor.max_price
      },
      matches,
      stats: { totalMatches, strongMatches }
    });
  } catch (e) {
    console.error('[PORTAL] Verify error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware: require portal auth for protected routes
function requirePortalAuth(req, res, next) {
  const token = req.headers['x-portal-token'];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const session = portalSessions.get('session:' + token);
  if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  if (Date.now() - session.created > 86400000) {
    portalSessions.delete('session:' + token);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.investorId = session.investorId;
  next();
}

// Express interest in a deal (protected)
router.post('/interested', requirePortalAuth, async (req, res) => {
  try {
    const { listing_id } = req.body;
    const investor_id = req.investorId;
    if (!listing_id) return res.status(400).json({ error: 'Missing listing_id' });

    const investor = db.prepare('SELECT * FROM investors WHERE id = ?').get(investor_id);
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
    if (!investor || !listing) return res.status(404).json({ error: 'Not found' });

    const existingMatch = db.prepare('SELECT id FROM matches WHERE listing_id = ? AND investor_id = ?').get(listing_id, investor_id);
    if (existingMatch) {
      try {
        db.prepare('INSERT INTO outreach (match_id, investor_id, listing_id, teaser_text, status) VALUES (?, ?, ?, ?, ?)')
          .run(existingMatch.id, investor_id, listing_id, investor.contact_name + ' expressed interest in ' + listing.name, 'interested');
      } catch (e) {}
    }

    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'DealMatcher <fields@dealmatcherapp.com>',
        to: J_EMAIL,
        subject: 'DEAL INTEREST: ' + investor.contact_name + ' wants ' + listing.name,
        html: '<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">' +
          '<h1 style="color:#00d4aa;">Deal Interest Alert</h1>' +
          '<p style="font-size:18px;color:#fff;"><strong>' + investor.contact_name + '</strong> from <strong>' + investor.firm_name + '</strong> is interested in a deal.</p>' +
          '<div style="background:#16213e;padding:20px;border-radius:8px;margin:20px 0;">' +
          '<h3 style="color:#00d4aa;">Property</h3>' +
          '<p style="color:#fff;font-size:16px;font-weight:bold;">' + listing.name + '</p>' +
          '<p>' + listing.city + ', ' + listing.state + '</p>' +
          '<p style="color:#00d4aa;font-size:20px;font-weight:bold;">$' + Number(listing.asking_price).toLocaleString() + '</p>' +
          (listing.url ? '<p><a href="' + listing.url + '" style="color:#00d4aa;">View Listing</a></p>' : '') +
          '</div>' +
          '<div style="background:#16213e;padding:20px;border-radius:8px;">' +
          '<h3 style="color:#00d4aa;">Investor</h3>' +
          '<p>' + investor.contact_name + '</p>' +
          '<p>' + investor.firm_name + '</p>' +
          '<p>Email: ' + investor.contact_email + '</p>' +
          '<p>Phone: ' + (investor.contact_phone || 'N/A') + '</p>' +
          '</div>' +
          '<p style="color:#ffd700;font-weight:bold;margin-top:16px;">NEXT: Request proof of funds, then make introduction.</p></div>'
      });
    } catch (e) {
      console.error('[PORTAL] Alert email failed:', e.message);
    }

    console.log('[PORTAL] INTEREST: ' + investor.contact_name + ' -> ' + listing.name);
    res.json({ success: true, message: 'Interest registered. Our team will reach out within 24 hours.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update investor criteria (protected)
router.put('/update', requirePortalAuth, (req, res) => {
  try {
    const { industries, locations, min_price, max_price } = req.body;
    const investor = db.prepare('SELECT * FROM investors WHERE id = ?').get(req.investorId);
    if (!investor) return res.status(404).json({ error: 'Not found' });

    db.prepare('UPDATE investors SET industries = ?, locations = ?, min_price = ?, max_price = ? WHERE id = ?')
      .run(industries || investor.industries, locations || investor.locations, min_price || investor.min_price, max_price || investor.max_price, investor.id);

    const { runMatchingForAll } = require('../matcher/engine');
    runMatchingForAll();
    res.json({ success: true, message: 'Criteria updated. Matches recalculated.' });
  } catch (e) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// AI chat (protected)
router.post('/chat', requirePortalAuth, async (req, res) => {
  const inv = db.prepare('SELECT * FROM investors WHERE id = ?').get(req.investorId);
  const notes = inv ? inv.notes || '' : '';
  if (notes.includes('free') || !process.env.ANTHROPIC_API_KEY) {
    return res.json({ reply: "The AI assistant is available on Pro and Enterprise plans. Browse your matches below and click 'I'm Interested' on any deal — our team will reach out within 24 hours. Upgrade to Pro for personalized AI deal guidance." });
  }
  try {
    const { message, investor_name, investor_criteria, matches_summary } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 500,
        system: 'You are DealMatcher AI, a concise deal matching assistant. Investor: ' + (investor_name || 'Unknown') + '. Criteria: ' + (investor_criteria || 'N/A') + '. Top matches: ' + (matches_summary || 'Loading') + '. Help them understand their matches and encourage clicking Interested on deals they want.',
        messages: [{ role: 'user', content: message }]
      })
    });
    const data = await response.json();
    res.json({ reply: data.content?.[0]?.text || "Browse your matches below and click 'I'm Interested' on any deal." });
  } catch (e) {
    res.json({ reply: "I'm here to help. Click on any deal for details or 'I'm Interested' to start the process." });
  }
});

module.exports = router;
