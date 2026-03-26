'use strict';
const nodemailer = require('nodemailer');

async function generateAndSendNDA(db, interestId) {
  const interest = db.prepare(`
    SELECT ir.*, l.name as listing_name, l.industry, l.city, l.state,
           i.firm_name, i.contact_name, i.contact_email
    FROM interest_requests ir
    JOIN listings l ON l.id = ir.listing_id
    JOIN investors i ON i.id = ir.investor_id
    WHERE ir.id = ?
  `).get(interestId);
  if (!interest) throw new Error('Interest request not found');

  const date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const signUrl = `${process.env.FRONTEND_URL}/sign-nda.html?interest=${interestId}&token=${Buffer.from(String(interestId)).toString('base64')}`;

  if (process.env.SMTP_USER && interest.contact_email && interest.contact_email.includes('@')) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: 587, secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#060810;color:#f0f2f8;padding:32px">
      <h2 style="color:#34d399">DealMatcher — NDA Required</h2>
      <p>Thank you for your interest in the ${interest.industry || 'business'} opportunity in ${[interest.city,interest.state].filter(Boolean).join(', ')}.</p>
      <p>To receive full financials and deal details, please sign the Non-Disclosure and Non-Circumvention Agreement.</p>
      <p style="background:#0e111c;padding:16px;border-radius:8px;font-size:13px;color:#7c8599">This agreement protects a 2% facilitation fee payable to DealMatcher upon closing. It is binding for 24 months.</p>
      <a href="${signUrl}" style="display:inline-block;padding:16px 40px;background:#34d399;color:#041413;font-weight:700;border-radius:999px;text-decoration:none;margin-top:20px">Sign NDA and Get Deal Details</a>
      <p style="font-size:11px;color:#3d4560;margin-top:24px">DealMatcher — San Antonio, TX — ${date}</p>
    </div>`;
    await transporter.sendMail({
      from: `"DealMatcher" <${process.env.SMTP_USER}>`,
      to: interest.contact_email,
      subject: `NDA Required — Confidential Opportunity`,
      html
    });
  }

  db.prepare("UPDATE interest_requests SET nda_sent = 1, status = 'nda_sent' WHERE id = ?").run(interestId);
  return { success: true };
}

module.exports = { generateAndSendNDA };
