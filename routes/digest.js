const express = require('express');
const router = express.Router();
const { Resend } = require('resend');
const { db } = require('../db/database');

const resend = new Resend(process.env.RESEND_API_KEY);

function getTopMatchesForInvestor(investorId, limit = 5) {
  return db.prepare(`
    SELECT m.score, m.reasons, l.name, l.city, l.state, l.asking_price, l.revenue, l.industry, l.url
    FROM matches m
    JOIN listings l ON l.id = m.listing_id
    WHERE m.investor_id = ? AND m.score >= 30
    ORDER BY m.score DESC
    LIMIT ?
  `).all(investorId, limit);
}

function buildDigestHtml(investor, matches) {
  const matchRows = matches.map((m, i) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #1e1e3a;color:#fff;font-weight:600;">${i + 1}. ${m.name}</td>
      <td style="padding:12px;border-bottom:1px solid #1e1e3a;color:#e0e0e0;">${[m.city, m.state].filter(Boolean).join(', ') || '—'}</td>
      <td style="padding:12px;border-bottom:1px solid #1e1e3a;color:#00d4aa;font-weight:700;">$${Number(m.asking_price || 0).toLocaleString()}</td>
      <td style="padding:12px;border-bottom:1px solid #1e1e3a;color:#ffd700;font-weight:700;">${m.score}/100</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">
      <h1 style="color:#00d4aa;margin-top:0;">🎯 Your Weekly Deal Matches</h1>
      <p>Hi ${investor.contact_name || 'Investor'},</p>
      <p>Here are your top matched deals this week based on your criteria:</p>
      <div style="background:#16213e;border-radius:8px;margin:20px 0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#0f1629;">
              <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Deal</th>
              <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Location</th>
              <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Price</th>
              <th style="padding:10px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Score</th>
            </tr>
          </thead>
          <tbody>${matchRows}</tbody>
        </table>
      </div>
      <p>Interested in any of these? Reply to this email and I'll send you full details and arrange an introduction.</p>
      <p style="margin-top:20px;">Your criteria: <strong style="color:#00d4aa;">${investor.industries || 'All industries'}</strong> in <strong>${investor.locations || 'All locations'}</strong>, $${Number(investor.min_price || 0).toLocaleString()} – $${Number(investor.max_price || 0).toLocaleString()}</p>
      <hr style="border-color:#333;margin:24px 0;">
      <p style="color:#888;font-size:12px;">DealMatcher • AI-Powered Deal Matching • San Antonio, TX<br>
      <a href="mailto:fields@dealmatcherapp.com" style="color:#00d4aa;">fields@dealmatcherapp.com</a></p>
    </div>
  `;
}

async function sendDigestForAll() {
  const investors = db.prepare('SELECT * FROM investors').all();
  let sent = 0;
  let skipped = 0;

  for (const inv of investors) {
    if (!inv.contact_email || inv.contact_email.includes('@example.com')) {
      skipped++;
      continue;
    }

    // Skip sample investors (no real emails)
    if (inv.contact_email.includes('lonestarhealth') || inv.contact_email.includes('pacificrimcap') ||
        inv.contact_email.includes('meridianreg') || inv.contact_email.includes('atlasindustrial') ||
        inv.contact_email.includes('greenfieldfo') || inv.contact_email.includes('bayouventures') ||
        inv.contact_email.includes('summitdental') || inv.contact_email.includes('heartlandpg') ||
        inv.contact_email.includes('coastalwellness') || inv.contact_email.includes('ironbridgepe')) {
      skipped++;
      continue;
    }

    const matches = getTopMatchesForInvestor(inv.id, 5);
    if (matches.length === 0) {
      skipped++;
      continue;
    }

    try {
      await resend.emails.send({
        from: 'DealMatcher <fields@dealmatcherapp.com>',
        to: inv.contact_email,
        subject: `Your Top ${matches.length} Deal Matches This Week — DealMatcher`,
        html: buildDigestHtml(inv, matches)
      });

      // Log the digest
      db.prepare('INSERT INTO digest_log (investor_id, listings_sent) VALUES (?, ?)').run(inv.id, matches.length);
      sent++;
      console.log('[DIGEST] Sent to ' + inv.contact_name + ' (' + inv.contact_email + ') — ' + matches.length + ' matches');
    } catch (e) {
      console.error('[DIGEST] Failed for ' + inv.contact_email + ':', e.message);
    }
  }

  console.log('[DIGEST] Complete: ' + sent + ' sent, ' + skipped + ' skipped');
  return { sent, skipped };
}

// Manual trigger endpoint
router.post('/send', async (req, res) => {
  try {
    const result = await sendDigestForAll();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Preview digest for a specific investor
router.get('/preview/:investorId', (req, res) => {
  const inv = db.prepare('SELECT * FROM investors WHERE id = ?').get(req.params.investorId);
  if (!inv) return res.status(404).json({ error: 'Investor not found' });
  const matches = getTopMatchesForInvestor(inv.id, 5);
  res.send(buildDigestHtml(inv, matches));
});

// Digest history
router.get('/log', (req, res) => {
  const logs = db.prepare('SELECT d.*, i.contact_name, i.contact_email FROM digest_log d JOIN investors i ON i.id = d.investor_id ORDER BY d.sent_at DESC LIMIT 50').all();
  res.json(logs);
});

module.exports = { router: router, sendDigestForAll };
