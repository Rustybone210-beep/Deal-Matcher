require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { initDb, db } = require('./db/database');
const listingsRoutes = require('./routes/listings');
const investorsRoutes = require('./routes/investors');
const matchesRoutes = require('./routes/matches');
const adminRoutes = require('./routes/admin');
const outreachRoutes = require('./routes/outreach');
const subscribeRoutes = require('./routes/subscribe');
const { router: authRouter, requireAuth } = require('./routes/auth');
const { router: digestRouter, sendDigestForAll } = require('./routes/digest');
const { runMatchingForAll } = require('./matcher/engine');

const app = express();
const PORT = process.env.PORT || 3001;

initDb();

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

// Auth check middleware for index.html
app.get('/', (req, res, next) => {
  // Serve login page check — the frontend JS will handle redirect
  next();
});

app.get('/', (req, res) => { res.redirect('/subscribe.html'); });
app.use(express.static(path.join(__dirname, 'public')));

// Public routes (no auth needed)
app.use('/api/auth', authRouter);
const portalRoutes = require('./routes/portal');
const sellerRoutes = require('./routes/seller');
app.use('/api/subscribe', subscribeRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/seller', sellerRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'DealMatcher', time: new Date().toISOString() });
});

// Protected routes (auth required)
app.use('/api/listings', requireAuth, listingsRoutes);
app.use('/api/investors', requireAuth, investorsRoutes);
app.use('/api/matches', requireAuth, matchesRoutes);
app.use('/api/admin', requireAuth, adminRoutes);
app.use('/api/outreach', requireAuth, outreachRoutes);
app.use('/api/digest', requireAuth, digestRouter);

// Daily matching cron
const schedule = process.env.CRON_SCHEDULE || '0 7 * * *';
cron.schedule(schedule, async () => {
  console.log('[CRON] Running daily match');
  try {
    runMatchingForAll();
    console.log('[CRON] Done.');
  } catch (e) {
    console.error('[CRON] Failed:', e.message);
  }
});

// Weekly digest email - Monday 8am CST (13:00 UTC)
cron.schedule('0 13 * * 1', async () => {
  console.log('[CRON] Sending weekly digest');
  try {
    const result = await sendDigestForAll();
    console.log('[CRON] Digest done:', result);
  } catch (e) {
    console.error('[CRON] Digest failed:', e.message);
  }
});

app.listen(PORT, () => {
  console.log('\n🎯 DealMatcher running on http://localhost:' + PORT + '\n');
});
