'use strict';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dealmatcher-secret';

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Malformed token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return next();
  const token = header.split(' ')[1];
  if (!token) return next();
  try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) {}
  next();
}

module.exports = { requireAuth, optionalAuth, JWT_SECRET };
