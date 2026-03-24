const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const J_EMAIL = 'fields@dealmatcherapp.com';

// POST /api/seller/submit — broker/seller submits a new listing
router.post('/submit', async (req, res) => {
  try {
    const { name, city, state, asking_price, revenue, industry, url, description, contact_name, contact_email, contact_phone, role } = req.body;
    if (!name || !asking_price || !industry || !contact_email) {
      return res.status(400).json({ error: 'Required: name, asking_price, industry, contact_email' });
    }
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO listings (name, city, state, asking_price, revenue, industry, url, source, status, scraped_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name, city || '', state || '', parseFloat(asking_price), parseFloat(revenue) || 0, industry.toLowerCase(), url || '', 'seller-submit', 'new', now);
    const listingId = result.lastInsertRowid;

    // Run matching engine
    const { runMatchingForAll } = require('../matcher/engine');
    const totalMatches = runMatchingForAll();

    // Find investors who match this new listing
    const matches = db.prepare(
      'SELECT m.score, m.reasons, i.contact_name, i.contact_email, i.firm_name FROM matches m JOIN investors i ON i.id = m.investor_id WHERE m.listing_id = ? AND m.score >= 50 ORDER BY m.score DESC'
    ).all(listingId);

    // Email J with the submission + match results
    try {
      await resend.emails.send({
        from: 'DealMatcher <fields@dealmatcherapp.com>', to: J_EMAIL,
        subject: '🆕 NEW LISTING: ' + name + ' ($' + Number(asking_price).toLocaleString() + ') — ' + matches.length + ' investor matches',
        html: '<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">' +
          '<h1 style="color:#00d4aa;">🆕 New Listing Submitted</h1>' +
          '<div style="background:#16213e;padding:20px;border-radius:8px;margin:12px 0;">' +
          '<p style="color:#fff;font-size:18px;font-weight:bold;">' + name + '</p>' +
          '<p>' + (city || '') + ', ' + (state || '') + '</p>' +
          '<p style="color:#00d4aa;font-size:22px;font-weight:bold;">$' + Number(asking_price).toLocaleString() + '</p>' +
          '<p>Industry: ' + industry + '</p>' +
          (description ? '<p>Description: ' + description + '</p>' : '') +
          (url ? '<p><a href="' + url + '" style="color:#00d4aa;">Listing URL</a></p>' : '') +
          '</div>' +
          '<div style="background:#16213e;padding:20px;border-radius:8px;margin:12px 0;">' +
          '<h3 style="color:#00d4aa;">Submitted By</h3>' +
          '<p><strong>' + contact_name + '</strong> (' + (role || 'Not specified') + ')</p>' +
          '<p>Email: ' + contact_email + '</p>' +
          '<p>Phone: ' + (contact_phone || 'N/A') + '</p>' +
          '</div>' +
          '<div style="background:#16213e;padding:20px;border-radius:8px;margin:12px 0;">' +
          '<h3 style="color:#00d4aa;">🎯 ' + matches.length + ' Investor Matches Found</h3>' +
          (matches.length > 0 ? matches.slice(0, 5).map(m =>
            '<p>• <strong>' + m.contact_name + '</strong> (' + m.firm_name + ') — Score: ' + m.score + '</p>'
          ).join('') : '<p>No strong matches yet. Matches will improve as more investors sign up.</p>') +
          '</div>' +
          '<p style="color:#888;font-size:12px;">DealMatcher Seller Submission • ' + now + '</p></div>'
      });
    } catch (e) { console.error('[SELLER] Alert email failed:', e.message); }

    // Email matched investors about the new listing
    for (const m of matches.slice(0, 10)) {
      if (m.contact_email && !m.contact_email.includes('sample')) {
        try {
          await resend.emails.send({
            from: 'DealMatcher <fields@dealmatcherapp.com>', to: m.contact_email,
            subject: '🎯 New Match: ' + name + ' ($' + Number(asking_price).toLocaleString() + ') — Score: ' + m.score,
            html: '<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">' +
              '<h1 style="color:#00d4aa;">🎯 New Deal Match</h1>' +
              '<p style="color:#fff;font-size:16px;">Hi ' + m.contact_name.split(' ')[0] + ', a new listing just matched your criteria:</p>' +
              '<div style="background:#16213e;padding:20px;border-radius:8px;margin:12px 0;">' +
              '<p style="color:#fff;font-size:18px;font-weight:bold;">' + name + '</p>' +
              '<p>' + (city || '') + ', ' + (state || '') + '</p>' +
              '<p style="color:#00d4aa;font-size:22px;font-weight:bold;">$' + Number(asking_price).toLocaleString() + '</p>' +
              '<p>Industry: ' + industry + ' | Match Score: ' + m.score + '/100</p>' +
              '</div>' +
              '<p style="margin-top:16px;">Log in to your portal to view details and express interest:</p>' +
              '<p><a href="https://dealmatcherapp.com/portal.html" style="color:#00d4aa;font-size:16px;">View My Matches →</a></p>' +
              '<p style="color:#888;font-size:12px;margin-top:20px;">DealMatcher • fields@dealmatcherapp.com</p></div>'
          });
        } catch (e) { console.error('[SELLER] Investor notification failed:', e.message); }
      }
    }

    console.log('[SELLER] New listing: ' + name + ' | $' + asking_price + ' | ' + matches.length + ' matches');
    res.json({
      success: true,
      listing_id: listingId,
      matches_found: matches.length,
      message: 'Listing submitted! Our AI found ' + matches.length + ' investor matches. We\'ll be in touch within 24 hours.'
    });
  } catch (e) {
    console.error('[SELLER] Submit error:', e.message);
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'This listing already exists.' });
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/seller/status/:email — seller checks their listing status
router.get('/status/:email', (req, res) => {
  try {
    const listings = db.prepare(
      "SELECT l.*, (SELECT COUNT(*) FROM matches m WHERE m.listing_id = l.id AND m.score >= 50) as match_count FROM listings l WHERE l.source = 'seller-submit' ORDER BY l.scraped_at DESC"
    ).all();
    res.json({ success: true, listings });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
