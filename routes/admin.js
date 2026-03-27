const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.get('/stats', (req, res) => {
  const listings = db.prepare('SELECT COUNT(*) AS c FROM listings').get().c;
  const investors = db.prepare('SELECT COUNT(*) AS c FROM investors').get().c;
  const matches = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  const strongMatches = db.prepare('SELECT COUNT(*) AS c FROM matches WHERE score >= 50').get().c;
  const newListings = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status = 'new'").get().c;
  const sent = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status = 'sent'").get().c;
  const interested = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status = 'interested'").get().c;
  const closed = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status = 'closed'").get().c;

  let outreachTotal = 0, outreachSent = 0, outreachReplied = 0, outreachMeeting = 0;
  try {
    outreachTotal = db.prepare('SELECT COUNT(*) AS c FROM outreach').get().c;
    outreachSent = db.prepare("SELECT COUNT(*) AS c FROM outreach WHERE status IN ('sent','opened','replied','interested','meeting','closed')").get().c;
    outreachReplied = db.prepare("SELECT COUNT(*) AS c FROM outreach WHERE status IN ('replied','interested','meeting','closed')").get().c;
    outreachMeeting = db.prepare("SELECT COUNT(*) AS c FROM outreach WHERE status IN ('meeting','closed')").get().c;
  } catch (e) {}

  res.json({
    listings, investors, matches, strongMatches,
    newListings, sent, interested, closed,
    outreachTotal, outreachSent, outreachReplied, outreachMeeting
  });
});

module.exports = router;
