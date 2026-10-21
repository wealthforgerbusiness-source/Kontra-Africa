'use strict';

const crypto = require('crypto');
const express = require('express');
const admin = require('firebase-admin');
const plans = require('../config/plans');

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const router = express.Router();

const DAY_MS = 86400000;
const PAGE_SIZE = 200;
const PURGE_PAGE_SIZE = 25;
const CONCURRENCY = 10;
const PURGE_CONCURRENCY = 5;
const TIME_BUDGET_MS = 80000;
const LOCK_MS = 20 * 60 * 1000;
const MIN_WARNING_MS = 3 * DAY_MS;
const FAILED = Symbol('failed');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'optisitedigital@gmail.com')
  .trim()
  .toLowerCase();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function authorized(req) {
  const match = /^Bearer\s+(\S+)$/.exec(req.get('Authorization') || '');
  const secret = process.env.CRON_SECRET;
  if (!match || !secret) return false;
  return crypto.timingSafeEqual(sha(match[1]), sha(secret));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        console.error('Tâche cron en échec:', err && err.message ? err.message : err);
        results[index] = FAILED;
      }
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

async function findAdminUid() {
  try {
    const user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    return user.uid;
  } catch (_err) {
    return null;
  }
}

async function acquireLock(now) {
  const ref = db.collection('cronLocks').doc('daily');
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (snap.exists && Number(snap.data().at) > now - LOCK_MS) return false;
    t.set(ref, { at: now });
    return true;
  });
}

async function releaseLock() {
  await db.collection('cronLocks').doc('daily').delete();
}

async function expireOne(ref, now) {
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return false;
    const sub = snap.data();
    if (sub.status !== 'trial' && sub.status !== 'active') return false;
    const expiresAtMs = Number(sub.expiresAtMs);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs > now) return false;

    const graceDays = sub.lastPaymentId
      ? plans.BILLING.expiredGraceDays
      : plans.BILLING.trialGraceDays;
    const deleteAtMs = Math.max(expiresAtMs + graceDays * DAY_MS, now + MIN_WARNING_MS);

    t.update(ref, {
      status: 'expired',
      deleteAtMs,
      expiredAtMs: now,
      updatedAtMs: now
    });
    return true;
  });
}

async function expireDue(now, adminUid, deadline) {
  let expired = 0;
  let failed = 0;
  let last = null;

  while (Date.now() < deadline) {
    let query = db
      .collection('subscriptions')
      .where('status', 'in', ['trial', 'active'])
      .where('expiresAtMs', '<=', now)
      .orderBy('expiresAtMs')
      .limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);

    const snap = await query.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];

    const refs = snap.docs.filter((d) => d.id !== adminUid).map((d) => d.ref);
    const results = await mapLimit(refs, CONCURRENCY, (ref) => expireOne(ref, now));
    expired += results.filter((r) => r === true).length;
    failed += results.filter((r) => r === FAILED).length;

    if (snap.size < PAGE_SIZE) break;
  }
  return { expired, failed };
}

async function purgeUser(doc, now) {
  const uid = doc.id;
  const fresh = await doc.ref.get();
  if (!fresh.exists) return null;

  const sub = fresh.data();
  if (
    sub.status !== 'expired' ||
    !(Number(sub.deleteAtMs) <= now) ||
    !(Number(sub.expiresAtMs) <= now)
  ) {
    return null;
  }
  const kind = sub.lastPaymentId ? 'paid' : 'trial';

  await db.recursiveDelete(db.collection('users').doc(uid));
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if (!err || err.code !== 'auth/user-not-found') throw err;
  }
  await db.collection('checkoutLocks').doc(uid).delete();
  await doc.ref.delete();
  return kind;
}

async function deleteDue(now, adminUid, deadline) {
  let paid = 0;
  let trial = 0;
  let failed = 0;
  let last = null;

  while (Date.now() < deadline) {
    let query = db
      .collection('subscriptions')
      .where('deleteAtMs', '<=', now)
      .orderBy('deleteAtMs')
      .limit(PURGE_PAGE_SIZE);
    if (last) query = query.startAfter(last);

    const snap = await query.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];

    const docs = snap.docs.filter((d) => d.id !== adminUid);
    const results = await mapLimit(docs, PURGE_CONCURRENCY, (doc) => purgeUser(doc, now));
    paid += results.filter((r) => r === 'paid').length;
    trial += results.filter((r) => r === 'trial').length;
    failed += results.filter((r) => r === FAILED).length;

    if (snap.size < PURGE_PAGE_SIZE) break;
  }
  return { deleted: paid + trial, paid, trial, failed };
}

async function recordDeletions(now, purge) {
  if (!purge.deleted) return;
  const month = new Date(now).toISOString().slice(0, 7);
  await Promise.all([
    db
      .collection('adminStats')
      .doc('global')
      .set(
        {
          counters: {
            deleted: FieldValue.increment(purge.deleted),
            deletedTrial: FieldValue.increment(purge.trial),
            deletedPaid: FieldValue.increment(purge.paid)
          },
          updatedAtMs: now
        },
        { merge: true }
      ),
    db
      .collection('adminStats')
      .doc(month)
      .set(
        {
          deletedCount: FieldValue.increment(purge.deleted),
          updatedAtMs: now
        },
        { merge: true }
      )
  ]);
}

async function refreshCounts(adminUid, now) {
  const col = db.collection('subscriptions');
  const [total, trial, active, expired] = await Promise.all([
    col.count().get(),
    col.where('status', '==', 'trial').count().get(),
    col.where('status', '==', 'active').count().get(),
    col.where('status', '==', 'expired').count().get()
  ]);

  const counters = {
    total: total.data().count,
    trial: trial.data().count,
    active: active.data().count,
    expired: expired.data().count
  };

  if (adminUid) {
    const snap = await col.doc(adminUid).get();
    if (snap.exists) {
      counters.total -= 1;
      const status = snap.data().status;
      if (status === 'trial' || status === 'active' || status === 'expired') {
        counters[status] -= 1;
      }
    }
  }

  await db
    .collection('adminStats')
    .doc('global')
    .set({ counters, countsAtMs: now }, { merge: true });
  return counters;
}

router.post(
  '/daily',
  wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

    const started = Date.now();
    if (!(await acquireLock(started))) return res.status(409).json({ error: 'already_running' });

    try {
      const deadline = started + TIME_BUDGET_MS;
      const adminUid = await findAdminUid();

      const expire = await expireDue(started, adminUid, deadline);
      const purge = await deleteDue(started, adminUid, deadline);
      await recordDeletions(Date.now(), purge);
      const counters = await refreshCounts(adminUid, Date.now());

      return res.json({
        ok: true,
        expired: expire.expired,
        deleted: purge.deleted,
        deletedTrial: purge.trial,
        deletedPaid: purge.paid,
        failed: expire.failed + purge.failed,
        partial: Date.now() >= deadline,
        counters,
        tookMs: Date.now() - started
      });
    } finally {
      await releaseLock().catch(() => {});
    }
  })
);

module.exports = router;
