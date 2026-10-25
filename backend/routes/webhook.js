'use strict';

const crypto = require('crypto');
const express = require('express');
const admin = require('firebase-admin');
const plans = require('../config/plans');

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const router = express.Router();

const VERIFY_BASE = 'https://api.saspay.me/api/v1/payments/';
const TOLERANCE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15000;
const DAY_MS = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MARK_RE = /\[KA:([A-Za-z0-9_-]{8,64})\]/;
const SESSION_BASE = 'https://api.saspay.me/api/v1/checkout-sessions/';
const OK_STATUS = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'PAYE', 'PAYÉ'];
const isOk = (v) => OK_STATUS.includes(String(v || '').toUpperCase());

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validSignature(req, secret) {
  const sig = String(req.get('X-Webhook-Signature') || '').trim().toLowerCase();
  const ts = String(req.get('X-Webhook-Timestamp') || '').trim();
  if (!/^[a-f0-9]{64}$/.test(sig) || !/^\d{10}$/.test(ts)) return false;
  if (!Buffer.isBuffer(req.rawBody)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(ts + '.')
    .update(req.rawBody)
    .digest();
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function verifyPayment(txId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(VERIFY_BASE + encodeURIComponent(txId) + '/verify/', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + process.env.SASPAY_SECRET_KEY },
      signal: controller.signal
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function metaPaymentId(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const id = meta.payment_id;
  return typeof id === 'string' && ID_RE.test(id) ? id : null;
}

function markerPaymentId(...objs) {
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const key of ['description', 'reference', 'narration', 'label']) {
      const m = typeof o[key] === 'string' ? MARK_RE.exec(o[key]) : null;
      if (m) return m[1];
    }
  }
  return null;
}

async function findPaymentRef(txId, data, vData) {
  const d = data && typeof data === 'object' ? data : {};
  const v = vData && typeof vData === 'object' ? vData : {};
  const candidates = [markerPaymentId(d, v), metaPaymentId(d.metadata), metaPaymentId(v.metadata)];
  for (const id of candidates) {
    if (!id) continue;
    const ref = db.collection('payments').doc(id);
    const snap = await ref.get();
    if (snap.exists) return ref;
  }
  const sessionIds = [d.session_id, d.checkout_session_id, d.checkout_session, v.session_id, v.checkout_session_id]
    .filter((x) => typeof x === 'string' && x);
  for (const sid of sessionIds.concat([txId])) {
    const q = await db.collection('payments').where('saspaySessionId', '==', sid).limit(1).get();
    if (!q.empty) return q.docs[0].ref;
  }
  const q2 = await db.collection('payments').where('saspayTxId', '==', txId).limit(1).get();
  return q2.empty ? null : q2.docs[0].ref;
}

async function storeUnmatched(txId, event, data, reason) {
  if (!ID_RE.test(txId)) return;
  await db
    .collection('unmatchedPayments')
    .doc(txId)
    .set(
      {
        event,
        reason,
        reference: typeof data.reference === 'string' ? data.reference.slice(0, 80) : null,
        amount: String(data.amount || ''),
        currency: String(data.currency || '').slice(0, 3),
        country: String(data.country || '').slice(0, 2),
        network: String(data.network || '').slice(0, 40),
        createdAtMs: Date.now()
      },
      { merge: true }
    );
}

async function syncClaims(uid, sub) {
  const user = await admin.auth().getUser(uid);
  const claims = Object.assign({}, user.customClaims || {}, {
    subUntil: sub.expiresAtMs,
    plan: sub.planId
  });
  await admin.auth().setCustomUserClaims(uid, claims);
}

async function activate(payRef, txId, data, verified) {
  const txRef = db.collection('processedTx').doc(txId);
  const now = Date.now();

  const outcome = await db.runTransaction(async (t) => {
    const paySnap = await t.get(payRef);
    if (!paySnap.exists) return { skip: 'missing' };
    const pay = paySnap.data();

    const txSnap = await t.get(txRef);
    if (pay.status === 'SUCCESS' || txSnap.exists) {
      return { skip: 'already', uid: pay.uid, needsClaims: pay.claimsSynced === false };
    }

    if (verified.currency && verified.currency !== pay.currency) {
      t.update(payRef, { status: 'REVIEW', failReason: 'currency_mismatch', saspayTxId: txId });
      return { skip: 'review' };
    }
    const paidAmount = num(verified.amount !== null && verified.amount !== undefined ? verified.amount : data.amount);
    if (paidAmount === null || Math.abs(paidAmount - pay.amount) > 0.005) {
      t.update(payRef, { status: 'REVIEW', failReason: 'amount_mismatch', saspayTxId: txId });
      return { skip: 'review' };
    }

    const subRef = db.collection('subscriptions').doc(pay.uid);
    const subSnap = await t.get(subRef);
    const prev = subSnap.exists ? subSnap.data() : null;
    const wasActive = Boolean(
      prev &&
        prev.status === 'active' &&
        prev.planId === pay.planId &&
        Number.isFinite(prev.expiresAtMs) &&
        prev.expiresAtMs > now
    );

    const cycleMs = plans.BILLING.cycleDays * DAY_MS;
    const expiresAtMs =
      pay.type === 'renew' && wasActive ? prev.expiresAtMs + cycleMs : now + cycleMs;
    const listPrice = plans.priceFor(pay.planId, pay.country) || pay.amount;

    const sub = {
      status: 'active',
      planId: pay.planId,
      country: pay.country,
      currency: pay.currency,
      paidAmount: listPrice,
      startedAtMs: wasActive && pay.type === 'renew' ? prev.startedAtMs || now : now,
      expiresAtMs,
      lastPaymentId: payRef.id,
      updatedAtMs: now
    };

    const charged = num(data.charged);
    const netReceived = num(data.net_amount);
    const fallback = plans.feeAndNet(pay.amount, pay.country);
    const gross = charged !== null ? charged : pay.amount;
    const net = netReceived !== null ? netReceived : fallback ? fallback.net : pay.amount;
    const fee = Math.round((gross - net) * 100) / 100;
    const cur = pay.currency;

    t.set(
      subRef,
      Object.assign({}, sub, {
        warnedAtMs: FieldValue.delete(),
        deleteAtMs: FieldValue.delete()
      }),
      { merge: true }
    );
    t.update(payRef, {
      status: 'SUCCESS',
      saspayTxId: txId,
      gross,
      fee,
      net,
      network: String(data.network || '').slice(0, 40),
      paidAtMs: now,
      claimsSynced: false
    });
    t.create(txRef, { paymentId: payRef.id, uid: pay.uid, at: now });
    t.set(
      db.collection('adminStats').doc(new Date(now).toISOString().slice(0, 7)),
      {
        paidCount: FieldValue.increment(1),
        gross: { [cur]: FieldValue.increment(gross) },
        fee: { [cur]: FieldValue.increment(fee) },
        net: { [cur]: FieldValue.increment(net) },
        byCountry: {
          [pay.country]: {
            [cur]: {
              count: FieldValue.increment(1),
              gross: FieldValue.increment(gross),
              net: FieldValue.increment(net)
            }
          }
        },
        updatedAtMs: now
      },
      { merge: true }
    );

    return { uid: pay.uid, sub, needsClaims: true };
  });

  if (outcome.skip && outcome.skip !== 'already') return outcome.skip;
  if (!outcome.needsClaims) return 'already';

  let sub = outcome.sub;
  if (!sub) {
    const snap = await db.collection('subscriptions').doc(outcome.uid).get();
    sub = snap.exists ? snap.data() : null;
  }
  if (sub) {
    await syncClaims(outcome.uid, sub);
    await payRef.update({ claimsSynced: true });
  }
  return outcome.skip || 'activated';
}

async function markNotPaid(payRef, status, reason) {
  await db.runTransaction(async (t) => {
    const snap = await t.get(payRef);
    if (snap.exists && snap.data().status === 'PENDING') {
      t.update(payRef, { status, failReason: reason, failedAtMs: Date.now() });
    }
  });
}

async function confirmAndActivate(payRef, txId, data, event) {
  const verifyResult = await verifyPayment(txId);
  const vData = verifyResult.json && verifyResult.json.data;
  if (verifyResult.status !== 200 || !vData) return { code: 503, error: 'verify_unavailable' };
  if (!isOk(vData.status)) return { code: 503, error: 'not_confirmed' };
  if (vData.id && String(vData.id) !== txId) return { code: 400, error: 'id_mismatch' };

  let ref = payRef;
  if (!ref) ref = await findPaymentRef(txId, data, vData);
  if (!ref) {
    await storeUnmatched(txId, event, data, 'no_matching_payment');
    console.error('Paiement réussi sans correspondance, id ' + txId);
    return { code: 200 };
  }

  const verified = {
    currency: typeof vData.currency === 'string' ? vData.currency : '',
    amount: num(vData.amount)
  };
  const merged = Object.assign({}, vData, data);
  const result = await activate(ref, txId, merged, verified);
  if (result === 'review') console.error('Paiement à vérifier manuellement, id ' + txId);
  return { code: 200, result };
}

router.post(
  '/',
  wrap(async (req, res) => {
    const secret = process.env.SASPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_error' });
    if (!validSignature(req, secret)) return res.status(401).json({ error: 'invalid_signature' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const event = typeof body.event === 'string' ? body.event : '';
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    const txId = typeof data.id === 'string' ? data.id : '';

    if (event === 'webhook.test') return res.json({ received: true });

    const handled = ['transaction.success', 'transaction.failed', 'transaction.cancelled'];
    if (!handled.includes(event)) return res.json({ received: true });
    if (!ID_RE.test(txId)) return res.status(400).json({ error: 'invalid_payload' });

    if (event === 'transaction.failed' || event === 'transaction.cancelled') {
      const payRef = await findPaymentRef(txId, data, null);
      if (payRef) {
        await markNotPaid(
          payRef,
          event === 'transaction.failed' ? 'FAILED' : 'CANCELLED',
          event
        );
      }
      return res.json({ received: true });
    }

    let out;
    try {
      const payRef = await findPaymentRef(txId, data, null);
      out = await confirmAndActivate(payRef, txId, data, event);
    } catch (_err) {
      return res.status(503).json({ error: 'verify_unavailable' });
    }
    if (out.code !== 200) return res.status(out.code).json({ error: out.error });
    return res.json({ received: true });
  })
);

function pickTxId(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const direct = [obj.transaction_id, obj.payment_id, obj.transaction && obj.transaction.id, obj.payment && obj.payment.id];
  for (const c of direct) if (typeof c === 'string' && ID_RE.test(c)) return c;
  const lists = [obj.transactions, obj.payments];
  for (const l of lists) {
    if (Array.isArray(l)) {
      for (const it of l) {
        if (it && typeof it.id === 'string' && ID_RE.test(it.id) && (!it.status || isOk(it.status))) return it.id;
      }
    }
  }
  return '';
}

router.confirmFromSession = async function confirmFromSession(payRef, pay) {
  if (!pay || pay.status !== 'PENDING' || !pay.saspaySessionId) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let json = null;
  try {
    const response = await fetch(SESSION_BASE + encodeURIComponent(pay.saspaySessionId) + '/', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + process.env.SASPAY_SECRET_KEY },
      signal: controller.signal
    });
    if (response.status !== 200) return false;
    json = await response.json().catch(() => null);
  } catch (_err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
  const d = json && json.data;
  if (!d || typeof d !== 'object') return false;
  const txId = pickTxId(d);
  if (!txId) return false;
  try {
    const out = await confirmAndActivate(payRef, txId, { id: txId }, 'status_check');
    return out.code === 200;
  } catch (_err) {
    return false;
  }
};

module.exports = router;
