'use strict';

const USD_RATES = Object.freeze({
  XOF: 580,
  XAF: 580,
  CDF: 2250
});

const ROUND_STEP = Object.freeze({
  XOF: 5,
  XAF: 5,
  CDF: 50
});

const BILLING = Object.freeze({
  cycleDays: 30,
  trialDays: 14,
  trialGraceDays: 14,
  expiredGraceDays: 30,
  warnBeforeDeleteDays: [14, 7, 3, 1]
});

const PLANS = Object.freeze({
  trial: Object.freeze({
    id: 'trial',
    name: 'Essai gratuit',
    priceUsd: 0,
    rank: 0,
    limits: Object.freeze({
      products: 20,
      salesPerMonth: 30,
      customers: 5,
      remindersPerMonth: 3,
      users: 1
    })
  }),
  starter: Object.freeze({
    id: 'starter',
    name: 'Starter',
    priceUsd: 5,
    rank: 1,
    limits: Object.freeze({
      products: 200,
      salesPerMonth: 500,
      customers: 50,
      remindersPerMonth: 30,
      users: 1
    })
  }),
  business: Object.freeze({
    id: 'business',
    name: 'Business',
    priceUsd: 12,
    rank: 2,
    limits: Object.freeze({
      products: 1000,
      salesPerMonth: 5000,
      customers: 500,
      remindersPerMonth: 300,
      users: 3
    })
  }),
  pro: Object.freeze({
    id: 'pro',
    name: 'Pro',
    priceUsd: 25,
    rank: 3,
    limits: Object.freeze({
      products: 5000,
      salesPerMonth: 20000,
      customers: 2000,
      remindersPerMonth: 1000,
      users: 10
    })
  })
});

const LOCAL_PRICES = Object.freeze({
  XOF: Object.freeze({ starter: 2900, business: 6960, pro: 14500 }),
  XAF: Object.freeze({ starter: 2900, business: 6960, pro: 14500 }),
  CDF: Object.freeze({ starter: 250, business: 27000, pro: 56250 })
});

const COUNTRIES = Object.freeze({
  BJ: Object.freeze({
    code: 'BJ',
    name: 'Bénin',
    flag: 'assets/flags/benin.png',
    currency: 'XOF',
    dialCode: '229',
    feePercent: 2.2,
    methods: ['MTN MoMo', 'Moov Money', 'Celtiis Cash']
  }),
  BF: Object.freeze({
    code: 'BF',
    name: 'Burkina Faso',
    flag: 'assets/flags/burkina-faso.png',
    currency: 'XOF',
    dialCode: '226',
    feePercent: 3,
    methods: ['Orange Money', 'Moov Money']
  }),
  CM: Object.freeze({
    code: 'CM',
    name: 'Cameroun',
    flag: 'assets/flags/cameroun.png',
    currency: 'XAF',
    dialCode: '237',
    feePercent: 1.75,
    methods: ['MTN MoMo', 'Orange Money']
  }),
  CI: Object.freeze({
    code: 'CI',
    name: "Côte d'Ivoire",
    flag: 'assets/flags/cote-ivoire.png',
    currency: 'XOF',
    dialCode: '225',
    feePercent: 1.8,
    methods: ['Orange Money', 'MTN MoMo', 'Wave', 'Moov Money']
  }),
    ML: Object.freeze({
    code: 'ML',
    name: 'Mali',
    flag: 'assets/flags/mali.png',
    currency: 'XOF',
    dialCode: '223',
    feePercent: 1.75,
    methods: ['Orange Money', 'Moov Money']
  }),
  CD: Object.freeze({
    code: 'CD',
    name: 'RD Congo',
    flag: 'assets/flags/rdc.png',
    currency: 'CDF',
    dialCode: '243',
    feePercent: 2.5,
    methods: ['Vodacom', 'Airtel Money', 'Orange Money']
  }),
  SN: Object.freeze({
    code: 'SN',
    name: 'Sénégal',
    flag: 'assets/flags/senegal.png',
    currency: 'XOF',
    dialCode: '221',
    feePercent: 2.25,
    methods: ['Orange Money', 'Wave', 'YAS']
  }),
  TG: Object.freeze({
    code: 'TG',
    name: 'Togo',
    flag: 'assets/flags/togo.png',
    currency: 'XOF',
    dialCode: '228',
    feePercent: 2.25,
    methods: ['Moov Money', 'MTN MoMo']
  })
});

const PAID_PLAN_IDS = Object.freeze(['starter', 'business', 'pro']);

function getPlan(planId) {
  return PLANS[planId] || null;
}

function getCountry(code) {
  if (typeof code !== 'string') return null;
  return COUNTRIES[code.toUpperCase()] || null;
}

function isPaidPlan(planId) {
  return PAID_PLAN_IDS.includes(planId);
}

function roundUpToStep(amount, currency) {
  const step = ROUND_STEP[currency] || 1;
  return Math.ceil(amount / step) * step;
}

function priceFor(planId, countryCode) {
  const country = getCountry(countryCode);
  if (!country || !isPaidPlan(planId)) return null;
  const table = LOCAL_PRICES[country.currency];
  if (!table || !Number.isInteger(table[planId])) return null;
  return table[planId];
}

function methodAllowed(countryCode, method) {
  const country = getCountry(countryCode);
  if (!country || typeof method !== 'string') return false;
  return country.methods.includes(method);
}

function remainingDays(expiresAtMs, nowMs) {
  const diff = expiresAtMs - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.min(BILLING.cycleDays, Math.ceil(diff / 86400000));
}

function upgradeQuote({ currentPlanId, targetPlanId, countryCode, paidAmount, expiresAtMs, nowMs }) {
  const country = getCountry(countryCode);
  const current = getPlan(currentPlanId);
  const target = getPlan(targetPlanId);
  if (!country || !current || !target) return { ok: false, reason: 'invalid' };
  if (!isPaidPlan(targetPlanId)) return { ok: false, reason: 'invalid_target' };

  const targetPrice = priceFor(targetPlanId, countryCode);
  if (targetPrice === null) return { ok: false, reason: 'no_price' };

  if (!isPaidPlan(currentPlanId)) {
    return {
      ok: true,
      type: 'new',
      currency: country.currency,
      credit: 0,
      amount: targetPrice,
      days: BILLING.cycleDays
    };
  }

  if (target.rank < current.rank) return { ok: false, reason: 'downgrade_at_renewal' };
  if (target.rank === current.rank) {
    return {
      ok: true,
      type: 'renew',
      currency: country.currency,
      credit: 0,
      amount: targetPrice,
      days: BILLING.cycleDays
    };
  }

  const days = remainingDays(expiresAtMs, nowMs);
  const paid = Number.isFinite(paidAmount) && paidAmount > 0 ? paidAmount : priceFor(currentPlanId, countryCode) || 0;
  const credit = Math.floor((days / BILLING.cycleDays) * paid);
  const amount = roundUpToStep(Math.max(targetPrice - credit, Math.ceil(targetPrice * 0.1)), country.currency);

  return {
    ok: true,
    type: 'upgrade',
    currency: country.currency,
    credit,
    amount,
    days: BILLING.cycleDays
  };
}

function usdToLocal(usd, currency) {
  const rate = USD_RATES[currency];
  if (!rate || !Number.isFinite(usd)) return null;
  return roundUpToStep(usd * rate, currency);
}

function feeAndNet(amount, countryCode) {
  const country = getCountry(countryCode);
  if (!country || !Number.isFinite(amount)) return null;
  const fee = Math.round(amount * country.feePercent) / 100;
  return {
    gross: amount,
    fee,
    net: Math.round((amount - fee) * 100) / 100,
    feePercent: country.feePercent,
    currency: country.currency
  };
}

function publicCatalog() {
  return {
    billing: BILLING,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      priceUsd: p.priceUsd,
      limits: p.limits
    })),
    countries: Object.values(COUNTRIES).map((c) => ({
      code: c.code,
      name: c.name,
      flag: c.flag,
      currency: c.currency,
      dialCode: c.dialCode,
      methods: c.methods,
      prices: {
        starter: priceFor('starter', c.code),
        business: priceFor('business', c.code),
        pro: priceFor('pro', c.code)
      }
    }))
  };
}

module.exports = {
  USD_RATES,
  ROUND_STEP,
  BILLING,
  PLANS,
  LOCAL_PRICES,
  COUNTRIES,
  PAID_PLAN_IDS,
  getPlan,
  getCountry,
  isPaidPlan,
  priceFor,
  methodAllowed,
  remainingDays,
  upgradeQuote,
  usdToLocal,
  feeAndNet,
  publicCatalog
};
