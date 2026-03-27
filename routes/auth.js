const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || '$2b$12$fPE0z7TgXjy4fuDY2yD/kenNfGqIxh.ug9ULUjdlBofNYAFXcuR5u';
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Login endpoint
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const valid = await bcrypt.compare(password, ADMIN_HASH);
  if (valid) {
    const token = generateToken();
    sessions.set(token, { created: Date.now() });
    // Clean old sessions (older than 24h)
    for (const [t, s] of sessions) {
      if (Date.now() - s.created > 86400000) sessions.delete(t);
    }
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// Check session
router.get('/check', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token && sessions.has(token)) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// Middleware for protecting API routes
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token && sessions.has(token)) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { router, requireAuth };
