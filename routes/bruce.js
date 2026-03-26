'use strict';
const express = require('express');
const router = express.Router();
const { generateAndSendNDA } = require('../agents/ndaGenerator');
const { requireAuth } = require('../middleware/auth');

module.exports = (db, bruce) => {

  router.get('/status', (req, res) => {
    try {
      const lastRun = db.prepare('SELECT * FROM bruce_runs ORDER BY id DESC LIMIT 1').get();
      res.json({
        running: bruce.running,
        lastRun: lastRun || null,
        totalRuns: db.prepare('SELECT COUNT(*) as c FROM bruce_runs').get().c,
        totalLeads: db.prepare('SELECT COUNT(*) as c FROM buyer_leads').get().c
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/run', requireAuth, async (req, res) => {
    res.json({ message: 'Bruce cycle started' });
    bruce.run().catch(console.error);
  });

  router.get('/runs', requireAuth, (req, res) => {
    try {
      res.json(db.prepare('SELECT id, status, deals_found, buyers_found, matches_total, alerts_sent, elapsed_seconds, created_at FROM bruce_runs ORDER BY id DESC LIMIT 20').all());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/leads', requireAuth, (req, res) => {
    try {
      res.json(db.prepare('SELECT * FROM buyer_leads ORDER BY created_at DESC LIMIT 100').all());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/leads/:id/convert', requireAuth, (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM buyer_leads WHERE id = ?').get(req.params.id);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      const result = db.prepare(`
        INSERT INTO investors (firm_name, contact_name, contact_email, industries, locations, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(lead.name || 'Unknown', lead.name || '', lead.email || '', lead.industries || '', lead.locations || '', `From ${lead.source}: ${(lead.raw_text||'').slice(0,200)}`);
      db.prepare('UPDATE buyer_leads SET converted = 1 WHERE id = ?').run(lead.id);
      res.json({ success: true, investorId: result.lastInsertRowid });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/interest', async (req, res) => {
    try {
      const { match_id, investor_id, listing_id, name, firm, email } = req.body;
      if (!listing_id) return res.status(400).json({ error: 'listing_id required' });
      let invId = investor_id;
      if (!invId && email) {
        const existing = db.prepare('SELECT id FROM investors WHERE contact_email = ?').get(email);
        if (existing) {
          invId = existing.id;
        } else {
          const r = db.prepare(`INSERT INTO investors (firm_name, contact_name, contact_email, created_at) VALUES (?, ?, ?, datetime('now'))`).run(firm || name || 'Unknown', name || '', email || '');
          invId = r.lastInsertRowid;
        }
      }
      const existing = db.prepare('SELECT id FROM interest_requests WHERE investor_id = ? AND listing_id = ?').get(invId, listing_id);
      let interestId = existing?.id;
      if (!interestId) {
        const r = db.prepare(`INSERT INTO interest_requests (investor_id, listing_id, match_id, status, created_at) VALUES (?, ?, ?, 'pending', datetime('now'))`).run(invId, listing_id, match_id || null);
        interestId = r.lastInsertRowid;
      }
      await generateAndSendNDA(db, interestId);
      res.json({ success: true, interestId, message: 'NDA sent to investor email.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/nda/:interestId', (req, res) => {
    try {
      const interest = db.prepare(`
        SELECT ir.*, l.name as listing_name, l.industry, l.city, l.state, l.asking_price, m.score,
               i.firm_name, i.contact_name, i.contact_email
        FROM interest_requests ir
        JOIN listings l ON l.id = ir.listing_id
        JOIN investors i ON i.id = ir.investor_id
        LEFT JOIN matches m ON m.listing_id = ir.listing_id AND m.investor_id = ir.investor_id
        WHERE ir.id = ?
      `).get(req.params.interestId);
      if (!interest) return res.status(404).json({ error: 'Not found' });
      res.json(interest);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/nda/:interestId/sign', async (req, res) => {
    try {
      const { name, email } = req.body;
      db.prepare("UPDATE interest_requests SET nda_signed = 1, status = 'nda_signed' WHERE id = ?").run(req.params.interestId);
      console.log(`[BRUCE] NDA SIGNED — Interest #${req.params.interestId} — ${name} <${email}>`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/chat', async (req, res) => {
    try {
      const { message, userId, history } = req.body;
      if (!message) return res.status(400).json({ error: 'message required' });
      const result = await bruce.chat(userId || 0, message, history || []);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
