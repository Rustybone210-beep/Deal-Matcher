'use strict';
const nodemailer = require('nodemailer');

async function sendDailyReport(db, data) {
  if (!process.env.SMTP_USER || !process.env.REPORT_EMAIL) {
    console.log('[REPORTER] No SMTP config — skipping email');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587, secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const { dealsFound, buyersFound, edgarLeads, countyLeads, matchResult, alertsSent, elapsed, log } = data;
  const topMatches = db.prepare(`
    SELECT m.score, l.name as deal, l.asking_price, i.firm_name
    FROM matches m JOIN listings l ON l.id = m.listing_id JOIN investors i ON i.id = m.investor_id
    ORDER BY m.score DESC LIMIT 5
  `).all();
  const subject = `Bruce Report: ${dealsFound} deals, ${buyersFound} buyers, ${matchResult.totalMatches} matches`;
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#060810;color:#f0f2f8;padding:32px">
    <h2 style="color:#34d399">Bruce Daily Report</h2>
    <p>Cycle completed in ${elapsed}s</p>
    <table style="width:100%;margin:16px 0"><tr>
      <td style="padding:12px;background:#0e111c;border-radius:8px;text-align:center"><div style="color:#3d4560;font-size:11px">NEW DEALS</div><div style="color:#34d399;font-size:28px;font-weight:700">${dealsFound}</div></td>
      <td style="padding:4px"></td>
      <td style="padding:12px;background:#0e111c;border-radius:8px;text-align:center"><div style="color:#3d4560;font-size:11px">NEW BUYERS</div><div style="color:#3b82f6;font-size:28px;font-weight:700">${buyersFound}</div></td>
      <td style="padding:4px"></td>
      <td style="padding:12px;background:#0e111c;border-radius:8px;text-align:center"><div style="color:#3d4560;font-size:11px">MATCHES</div><div style="color:#f59e0b;font-size:28px;font-weight:700">${matchResult.totalMatches}</div></td>
      <td style="padding:4px"></td>
      <td style="padding:12px;background:#0e111c;border-radius:8px;text-align:center"><div style="color:#3d4560;font-size:11px">ALERTS</div><div style="color:#ec4899;font-size:28px;font-weight:700">${alertsSent}</div></td>
    </tr></table>
    <h3 style="margin-top:24px">Top Matches</h3>
    ${topMatches.map(m => `<div style="padding:10px;background:#0e111c;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between"><span>${m.deal}</span><span style="color:${m.score>=70?'#34d399':m.score>=45?'#f59e0b':'#7c8599'}">${m.score}/100</span></div>`).join('')}
    <a href="${process.env.FRONTEND_URL}" style="display:inline-block;padding:14px 32px;background:#34d399;color:#041413;font-weight:700;border-radius:999px;text-decoration:none;margin-top:24px">Open Dashboard</a>
  </div>`;
  try {
    await transporter.sendMail({ from: `"Bruce @ DealMatcher" <${process.env.SMTP_USER}>`, to: process.env.REPORT_EMAIL, subject, html });
    console.log('[REPORTER] Daily report sent to', process.env.REPORT_EMAIL);
  } catch (err) {
    console.error('[REPORTER]', err.message);
  }
}

module.exports = { sendDailyReport };
