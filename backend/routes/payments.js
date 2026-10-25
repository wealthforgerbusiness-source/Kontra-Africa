'use strict';

const crypto = require('crypto');
const express = require('express');
const admin = require('firebase-admin');
const plans = require('../config/plans');
const webhook = require('./webhook');

const db = admin.firestore();
const router = express.Router();

const SASPAY_CHECKOUT_URL = 'https://api.saspay.me/api/v1/checkout-sessions/';
const COOLDOWN_MS = 15000;
const CHECK_EVERY_MS = 6000;
const CHECK_AFTER_MS = 8000;
const REQUEST_TIMEOUT_MS = 15000;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function requireUser(req, res, next) {
  const match = /^Bearer\s+(\S+)$/.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.user = await admin.auth().verifyIdToken(match[1]);
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function isActive(sub, nowMs) {
  return Boolean(
    sub &&
      sub.status === 'active' &&
      plans.isPaidPlan(sub.planId) &&
      Number.isFinite(sub.expiresAtMs) &&
      sub.expiresAtMs > nowMs
  );
}

function buildQuote(sub, planId, countryCode, nowMs) {
  const country = plans.getCountry(countryCode);
  if (!country || !plans.isPaidPlan(planId)) return { ok: false, reason: 'invalid' };
  const active = isActive(sub, nowMs);
  const sameCurrency = active && sub.currency === country.currency;
  return plans.upgradeQuote({
    currentPlanId: active ? sub.planId : 'trial',
    targetPlanId: planId,
    countryCode: country.code,
    paidAmount: sameCurrency ? Number(sub.paidAmount) : undefined,
    expiresAtMs: active ? sub.expiresAtMs : 0,
    nowMs
  });
}

function quoteError(res, quote) {
  const status = quote.reason === 'downgrade_at_renewal' ? 409 : 400;
  return res.status(status).json({ error: quote.reason || 'invalid' });
}

function readBody(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return {
    planId: typeof body.planId === 'string' ? body.planId : '',
    country: typeof body.country === 'string' ? body.country.toUpperCase() : ''
  };
}

async function createSession(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SASPAY_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.SASPAY_SECRET_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function safeCheckoutUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (host !== 'saspay.me' && !host.endsWith('.saspay.me')) return null;
    return url.toString();
  } catch (_err) {
    return null;
  }
}

router.use(requireUser);

router.post(
  '/quote',
  wrap(async (req, res) => {
    const { planId, country } = readBody(req);
    if (!planId || !country) return res.status(400).json({ error: 'invalid' });

    const subSnap = await db.collection('subscriptions').doc(req.user.uid).get();
    const sub = subSnap.exists ? subSnap.data() : null;
    const quote = buildQuote(sub, planId, country, Date.now());
    if (!quote.ok) return quoteError(res, quote);

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      planId,
      country,
      type: quote.type,
      currency: quote.currency,
      credit: quote.credit,
      amount: quote.amount,
      days: quote.days
    });
  })
);

router.post(
  '/checkout',
  wrap(async (req, res) => {
    const { planId, country } = readBody(req);
    if (!planId || !country) return res.status(400).json({ error: 'invalid' });

    const uid = req.user.uid;
    const email = typeof req.user.email === 'string' ? req.user.email : '';
    if (!email) return res.status(400).json({ error: 'email_required' });

    const subRef = db.collection('subscriptions').doc(uid);
    const lockRef = db.collection('checkoutLocks').doc(uid);
    const [subSnap, lockSnap] = await db.getAll(subRef, lockRef);
    const sub = subSnap.exists ? subSnap.data() : null;
    const now = Date.now();

    if (lockSnap.exists && Number(lockSnap.data().at) > now - COOLDOWN_MS) {
      return res.status(429).json({ error: 'slow_down' });
    }

    const quote = buildQuote(sub, planId, country, now);
    if (!quote.ok) return quoteError(res, quote);

    const plan = plans.getPlan(planId);
    const paymentId = crypto.randomUUID();
    const payRef = db.collection('payments').doc(paymentId);

    await Promise.all([
      lockRef.set({ at: now }),
      payRef.set({
        uid,
        planId,
        country,
        currency: quote.currency,
        amount: quote.amount,
        credit: quote.credit,
        type: quote.type,
        status: 'PENDING',
        createdAtMs: now
      })
    ]);

    const name = String(req.user.name || email.split('@')[0]).slice(0, 80);
    const returnUrl =
      String(process.env.APP_BASE_URL).replace(/\/+$/, '') + '/app.html?payment=' + paymentId;

    let result;
    try {
      result = await createSession({
        amount: Number(quote.amount).toFixed(2),
        currency: quote.currency,
        description: 'Kontra Africa - ' + plan.name + ' [KA:' + paymentId + ']',
        country,
        customer_email: email,
        customer_name: name,
        return_url: returnUrl,
        metadata: { payment_id: paymentId, uid, plan_id: planId, country }
      });
    } catch (err) {
      console.error('SasPay indisponible:', err && err.name ? err.name : 'error');
      await payRef.update({ status: 'FAILED', failReason: 'provider_unreachable' });
      return res.status(502).json({ error: 'payment_provider_error' });
    }

    const data = result.json && result.json.data;
    const checkoutUrl = data ? safeCheckoutUrl(data.checkout_url) : null;

    if (result.status !== 201 || !result.json || result.json.success !== true || !checkoutUrl) {
      console.error('SasPay a refusé la session, HTTP ' + result.status);
      await payRef.update({
        status: 'FAILED',
        failReason: 'provider_rejected',
        providerHttp: result.status
      });
      return res.status(502).json({ error: 'payment_provider_error' });
    }

    await payRef.update({
      saspaySessionId: typeof data.id === 'string' ? data.id : null,
      saspaySlug: typeof data.slug === 'string' ? data.slug : null
    });

    res.set('Cache-Control', 'no-store');
    return res.status(201).json({
      ok: true,
      paymentId,
      checkoutUrl,
      type: quote.type,
      currency: quote.currency,
      credit: quote.credit,
      amount: quote.amount
    });
  })
);

router.get(
  '/status/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid' });

    const payRef = db.collection('payments').doc(id);
    const snap = await payRef.get();
    let data = snap.exists ? snap.data() : null;
    if (!data || data.uid !== req.user.uid) return res.status(404).json({ error: 'not_found' });

    const now = Date.now();
    if (
      data.status === 'PENDING' &&
      data.saspaySessionId &&
      now - Number(data.createdAtMs || 0) > CHECK_AFTER_MS &&
      now - Number(data.lastCheckMs || 0) > CHECK_EVERY_MS
    ) {
      await payRef.update({ lastCheckMs: now }).catch(() => null);
      const changed = await webhook.confirmFromSession(payRef, data);
      if (changed) {
        const fresh = await payRef.get();
        if (fresh.exists) data = fresh.data();
      }
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      status: data.status,
      planId: data.planId,
      type: data.type,
      amount: data.amount,
      currency: data.currency
    });
  })
);

module.exports = router;
