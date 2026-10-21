'use strict';

const crypto = require('crypto');
const express = require('express');
const admin = require('firebase-admin');
const plans = require('../config/plans');

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const router = express.Router();

const DAY_MS = 86400000;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'optisitedigital@gmail.com')
  .trim()
  .toLowerCase();

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

function normalizeEmail(email) {
  const lower = String(email || '').trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 1) return lower;
  let local = lower.slice(0, at).split('+')[0];
  let domain = lower.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

function emailKey(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function isAdminUser(decoded) {
  return (
    decoded.email_verified === true &&
    typeof decoded.email === 'string' &&
    decoded.email.trim().toLowerCase() === ADMIN_EMAIL
  );
}

async function syncClaims(uid, sub, makeAdmin) {
  const user = await admin.auth().getUser(uid);
  const current = user.customClaims || {};
  const next = Object.assign({}, current, {
    subUntil: Number(sub.expiresAtMs) || 0,
    plan: sub.planId
  });
  if (makeAdmin) next.admin = true;
  else delete next.admin;

  const same =
    current.subUntil === next.subUntil &&
    current.plan === next.plan &&
    Boolean(current.admin) === Boolean(next.admin);
  if (!same) await admin.auth().setCustomUserClaims(uid, next);
}

function view(sub, now) {
  const expiresAtMs = Number(sub.expiresAtMs) || 0;
  const lapsed = expiresAtMs <= now;
  const status = sub.status === 'expired' || lapsed ? 'expired' : sub.status;
  const plan = plans.getPlan(sub.planId) || plans.getPlan('trial');
  const deleteAtMs = Number(sub.deleteAtMs) || null;

  return {
    status,
    planId: plan.id,
    planName: plan.name,
    limits: plan.limits,
    expiresAtMs,
    daysLeft: lapsed ? 0 : Math.ceil((expiresAtMs - now) / DAY_MS),
    deleteAtMs,
    daysUntilDelete: deleteAtMs ? Math.max(0, Math.ceil((deleteAtMs - now) / DAY_MS)) : null,
    country: typeof sub.country === 'string' ? sub.country : null,
    currency: typeof sub.currency === 'string' ? sub.currency : null
  };
}

router.use(requireUser);

router.post(
  '/init',
  wrap(async (req, res) => {
    const uid = req.user.uid;
    const email = typeof req.user.email === 'string' ? req.user.email : '';
    if (!email) return res.status(400).json({ error: 'email_required' });
    if (req.user.email_verified !== true) {
      return res.status(403).json({ error: 'email_not_verified' });
    }

    const makeAdmin = isAdminUser(req.user);
    const now = Date.now();
    const subRef = db.collection('subscriptions').doc(uid);
    const trialRef = db.collection('usedTrials').doc(emailKey(email));
    const statsRef = db.collection('adminStats').doc('global');

    const sub = await db.runTransaction(async (t) => {
      const [subSnap, trialSnap] = await Promise.all([t.get(subRef), t.get(trialRef)]);
      if (subSnap.exists) return subSnap.data();

      const trialAvailable = !trialSnap.exists;
      let doc;
      if (trialAvailable) {
        const end = now + plans.BILLING.trialDays * DAY_MS;
        doc = {
          status: 'trial',
          planId: 'trial',
          createdAtMs: now,
          trialEndsAtMs: end,
          expiresAtMs: end,
          updatedAtMs: now
        };
        t.create(trialRef, { createdAtMs: now });
      } else {
        doc = {
          status: 'expired',
          planId: 'trial',
          createdAtMs: now,
          expiresAtMs: now,
          deleteAtMs: now + plans.BILLING.trialGraceDays * DAY_MS,
          updatedAtMs: now
        };
      }

      t.create(subRef, doc);
      if (!makeAdmin) {
        t.set(
          statsRef,
          {
            counters: {
              total: FieldValue.increment(1),
              [trialAvailable ? 'trial' : 'expired']: FieldValue.increment(1)
            },
            updatedAtMs: now
          },
          { merge: true }
        );
      }
      return doc;
    });

    await syncClaims(uid, sub, makeAdmin);

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      isAdmin: makeAdmin,
      refreshToken: true,
      subscription: view(sub, now)
    });
  })
);

router.get(
  '/me',
  wrap(async (req, res) => {
    const snap = await db.collection('subscriptions').doc(req.user.uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'no_subscription' });

    const sub = snap.data();
    const now = Date.now();
    const stale =
      req.user.subUntil !== (Number(sub.expiresAtMs) || 0) ||
      req.user.plan !== sub.planId ||
      Boolean(req.user.admin) !== isAdminUser(req.user);

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      isAdmin: isAdminUser(req.user),
      refreshToken: stale,
      subscription: view(sub, now)
    });
  })
);

module.exports = router;
