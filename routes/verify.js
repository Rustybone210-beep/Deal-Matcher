const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.post('/company', (req, res) => {
  try {
    const { company, state } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });
    const lead = db.prepare('SELECT id FROM leads WHERE company LIKE ?').get('%' + company + '%');
    const result = {
      company_name: company,
      search_state: state || 'ALL',
      search_urls: {
        texas_sos: 'https://mycpa.cpa.state.tx.us/coa/coaSearchBtn',
        california_sos: 'https://bizfileonline.sos.ca.gov/search/business',
        florida_sunbiz: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName',
        sec_edgar: 'https://www.sec.gov/cgi-bin/browse-edgar?company=' + encodeURIComponent(company) + '&CIK=&type=&dateb=&owner=include&count=40&search_text=&action=getcompany',
        opencorporates: 'https://opencorporates.com/companies?q=' + encodeURIComponent(company),
        linkedin: 'https://www.linkedin.com/search/results/companies/?keywords=' + encodeURIComponent(company),
        bbb: 'https://www.bbb.org/search?find_text=' + encodeURIComponent(company),
        google: 'https://www.google.com/search?q=' + encodeURIComponent('"' + company + '" business registration'),
      },
      checklist: [
        { item: 'Secretary of State registration', status: 'pending' },
        { item: 'Active/Good standing status', status: 'pending' },
        { item: 'Registered agent on file', status: 'pending' },
        { item: 'Formation date', status: 'pending' },
        { item: 'BBB listing', status: 'pending' },
        { item: 'LinkedIn company page', status: 'pending' },
        { item: 'Physical address verified', status: 'pending' },
      ]
    };
    if (lead) {
      db.prepare('INSERT INTO verifications (lead_id, type, status, result_data, source) VALUES (?, ?, ?, ?, ?)').run(lead.id, 'company', 'pending', JSON.stringify(result), 'manual_lookup');
      db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(lead.id, 'verification', 'Company verification initiated', 'Looking up: ' + company);
    }
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Verification failed: ' + e.message });
  }
});

router.post('/linkedin', (req, res) => {
  try {
    const { name, company, linkedin_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const result = {
      person: name,
      company: company || 'Unknown',
      search_urls: {
        linkedin_people: 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(name + (company ? ' ' + company : '')),
        linkedin_direct: linkedin_url || null,
        google_linkedin: 'https://www.google.com/search?q=' + encodeURIComponent('site:linkedin.com "' + name + '"' + (company ? ' "' + company + '"' : '')),
      },
      checklist: [
        { item: 'Profile exists and matches name', status: 'pending' },
        { item: 'Current company matches claimed company', status: 'pending' },
        { item: 'Profile has 100+ connections', status: 'pending' },
        { item: 'Profile has activity/posts', status: 'pending' },
        { item: 'Profile photo looks legitimate', status: 'pending' },
        { item: 'Endorsements/recommendations present', status: 'pending' },
        { item: 'Account age (not brand new)', status: 'pending' },
      ],
      red_flags: [
        'New account (less than 6 months)',
        'No connections or very few',
        'No profile photo',
        'No work history',
        'Generic/stock photo',
        'Name does not match other records',
      ]
    };
    const lead = db.prepare('SELECT id FROM leads WHERE name LIKE ? OR company LIKE ?').get('%' + name + '%', '%' + (company || 'NOMATCH') + '%');
    if (lead) {
      db.prepare('INSERT INTO verifications (lead_id, type, status, result_data, source) VALUES (?, ?, ?, ?, ?)').run(lead.id, 'linkedin', 'pending', JSON.stringify(result), 'manual_lookup');
      db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(lead.id, 'verification', 'LinkedIn verification initiated', 'Looking up: ' + name);
    }
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Verification failed: ' + e.message });
  }
});

router.post('/instagram', (req, res) => {
  try {
    const { handle } = req.body;
    if (!handle) return res.status(400).json({ error: 'Instagram handle required' });
    const clean = handle.replace('@', '');
    const result = {
      handle: clean,
      search_urls: {
        instagram: 'https://www.instagram.com/' + clean,
        google: 'https://www.google.com/search?q=' + encodeURIComponent('"' + clean + '" instagram'),
      },
      checklist: [
        { item: 'Account exists', status: 'pending' },
        { item: 'Verified badge', status: 'pending' },
        { item: 'Real profile photo', status: 'pending' },
        { item: 'Consistent posting history', status: 'pending' },
        { item: 'Followers look organic', status: 'pending' },
        { item: 'Bio matches claimed business', status: 'pending' },
      ]
    };
    const lead = db.prepare('SELECT id FROM leads WHERE instagram LIKE ?').get('%' + clean + '%');
    if (lead) {
      db.prepare('INSERT INTO verifications (lead_id, type, status, result_data, source) VALUES (?, ?, ?, ?, ?)').run(lead.id, 'instagram', 'pending', JSON.stringify(result), 'manual_lookup');
      db.prepare('INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)').run(lead.id, 'verification', 'Instagram verification initiated', 'Looking up: @' + clean);
    }
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Verification failed: ' + e.message });
  }
});

router.put('/:verificationId', (req, res) => {
  try {
    const { status, result_data } = req.body;
    const v = db.prepare('SELECT * FROM verifications WHERE id = ?').get(req.params.verificationId);
    if (!v) return res.status(404).json({ error: 'Verification not found' });
    db.prepare("UPDATE verifications SET status = ?, result_data = ?, verified_at = datetime('now') WHERE id = ?").run(status || v.status, result_data || v.result_data, req.params.verificationId);
    const allV = db.prepare('SELECT * FROM verifications WHERE lead_id = ?').all(v.lead_id);
    const verified = allV.filter(x => x.status === 'verified').length;
    const total = allV.length;
    const score = total > 0 ? Math.round((verified / total) * 100) : 0;
    const types = { company: 0, linkedin: 0, pof: 0, identity: 0 };
    for (const x of allV) { if (x.status === 'verified' && types.hasOwnProperty(x.type)) types[x.type] = 1; }
    db.prepare("UPDATE leads SET verification_score = ?, company_verified = ?, linkedin_verified = ?, pof_verified = ?, identity_verified = ?, updated_at = datetime('now') WHERE id = ?").run(score, types.company, types.linkedin, types.pof, types.identity, v.lead_id);
    res.json({ success: true, score });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update verification' });
  }
});

module.exports = router;
