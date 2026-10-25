'use strict';

const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');
const plans = require('../config/plans');

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const AggregateField = admin.firestore.AggregateField;
const router = express.Router();

const DAY_MS = 86400000;
const STATS_TTL_MS = 60 * 1000;
const MONTHS_BACK = 6;
const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const PAY_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const STATUSES = ['trial', 'active', 'expired'];
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'optisitedigital@gmail.com')
  .trim()
  .toLowerCase();

let statsCache = { at: 0, body: null };

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function requireAdmin(req, res, next) {
  const match = /^Bearer\s+(\S+)$/.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ error: 'unauthorized' });
  try {
    const decoded = await admin.auth().verifyIdToken(match[1], true);
    const email = String(decoded.email || '').trim().toLowerCase();
    if (decoded.admin !== true || decoded.email_verified !== true || email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.user = decoded;
    res.set('Cache-Control', 'no-store');
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

function monthId(date) {
  return date.toISOString().slice(0, 7);
}

function lastMonths(now) {
  const ids = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < MONTHS_BACK; i += 1) {
    ids.push(monthId(d));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return ids;
}

function toUsd(byCurrency) {
  let total = 0;
  Object.keys(byCurrency || {}).forEach((cur) => {
    const rate = plans.USD_RATES[cur];
    const value = Number(byCurrency[cur]);
    if (rate && Number.isFinite(value)) total += value / rate;
  });
  return Math.round(total * 100) / 100;
}

function cleanMap(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  Object.keys(value).forEach((k) => {
    const n = Number(value[k]);
    if (Number.isFinite(n)) out[k] = Math.round(n * 100) / 100;
  });
  return out;
}

function monthView(id, data) {
  const d = data || {};
  const gross = cleanMap(d.gross);
  const fee = cleanMap(d.fee);
  const net = cleanMap(d.net);
  return {
    month: id,
    paidCount: Number(d.paidCount) || 0,
    deletedCount: Number(d.deletedCount) || 0,
    gross,
    fee,
    net,
    grossUsd: toUsd(gross),
    feeUsd: toUsd(fee),
    netUsd: toUsd(net),
    byCountry: d.byCountry && typeof d.byCountry === 'object' ? d.byCountry : {}
  };
}

async function computeMrrAggregate() {
  const col = db.collection('subscriptions');
  const currencies = Object.keys(plans.LOCAL_PRICES);

  const [sums, planCounts] = await Promise.all([
    Promise.all(
      currencies.map((cur) =>
        col
          .where('status', '==', 'active')
          .where('currency', '==', cur)
          .aggregate({ total: AggregateField.sum('paidAmount'), count: AggregateField.count() })
          .get()
      )
    ),
    Promise.all(
      plans.PAID_PLAN_IDS.map((id) =>
        col.where('status', '==', 'active').where('planId', '==', id).count().get()
      )
    )
  ]);

  const mrr = {};
  const activeByCurrency = {};
  currencies.forEach((cur, i) => {
    const data = sums[i].data();
    mrr[cur] = Number(data.total) || 0;
    activeByCurrency[cur] = Number(data.count) || 0;
  });

  const activeByPlan = {};
  plans.PAID_PLAN_IDS.forEach((id, i) => {
    activeByPlan[id] = planCounts[i].data().count;
  });

  return { mrr, mrrUsd: toUsd(mrr), activeByCurrency, activeByPlan };
}


/* Plan B quand les index Firestore ne sont pas encore créés : on lit les abonnements actifs
   (un seul filtre, donc aucun index spécial) et on additionne ici. */
async function computeMrrScan() {
  const currencies = Object.keys(plans.LOCAL_PRICES);
  const snap = await db.collection('subscriptions').where('status', '==', 'active').limit(5000).get();
  const mrr = {};
  const activeByCurrency = {};
  currencies.forEach((cur) => { mrr[cur] = 0; activeByCurrency[cur] = 0; });
  const activeByPlan = {};
  plans.PAID_PLAN_IDS.forEach((id) => { activeByPlan[id] = 0; });
  snap.forEach((d) => {
    const s = d.data();
    if (s.currency in mrr) {
      mrr[s.currency] += Number(s.paidAmount) || 0;
      activeByCurrency[s.currency] += 1;
    }
    if (s.planId in activeByPlan) activeByPlan[s.planId] += 1;
  });
  return { mrr, mrrUsd: toUsd(mrr), activeByCurrency, activeByPlan };
}

async function computeMrr() {
  try {
    return await computeMrrAggregate();
  } catch (err) {
    console.error('computeMrr (agrégats, index manquant ?):', err && err.message ? err.message : err);
    try {
      return await computeMrrScan();
    } catch (err2) {
      console.error('computeMrr (plan B):', err2 && err2.message ? err2.message : err2);
      const zero = {};
      Object.keys(plans.LOCAL_PRICES).forEach((cur) => { zero[cur] = 0; });
      const byPlan = {};
      plans.PAID_PLAN_IDS.forEach((id) => { byPlan[id] = 0; });
      return { mrr: zero, mrrUsd: 0, activeByCurrency: Object.assign({}, zero), activeByPlan: byPlan };
    }
  }
}

const MONTH_ID_RE = /^\d{4}-\d{2}$/;

function addMaps(target, source) {
  Object.keys(source || {}).forEach((k) => {
    const n = Number(source[k]);
    if (Number.isFinite(n)) target[k] = (target[k] || 0) + n;
  });
}

async function buildStats() {
  const now = new Date();
  const ids = lastMonths(now);

  // Une seule lecture de la petite collection adminStats (1 document par mois + « global »).
  const [statsSnap, mrr] = await Promise.all([db.collection('adminStats').get(), computeMrr()]);
  const byId = new Map();
  statsSnap.forEach((d) => byId.set(d.id, d.data()));

  const global = byId.get('global') || {};
  const c = global.counters || {};

  const months = ids.map((id) => monthView(id, byId.get(id) || null));

  // Totaux depuis le début + détail par pays (dans la monnaie de chaque pays).
  const totals = { paidCount: 0, gross: {}, fee: {}, net: {} };
  const countries = {};
  byId.forEach((data, id) => {
    if (!MONTH_ID_RE.test(id)) return;
    totals.paidCount += Number(data.paidCount) || 0;
    addMaps(totals.gross, data.gross);
    addMaps(totals.fee, data.fee);
    addMaps(totals.net, data.net);
    const by = data.byCountry && typeof data.byCountry === 'object' ? data.byCountry : {};
    Object.keys(by).forEach((code) => {
      const perCur = by[code] && typeof by[code] === 'object' ? by[code] : {};
      Object.keys(perCur).forEach((cur) => {
        const v = perCur[cur] || {};
        const key = code + '|' + cur;
        if (!countries[key]) countries[key] = { country: code, currency: cur, count: 0, gross: 0, net: 0 };
        countries[key].count += Number(v.count) || 0;
        countries[key].gross += Number(v.gross) || 0;
        countries[key].net += Number(v.net) || 0;
      });
    });
  });

  return {
    ok: true,
    generatedAtMs: now.getTime(),
    countsAtMs: Number(global.countsAtMs) || null,
    counters: {
      total: Number(c.total) || 0,
      trial: Number(c.trial) || 0,
      active: Number(c.active) || 0,
      expired: Number(c.expired) || 0,
      deleted: Number(c.deleted) || 0,
      deletedTrial: Number(c.deletedTrial) || 0,
      deletedPaid: Number(c.deletedPaid) || 0,
      deletedManual: Number(c.deletedManual) || 0
    },
    mrr,
    totals: {
      paidCount: totals.paidCount,
      gross: cleanMap(totals.gross),
      fee: cleanMap(totals.fee),
      net: cleanMap(totals.net)
    },
    countries: Object.keys(countries).map((k) => countries[k]),
    thisMonth: months[0],
    months
  };
}

function userView(sub, authUser, now) {
  const expiresAtMs = Number(sub.expiresAtMs) || 0;
  const deleteAtMs = Number(sub.deleteAtMs) || null;
  return {
    uid: sub.__uid,
    email: authUser && authUser.email ? authUser.email : null,
    name: authUser && authUser.displayName ? authUser.displayName : null,
    status: sub.status || 'expired',
    planId: sub.planId || 'trial',
    country: sub.country || null,
    currency: sub.currency || null,
    createdAtMs: Number(sub.createdAtMs) || null,
    expiresAtMs,
    daysLeft: expiresAtMs > now ? Math.ceil((expiresAtMs - now) / DAY_MS) : 0,
    deleteAtMs,
    daysUntilDelete: deleteAtMs ? Math.max(0, Math.ceil((deleteAtMs - now) / DAY_MS)) : null,
    isAdmin: authUser && authUser.email ? authUser.email.toLowerCase() === ADMIN_EMAIL : false
  };
}

router.use(requireAdmin);

router.get('/ping', (req, res) => {
  res.json({ ok: true, email: req.user.email });
});

router.get(
  '/stats',
  wrap(async (_req, res) => {
    const now = Date.now();
    if (statsCache.body && now - statsCache.at < STATS_TTL_MS) {
      return res.json(statsCache.body);
    }
    const body = await buildStats();
    statsCache = { at: now, body };
    return res.json(body);
  })
);

router.get(
  '/users',
  wrap(async (req, res) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'invalid' });

    const before = req.query.before !== undefined ? Number(req.query.before) : null;
    if (before !== null && !Number.isFinite(before)) return res.status(400).json({ error: 'invalid' });

    let docs;
    let hasMore;
    try {
      let query = db.collection('subscriptions');
      if (status) query = query.where('status', '==', status);
      query = query.orderBy('createdAtMs', 'desc');
      if (before !== null) query = query.startAfter(before);
      const snap = await query.limit(limit).get();
      docs = snap.docs;
      hasMore = snap.size === limit;
    } catch (err) {
      // Index (status + createdAtMs) pas encore créé : on filtre sans index, sur au plus 500 comptes.
      console.error('users (index manquant ?):', err && err.message ? err.message : err);
      let fb = db.collection('subscriptions');
      if (status) fb = fb.where('status', '==', status);
      const snap = await fb.limit(500).get();
      const all = snap.docs
        .filter((d) => before === null || (Number(d.data().createdAtMs) || 0) < before)
        .sort((a, b) => (Number(b.data().createdAtMs) || 0) - (Number(a.data().createdAtMs) || 0));
      docs = all.slice(0, limit);
      hasMore = all.length > limit;
    }
    const subs = docs.map((d) => Object.assign({ __uid: d.id }, d.data()));

    const authMap = new Map();
    if (subs.length) {
      const result = await admin.auth().getUsers(subs.map((s) => ({ uid: s.__uid })));
      result.users.forEach((u) => authMap.set(u.uid, u));
    }

    const now = Date.now();
    const users = subs.map((s) => userView(s, authMap.get(s.__uid), now));
    const last = subs.length ? Number(subs[subs.length - 1].createdAtMs) : null;

    return res.json({
      ok: true,
      users,
      nextBefore: hasMore && Number.isFinite(last) ? last : null
    });
  })
);

router.get(
  '/payments',
  wrap(async (req, res) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
    let query = db.collection('payments').orderBy('createdAtMs', 'desc');
    if (req.query.before !== undefined) {
      const before = Number(req.query.before);
      if (!Number.isFinite(before)) return res.status(400).json({ error: 'invalid' });
      query = query.startAfter(before);
    }
    const snap = await query.limit(limit).get();

    const payments = snap.docs.map((d) => {
      const p = d.data();
      return {
        id: d.id,
        uid: p.uid,
        planId: p.planId,
        country: p.country,
        currency: p.currency,
        amount: p.amount,
        type: p.type,
        status: p.status,
        net: p.net !== undefined ? p.net : null,
        fee: p.fee !== undefined ? p.fee : null,
        network: p.network || null,
        createdAtMs: p.createdAtMs,
        paidAtMs: p.paidAtMs || null
      };
    });
    const last = payments.length ? payments[payments.length - 1].createdAtMs : null;

    return res.json({
      ok: true,
      payments,
      nextBefore: snap.size === limit && Number.isFinite(last) ? last : null
    });
  })
);

router.get(
  '/alerts',
  wrap(async (_req, res) => {
    const [review, unmatched] = await Promise.all([
      db.collection('payments').where('status', '==', 'REVIEW').limit(50).get(),
      db.collection('unmatchedPayments').limit(50).get()
    ]);

    return res.json({
      ok: true,
      review: review.docs.map((d) => {
        const p = d.data();
        return {
          id: d.id,
          uid: p.uid,
          planId: p.planId,
          amount: p.amount,
          currency: p.currency,
          reason: p.failReason || null,
          saspayTxId: p.saspayTxId || null,
          createdAtMs: p.createdAtMs
        };
      }),
      unmatched: unmatched.docs.map((d) => {
        const p = d.data();
        return {
          id: d.id,
          reason: p.reason || null,
          amount: p.amount || null,
          currency: p.currency || null,
          country: p.country || null,
          network: p.network || null,
          createdAtMs: p.createdAtMs || null
        };
      })
    });
  })
);

router.post(
  '/users/:uid/delete',
  wrap(async (req, res) => {
    const uid = req.params.uid;
    if (!UID_RE.test(uid)) return res.status(400).json({ error: 'invalid' });
    if (!req.body || req.body.confirm !== true) {
      return res.status(400).json({ error: 'confirmation_required' });
    }
    if (uid === req.user.uid) return res.status(403).json({ error: 'cannot_delete_admin' });

    let authUser = null;
    try {
      authUser = await admin.auth().getUser(uid);
    } catch (err) {
      if (!err || err.code !== 'auth/user-not-found') throw err;
    }
    if (authUser && String(authUser.email || '').toLowerCase() === ADMIN_EMAIL) {
      return res.status(403).json({ error: 'cannot_delete_admin' });
    }

    const subRef = db.collection('subscriptions').doc(uid);
    const subSnap = await subRef.get();
    const sub = subSnap.exists ? subSnap.data() : null;
    if (!authUser && !sub) return res.status(404).json({ error: 'not_found' });

    await db.recursiveDelete(db.collection('users').doc(uid));
    if (authUser) await admin.auth().deleteUser(uid);
    await db.collection('checkoutLocks').doc(uid).delete();

    if (req.body.allowNewTrial === true && authUser && authUser.email) {
      await db.collection('usedTrials').doc(emailKey(authUser.email)).delete();
    }

    if (sub) {
      const counters = {
        total: FieldValue.increment(-1),
        deleted: FieldValue.increment(1),
        deletedManual: FieldValue.increment(1)
      };
      if (STATUSES.includes(sub.status)) counters[sub.status] = FieldValue.increment(-1);
      if (sub.lastPaymentId) counters.deletedPaid = FieldValue.increment(1);
      else counters.deletedTrial = FieldValue.increment(1);

      const now = Date.now();
      await Promise.all([
        db.collection('adminStats').doc('global').set({ counters, updatedAtMs: now }, { merge: true }),
        db
          .collection('adminStats')
          .doc(monthId(new Date(now)))
          .set({ deletedCount: FieldValue.increment(1), updatedAtMs: now }, { merge: true }),
        subRef.delete()
      ]);
    }

    statsCache = { at: 0, body: null };
    return res.json({ ok: true });
  })
);

router.post(
  '/payments/:id/dismiss',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!PAY_ID_RE.test(id)) return res.status(400).json({ error: 'invalid' });

    const unmatchedRef = db.collection('unmatchedPayments').doc(id);
    const payRef = db.collection('payments').doc(id);
    const [unmatched, pay] = await db.getAll(unmatchedRef, payRef);

    if (unmatched.exists) await unmatchedRef.delete();
    else if (pay.exists && pay.data().status === 'REVIEW') {
      await payRef.update({ status: 'DISMISSED', dismissedAtMs: Date.now() });
    } else {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.json({ ok: true });
  })
);

module.exports = router;
