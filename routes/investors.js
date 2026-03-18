const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { runMatchingForAll } = require('../matcher/engine');
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM investors ORDER BY created_at DESC').all());
});
router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM investors WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
});
router.post('/', (req, res) => {
  try {
    const b = req.body;
    if (!b.firm_name) return res.status(400).json({ error: 'Firm name required.' });
    const result = db.prepare(`INSERT INTO investors (firm_name, contact_name, contact_email, contact_phone, industries, locations, min_price, max_price, min_revenue, max_revenue, fund_size, preferred_structure, notes) VALUES (@firm_name, @contact_name, @contact_email, @contact_phone, @industries, @locations, @min_price, @max_price, @min_revenue, @max_revenue, @fund_size, @preferred_structure, @notes)`).run({
      firm_name:b.firm_name, contact_name:b.contact_name||null, contact_email:b.contact_email||null, contact_phone:b.contact_phone||null,
      industries:b.industries||null, locations:b.locations||null, min_price:b.min_price?Number(b.min_price):null, max_price:b.max_price?Number(b.max_price):null,
      min_revenue:b.min_revenue?Number(b.min_revenue):null, max_revenue:b.max_revenue?Number(b.max_revenue):null, fund_size:b.fund_size?Number(b.fund_size):null,
      preferred_structure:b.preferred_structure||null, notes:b.notes||null
    });
    runMatchingForAll();
    res.status(201).json(db.prepare('SELECT * FROM investors WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM investors WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    db.prepare(`UPDATE investors SET firm_name=@firm_name, contact_name=@contact_name, contact_email=@contact_email, contact_phone=@contact_phone, industries=@industries, locations=@locations, min_price=@min_price, max_price=@max_price, min_revenue=@min_revenue, max_revenue=@max_revenue, fund_size=@fund_size, preferred_structure=@preferred_structure, notes=@notes WHERE id=@id`).run({
      id:Number(req.params.id), firm_name:b.firm_name, contact_name:b.contact_name||null, contact_email:b.contact_email||null, contact_phone:b.contact_phone||null,
      industries:b.industries||null, locations:b.locations||null, min_price:b.min_price?Number(b.min_price):null, max_price:b.max_price?Number(b.max_price):null,
      min_revenue:b.min_revenue?Number(b.min_revenue):null, max_revenue:b.max_revenue?Number(b.max_revenue):null, fund_size:b.fund_size?Number(b.fund_size):null,
      preferred_structure:b.preferred_structure||null, notes:b.notes||null
    });
    runMatchingForAll();
    res.json(db.prepare('SELECT * FROM investors WHERE id = ?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM matches WHERE investor_id = ?').run(req.params.id);
    db.prepare('DELETE FROM investors WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
