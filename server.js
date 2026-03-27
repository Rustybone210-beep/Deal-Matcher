require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
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

// Validate critical env vars on startup
const REQUIRED_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) console.error(`[STARTUP] WARNING: Missing required env var: ${key}`);
}

const app = express();
const PORT = process.env.PORT || 3001;

initDb();

// CORS — restrict to known origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3001',
].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 100 });
app.use('/api/auth/login', authLimiter);
app.use('/api/portal/login', authLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

// Auth check middleware for index.html
app.get('/', (req, res, next) => {
  // Serve login page check — the frontend JS will handle redirect
  next();
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.use(express.static(path.join(__dirname, 'public')));

// Public routes (no auth needed)
app.use('/api/auth', authRouter);
const portalRoutes = require('./routes/portal');
const sellerRoutes = require('./routes/seller');
const agreementsRoutes = require('./routes/agreements');
const agentRoutes = require('./routes/agent');
app.use('/api/subscribe', subscribeRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/agreements', agreementsRoutes);
app.use('/api/agent', agentRoutes);

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


// Auto-scrape cron: check for new CSV files daily at 6am CST
try {
  const { watchForCSVs } = require('./scripts/auto-scrape');
  cron.schedule('0 11 * * *', () => {
    console.log('[CRON] Running auto-scrape CSV watcher');
    watchForCSVs();
  });
  console.log('[CRON] Auto-scrape scheduled for 6am CST daily');

  // AI Agent: runs daily at 5am CST — searches for new deals and leads
  const { runAgent, sendDailyReport } = require('./scripts/deal-agent');
  cron.schedule('0 10 * * *', async () => {
    console.log('[CRON] Running AI Deal Agent');
    const results = await runAgent();
    await sendDailyReport(results);
  });
  console.log('[CRON] AI Deal Agent scheduled for 5am CST daily');
} catch(e) { console.log('[CRON] Auto-scrape setup skipped:', e.message); }

app.listen(PORT, () => {
  console.log('\n🎯 DealMatcher running on http://localhost:' + PORT + '\n');
});

// Bruce Agent
const Bruce = require('./agents/bruce');
const bruce = new Bruce(db);
bruce.initDb();
bruce.schedule();
app.use('/api/bruce', require('./routes/bruce')(db, bruce));

// Stripe
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/stripe', require('./routes/stripe')(db));
