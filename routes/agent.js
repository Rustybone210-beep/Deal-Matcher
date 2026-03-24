const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// POST /api/agent/run — manually trigger the agent
router.post('/run', async (req, res) => {
  try {
    const { runAgent } = require('../scripts/deal-agent');
    console.log('[AGENT] Manual trigger via API');
    const results = await runAgent();
    res.json({ success: true, ...results });
  } catch (e) {
    console.error('[AGENT] Run error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agent/leads — view discovered leads
router.get('/leads', (req, res) => {
  try {
    const leads = db.prepare('SELECT * FROM agent_leads ORDER BY found_at DESC LIMIT 100').all();
    const stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM agent_leads').get().c,
      new: db.prepare("SELECT COUNT(*) as c FROM agent_leads WHERE status = 'new'").get().c,
      contacted: db.prepare("SELECT COUNT(*) as c FROM agent_leads WHERE status = 'contacted'").get().c,
    };
    res.json({ success: true, leads, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/agent/log — view agent run history
router.get('/log', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM agent_log ORDER BY run_at DESC LIMIT 20').all();
    res.json({ success: true, logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/agent/leads/:id — update lead status
router.put('/leads/:id', (req, res) => {
  try {
    const { status, notes } = req.body;
    db.prepare('UPDATE agent_leads SET status = ?, notes = COALESCE(?, notes) WHERE id = ?').run(status, notes, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
