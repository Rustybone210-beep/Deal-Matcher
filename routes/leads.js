const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.get('/', (req, res) => {
  try {
    const { status, priority, source, search, sort } = req.query;
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (priority) { query += ' AND priority = ?'; params.push(priority); }
    if (source) { query += ' AND source = ?'; params.push(source); }
    if (search) {
      query += ' AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR instagram LIKE ?)';
      const s = '%' + search + '%';
      params.push(s, s, s, s);
    }
    switch (sort) {
      case 'newest': query += ' ORDER BY created_at DESC'; break;
      case 'priority': query += " ORDER BY CASE priority WHEN 'hot' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 WHEN 'cold' THEN 5 END"; break;
      case 'score': query += ' ORDER BY verification_score DESC'; break;
      default: query += " ORDER BY CASE priority WHEN 'hot' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 WHEN 'cold' THEN 5 END, created_at DESC";
    }
    const leads = db.prepare(query).all(...params);
    const stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM leads').get().c,
      new: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'new'").get().c,
      contacted: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'contacted'").get().c,
      qualified: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'qualified'").get().c,
      active: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status IN ('negotiating','active')").get().c,
      closed: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'closed_won'").get().c,
      hot: db.prepare("SELECT COUNT(*) as c FROM leads WHERE priority = 'hot'").get().c,
      avgScore: db.prepare('SELECT AVG(verification_score) as avg FROM leads').get().avg || 0,
    };
    res.json({ leads, stats });
  } catch (e) {
    console.error('[LEADS] Error:', e.message);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const activities = db.prepare('SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
    const verifications = db.prepare('SELECT * FROM verifications WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);
    const deals = db.prepare('SELECT * FROM deal_pipeline WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ lead, activities, verifications, deals });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, email, phone, company, linkedin, instagram, source, source_detail, priority, deal_types, asset_types, price_range_min, price_range_max, markets, capital_available, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const result = db.prepare('INSERT INTO leads (name,email,phone,company,linkedin,instagram,source,source_detail,priority,deal_types,asset_types,price_range_min,price_range_max,markets,capital_available,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(name, email||null, phone||null, company||null, linkedin||null, instagram||null, source||'manual', source_detail||null, priority||'medium', deal_types||null, asset_types||null, price_range_min||null, price_range_max||null, markets||null, capital_available||null, notes||null);
    db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, 'created', 'Lead created', 'Added via ' + (source || 'manual entry'));
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, lead });
  } catch (e) {
    console.error('[LEADS] Create error:', e.message);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const fields = ['name','email','phone','company','linkedin','instagram','source','source_detail','status','priority','deal_types','asset_types','price_range_min','price_range_max','markets','capital_available','pof_status','last_contact_date','next_followup_date','notes'];
    const updates = [];
    const values = [];
    for (const field of fields) {
      if (req.body[field] !== undefined) { updates.push(field + ' = ?'); values.push(req.body[field]); }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);
    db.prepare('UPDATE leads SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    if (req.body.status && req.body.status !== lead.status) {
      db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(req.params.id, 'status_change', 'Status changed to ' + req.body.status, 'From ' + lead.status + ' to ' + req.body.status);
    }
    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    res.json({ success: true, lead: updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

router.post('/:id/activity', (req, res) => {
  try {
    const { type, title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(req.params.id, type || 'note', title, description || null);
    db.prepare("UPDATE leads SET last_contact_date = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add activity' });
  }
});

router.post('/:id/request-pof', (req, res) => {
  try {
    db.prepare("UPDATE leads SET pof_status = 'requested', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(req.params.id, 'pof_request', 'Proof of Funds requested', 'POF document requested from lead');
    res.json({ success: true, message: 'POF request logged' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to request POF' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM lead_activities WHERE lead_id = ?').run(req.params.id);
    db.prepare('DELETE FROM verifications WHERE lead_id = ?').run(req.params.id);
    db.prepare('DELETE FROM deal_pipeline WHERE lead_id = ?').run(req.params.id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

module.exports = router;
