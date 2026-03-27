const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// Generate teaser email for a match
router.post('/generate-teaser', (req, res) => {
  try {
    const { match_id } = req.body;
    if (!match_id) return res.status(400).json({ error: 'match_id required' });

    const m = db.prepare(`
      SELECT m.*, l.name AS listing_name, l.city, l.state, l.asking_price,
             l.revenue, l.industry, l.description, l.url,
             i.firm_name, i.contact_name, i.contact_email,
             i.industries AS inv_ind, i.locations AS inv_loc, i.preferred_structure
      FROM matches m
      JOIN listings l ON l.id = m.listing_id
      JOIN investors i ON i.id = m.investor_id
      WHERE m.id = ?
    `).get(match_id);

    if (!m) return res.status(404).json({ error: 'Match not found' });

    const fn = (m.contact_name || '').split(' ')[0] || 'there';
    const loc = [m.city, m.state].filter(Boolean).join(', ');
    const price = m.asking_price ? '$' + Number(m.asking_price).toLocaleString() : 'undisclosed';
    const rev = m.revenue ? '$' + Number(m.revenue).toLocaleString() : 'undisclosed';
    const reasons = (m.reasons || '').split(';').map(r => r.trim()).filter(Boolean);
    const rl = reasons[0] || 'Matches your criteria';

    const subj = (m.industry || 'Business') + ' opportunity in ' + (loc || 'your target market') + ' — ' + price;
    const body = 'Hi ' + fn + ',\n\n' +
      'A ' + (m.industry || 'business') + ' listing just came across my desk that fits your criteria at ' + m.firm_name + '.\n\n' +
      m.listing_name + '\n' +
      'Location: ' + (loc || 'See listing') + '\n' +
      'Asking: ' + price + '\n' +
      'Revenue: ' + rev + '\n\n' +
      'Why this fits: ' + rl + '.' +
      (m.score >= 60 ? ' Scored ' + m.score + '/100 against your profile.' : '') + '\n\n' +
      (m.description ? m.description.substring(0, 200) + (m.description.length > 200 ? '...' : '') : '') + '\n\n' +
      'Want the full details? I can send the complete listing package.\n\nBest,\nDealMatcher';

    const result = db.prepare(`
      INSERT INTO outreach (match_id, listing_id, investor_id, email_to, subject, body, status)
      VALUES (?, ?, ?, ?, ?, ?, 'draft')
    `).run(m.id, m.listing_id, m.investor_id, m.contact_email || '', subj, body);

    res.json({
      success: true,
      outreach: db.prepare('SELECT * FROM outreach WHERE id = ?').get(result.lastInsertRowid)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update outreach draft
router.put('/:id', (req, res) => {
  try {
    const { subject, body, email_to } = req.body;
    db.prepare(`
      UPDATE outreach
      SET subject = COALESCE(?, subject), body = COALESCE(?, body), email_to = COALESCE(?, email_to)
      WHERE id = ?
    `).run(subject || null, body || null, email_to || null, req.params.id);
    res.json({
      success: true,
      outreach: db.prepare('SELECT * FROM outreach WHERE id = ?').get(req.params.id)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send outreach
router.post('/:id/send', (req, res) => {
  try {
    const ex = db.prepare('SELECT * FROM outreach WHERE id = ?').get(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Not found' });
    db.prepare("UPDATE outreach SET status = 'sent', sent_at = ? WHERE id = ?")
      .run(new Date().toISOString(), req.params.id);
    db.prepare("UPDATE listings SET status = 'sent' WHERE id = ? AND status IN ('new','reviewed','ready_to_send')")
      .run(ex.listing_id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update outreach status
router.put('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const valid = new Set(['draft', 'sent', 'opened', 'replied', 'interested', 'meeting', 'closed', 'declined']);
    if (!valid.has(status)) return res.status(400).json({ error: 'Invalid status' });

    const ex = db.prepare('SELECT * FROM outreach WHERE id = ?').get(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Not found' });

    let oa = null, ra = null;
    if (status === 'opened' && !ex.opened_at) oa = new Date().toISOString();
    if (status === 'replied' && !ex.replied_at) ra = new Date().toISOString();

    db.prepare(`
      UPDATE outreach SET status = ?, opened_at = COALESCE(?, opened_at), replied_at = COALESCE(?, replied_at)
      WHERE id = ?
    `).run(status, oa, ra, req.params.id);

    if (status === 'interested') {
      db.prepare("UPDATE listings SET status = 'interested' WHERE id = ?").run(ex.listing_id);
    }
    if (status === 'closed') {
      db.prepare("UPDATE listings SET status = 'closed' WHERE id = ?").run(ex.listing_id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get outreach by listing
router.get('/listing/:id', (req, res) => {
  res.json(db.prepare(`
    SELECT o.*, i.firm_name, i.contact_name, i.contact_email
    FROM outreach o JOIN investors i ON i.id = o.investor_id
    WHERE o.listing_id = ? ORDER BY o.created_at DESC
  `).all(req.params.id));
});

// Get outreach by investor
router.get('/investor/:id', (req, res) => {
  res.json(db.prepare(`
    SELECT o.*, l.name AS listing_name, l.city, l.state, l.asking_price
    FROM outreach o JOIN listings l ON l.id = o.listing_id
    WHERE o.investor_id = ? ORDER BY o.created_at DESC
  `).all(req.params.id));
});

// Get all outreach
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT o.*, l.name AS listing_name, l.city, l.state, l.asking_price, l.industry,
           i.firm_name, i.contact_name, i.contact_email
    FROM outreach o
    JOIN listings l ON l.id = o.listing_id
    JOIN investors i ON i.id = o.investor_id
    ORDER BY o.created_at DESC
  `).all());
});

// Funnel stats — parameterized queries
router.get('/funnel', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS c FROM outreach WHERE status = ?');
    res.json({
      draft: count.get('draft').c,
      sent: count.get('sent').c,
      opened: count.get('opened').c,
      replied: count.get('replied').c,
      interested: count.get('interested').c,
      meeting: count.get('meeting').c,
      closed: count.get('closed').c,
      declined: count.get('declined').c,
      total: db.prepare('SELECT COUNT(*) AS c FROM outreach').get().c
    });
  } catch (e) {
    res.json({ draft: 0, sent: 0, opened: 0, replied: 0, interested: 0, meeting: 0, closed: 0, declined: 0, total: 0 });
  }
});

// Delete outreach
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM outreach WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
