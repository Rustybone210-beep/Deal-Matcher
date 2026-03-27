'use strict';
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = (db) => {

  // Create checkout session
  router.post('/create-checkout', async (req, res) => {
    try {
      const { plan, email } = req.body;
      const priceId = plan === 'enterprise'
        ? process.env.STRIPE_ENTERPRISE_PRICE_ID
        : process.env.STRIPE_PRO_PRICE_ID;

      if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: email || undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.FRONTEND_URL}/dashboard?upgraded=true&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/subscribe.html?cancelled=true`,
        metadata: { plan }
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('[STRIPE]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Billing portal
  router.post('/billing-portal', async (req, res) => {
    try {
      const { customerId } = req.body;
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.FRONTEND_URL}/dashboard`
      });
      res.json({ url: session.url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(500).send('Webhook secret not configured');
      }
      event = stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[STRIPE WEBHOOK]', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
        const session = event.data.object;
        const plan = session.metadata?.plan || 'pro';
        const email = session.customer_email || session.customer_details?.email;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        console.log(`[STRIPE] Payment success — ${email} upgraded to ${plan}`);

        // Update or insert subscription record
        db.prepare(`
          CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            plan TEXT DEFAULT 'free',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `).run();

        const existing = db.prepare('SELECT id FROM subscriptions WHERE email = ?').get(email);
        if (existing) {
          db.prepare(`
            UPDATE subscriptions SET plan=?, status='active', stripe_customer_id=?, stripe_subscription_id=?, updated_at=datetime('now') WHERE email=?
          `).run(plan, customerId, subscriptionId, email);
        } else {
          db.prepare(`
            INSERT INTO subscriptions (email, stripe_customer_id, stripe_subscription_id, plan, status)
            VALUES (?, ?, ?, ?, 'active')
          `).run(email, customerId, subscriptionId, plan);
        }

        // Also update users table if exists
        db.prepare(`UPDATE users SET role=? WHERE email=?`).run(plan, email);
      }

      if (event.type === 'customer.subscription.deleted' || event.type === 'subscription_schedule.canceled') {
        const sub = event.data.object;
        db.prepare(`UPDATE subscriptions SET plan='free', status='cancelled', updated_at=datetime('now') WHERE stripe_subscription_id=?`).run(sub.id);
      }

      if (event.type === 'invoice.payment_failed') {
        const invoice = event.data.object;
        db.prepare(`UPDATE subscriptions SET status='past_due', updated_at=datetime('now') WHERE stripe_customer_id=?`).run(invoice.customer);
      }

    } catch (err) {
      console.error('[STRIPE WEBHOOK HANDLER]', err.message);
    }

    res.json({ received: true });
  });

  // Check subscription status
  router.get('/subscription/:email', (req, res) => {
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT,
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          plan TEXT DEFAULT 'free',
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `).run();
      const sub = db.prepare('SELECT * FROM subscriptions WHERE email = ?').get(req.params.email);
      res.json(sub || { plan: 'free', status: 'none' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
