'use strict';
const nodemailer = require('nodemailer');

async function sendInvestorAlerts(db, client) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return 0;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587, secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  let sent = 0;
  const newMatches = db.prepare(`
    SELECT m.*, l.name as listing_name, l.city, l.state, l.industry, l.asking_price,
           i.firm_name, i.contact_name, i.contact_email
    FROM matches m
    JOIN listings l ON l.id = m.listing_id
    JOIN investors i ON i.id = m.investor_id
    WHERE m.score >= 60
    AND m.created_at >= datetime('now', '-1 day')
    AND i.contact_email IS NOT NULL AND i.contact_email != ''
    ORDER BY m.score DESC LIMIT 50
  `).all();
  for (const match of newMatches) {
    try {
      if (!match.contact_email || !match.contact_email.includes('@')) continue;
      const interestUrl = `${process.env.FRONTEND_URL}/interest.html?match=${match.id}`;
      const subject = `New ${match.industry || 'business'} match — Score ${match.score}/100`;
      const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#060810;color:#f0f2f8;padding:32px">
        <h2 style="color:#34d399">DealMatcher — New Match</h2>
        <p>A <strong>${match.industry || 'business'}</strong> opportunity in <strong>${[match.city,match.state].filter(Boolean).join(', ')}</strong> matches your criteria with a score of <strong style="color:#34d399">${match.score}/100</strong>.</p>
        <p>Asking Price: <strong>$${Number(match.asking_price||0).toLocaleString()}</strong></p>
        <p>${match.reasons || 'Strong criteria alignment'}</p>
        <a href="${interestUrl}" style="display:inline-block;padding:14px 32px;background:#34d399;color:#041413;font-weight:700;border-radius:999px;text-decoration:none;margin-top:16px">Request NDA and Details</a>
        <p style="font-size:11px;color:#3d4560;margin-top:24px">DealMatcher San Antonio TX — 2% facilitation fee applies on closing</p>
      </div>`;
      await transporter.sendMail({ from: `"DealMatcher" <${process.env.SMTP_USER}>`, to: match.contact_email, subject, html });
      db.prepare(`INSERT OR IGNORE INTO outreach (listing_id, investor_id, subject, body, status, sent_at, created_at) VALUES (?, ?, ?, ?, 'sent', datetime('now'), datetime('now'))`).run(match.listing_id, match.investor_id, subject, html);
      sent++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[ALERTER] ${match.contact_email}: ${err.message}`);
    }
  }
  return sent;
}

module.exports = { sendInvestorAlerts };
