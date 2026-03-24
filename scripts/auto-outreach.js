const { db } = require('../db/database');
const { Resend } = require('resend');
require('dotenv').config();
const resend = new Resend(process.env.RESEND_API_KEY);

const TEMPLATES = {
  broker_intro: {
    subject: 'I have investors looking for {{industry}} deals — DealMatcher',
    html: `<div style="font-family:Arial;max-width:600px;margin:0 auto;">
<p>Hi {{name}},</p>
<p>I run DealMatcher, an AI-powered platform that matches commercial real estate listings with pre-qualified investors.</p>
<p>I have active investors looking for <strong>{{industry}}</strong> deals in the <strong>{{location}}</strong> range of <strong>{{price_range}}</strong>. If you have any listings that fit, I can run them through our matching engine and connect you with interested buyers within 24 hours.</p>
<p>Submit your listings here: <a href="https://dealmatcherapp.com/sell.html">dealmatcherapp.com/sell.html</a></p>
<p>Or just reply to this email with the details.</p>
<p>Best,<br>J Fields<br>DealMatcher<br>fields@dealmatcherapp.com</p></div>`
  },
  new_match_alert: {
    subject: '🎯 {{count}} investors matched your listing — {{listing_name}}',
    html: `<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:30px;border-radius:12px;">
<h2 style="color:#00d4aa;">New Investor Matches</h2>
<p>Your listing <strong>{{listing_name}}</strong> has {{count}} new investor matches.</p>
<p>Log in to your seller portal to see who's interested:</p>
<p><a href="https://dealmatcherapp.com/seller-portal.html" style="color:#00d4aa;font-size:16px;">View My Listings →</a></p>
<p style="color:#888;font-size:12px;">DealMatcher • fields@dealmatcherapp.com</p></div>`
  }
};

async function sendOutreach(to, templateKey, vars) {
  const template = TEMPLATES[templateKey];
  if (!template) { console.log('Unknown template:', templateKey); return; }
  let subject = template.subject;
  let html = template.html;
  Object.keys(vars).forEach(k => {
    const regex = new RegExp('{{' + k + '}}', 'g');
    subject = subject.replace(regex, vars[k]);
    html = html.replace(regex, vars[k]);
  });
  try {
    await resend.emails.send({ from: 'DealMatcher <fields@dealmatcherapp.com>', to, subject, html });
    console.log('[OUTREACH] Sent to', to, '|', templateKey);

    // Log to leads table if exists
    try {
      db.prepare("INSERT OR IGNORE INTO leads (name, email, source, status, priority, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(vars.name || to, to, 'auto-outreach', 'contacted', 'medium', 'Auto-outreach: ' + templateKey, new Date().toISOString());
    } catch(e) {}

    return true;
  } catch (e) {
    console.error('[OUTREACH] Failed:', to, e.message);
    return false;
  }
}

async function runBatchOutreach(contacts) {
  // contacts: [{email, name, industry, location, price_range}]
  let sent = 0;
  for (const c of contacts) {
    const success = await sendOutreach(c.email, 'broker_intro', c);
    if (success) sent++;
    // Rate limit: wait 2 seconds between emails
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('[OUTREACH] Batch complete:', sent, '/', contacts.length, 'sent');
  return sent;
}

if (require.main === module) {
  // Example: node scripts/auto-outreach.js
  console.log('Auto-outreach ready. Use: runBatchOutreach([{email, name, industry, location, price_range}])');
}

module.exports = { sendOutreach, runBatchOutreach, TEMPLATES };
