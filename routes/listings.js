const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { runMatchingForAll, runMatchingForListing } = require('../matcher/engine');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const csvUpload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });
const VALID_STATUSES = new Set(['new','reviewed','ready_to_send','sent','interested','closed','archived']);
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM listings ORDER BY created_at DESC, id DESC').all());
});
router.get('/:id/details', (req, res) => {
  try {
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Not found' });
    const matches = db.prepare(`SELECT m.*, i.firm_name, i.contact_name, i.contact_email, i.contact_phone, i.industries, i.locations, i.preferred_structure FROM matches m JOIN investors i ON i.id = m.investor_id WHERE m.listing_id = ? ORDER BY m.score DESC`).all(req.params.id);
    res.json({ listing, matches });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const url = String(req.body.url || '').trim() || ('manual-' + Date.now());
    if (!name) return res.status(400).json({ error: 'Name required.' });
    const dup = db.prepare('SELECT id, name FROM listings WHERE url = ?').get(url);
    if (dup) return res.status(409).json({ error: 'URL exists.', code: 'DUPLICATE_URL', listingId: dup.id });
    const result = db.prepare(`INSERT INTO listings (source, external_id, name, city, state, asking_price, revenue, noi, industry, property_type, square_footage, description, url, status, scraped_at) VALUES (@source, @external_id, @name, @city, @state, @asking_price, @revenue, @noi, @industry, @property_type, @square_footage, @description, @url, @status, @scraped_at)`).run({
      source: req.body.source || 'Manual', external_id: null, name, city: req.body.city || null, state: req.body.state || null,
      asking_price: req.body.asking_price ? Number(req.body.asking_price) : null, revenue: req.body.revenue ? Number(req.body.revenue) : null,
      noi: req.body.noi ? Number(req.body.noi) : null, industry: req.body.industry || null, property_type: req.body.property_type || null,
      square_footage: req.body.square_footage ? Number(req.body.square_footage) : null, description: req.body.description || null,
      url, status: 'new', scraped_at: new Date().toISOString()
    });
    runMatchingForListing(result.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM listings WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE constraint')) return res.status(409).json({ error: 'URL exists.', code: 'DUPLICATE_URL' });
    res.status(500).json({ error: e.message });
  }
});
router.put('/:id/status', (req, res) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status.' });
    const existing = db.prepare('SELECT id FROM listings WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true, listing: db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM matches WHERE listing_id = ?').run(req.params.id);
    db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/import-csv', csvUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    const insert = db.prepare(`INSERT INTO listings (source, name, city, state, asking_price, revenue, noi, industry, property_type, square_footage, description, url, status, scraped_at) VALUES (@source, @name, @city, @state, @asking_price, @revenue, @noi, @industry, @property_type, @square_footage, @description, @url, @status, @scraped_at)`);
    let inserted = 0, skipped = 0;
    const parseNum = (v) => { const n = parseFloat(String(v || '').replace(/[$,]/g, '')); return isNaN(n) ? null : n; };
    for (const row of records) {
      const name = row['name'] || row['Name'] || row['title'] || row['Title'] || row['Business Name'] || '';
      if (!name.trim()) { skipped++; continue; }
      const url = row['url'] || row['URL'] || row['Link'] || row['link'] || ('csv-' + Date.now() + '-' + inserted);
      if (db.prepare('SELECT id FROM listings WHERE url = ?').get(url)) { skipped++; continue; }
      insert.run({ source:'CSV Import', name:name.trim(), city:row['city']||row['City']||null, state:row['state']||row['State']||null,
        asking_price:parseNum(row['asking_price']||row['Price']||row['Asking Price']), revenue:parseNum(row['revenue']||row['Revenue']||row['Annual Revenue']),
        noi:parseNum(row['noi']||row['NOI']), industry:row['industry']||row['Industry']||row['Category']||null,
        property_type:row['property_type']||row['Property Type']||null, square_footage:parseNum(row['square_footage']||row['Sq Ft']),
        description:row['description']||row['Description']||null, url, status:'new', scraped_at:new Date().toISOString()
      });
      inserted++;
    }
    fs.unlinkSync(req.file.path);
    if (inserted > 0) runMatchingForAll();
    res.json({ success: true, total: records.length, inserted, skipped });
  } catch (e) { try { fs.unlinkSync(req.file.path); } catch(_){} res.status(500).json({ error: e.message }); }
});
router.post('/run-matching', async (req, res) => {
  try { runMatchingForAll(); const count = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c; res.json({ success: true, totalMatches: count }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
