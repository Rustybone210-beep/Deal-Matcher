const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
router.get('/', (req, res) => {
  const minScore = Number(req.query.minScore || 0);
  const rows = db.prepare(`SELECT m.*, l.name AS listing_name, l.city, l.state, l.asking_price, l.revenue, l.industry, l.url, l.status, i.firm_name, i.contact_email FROM matches m JOIN listings l ON l.id = m.listing_id JOIN investors i ON i.id = m.investor_id WHERE m.score >= ? ORDER BY m.score DESC, m.created_at DESC`).all(minScore);
  res.json(rows);
});
router.get('/summary', (req, res) => {
  const rows = db.prepare(`SELECT l.id AS listing_id, l.name AS listing_name, l.status, l.city, l.state, l.industry, l.asking_price, l.revenue, best.score, i.firm_name AS best_investor_match FROM listings l LEFT JOIN matches best ON best.id = (SELECT m2.id FROM matches m2 WHERE m2.listing_id = l.id ORDER BY m2.score DESC LIMIT 1) LEFT JOIN investors i ON i.id = best.investor_id ORDER BY COALESCE(best.score, 0) DESC, l.created_at DESC`).all();
  res.json(rows);
});
module.exports = router;
