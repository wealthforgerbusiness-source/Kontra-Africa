'use strict';

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const { publicCatalog } = require('./config/plans');

const isProd = process.env.NODE_ENV === 'production';

const REQUIRED_ENV = ['APP_BASE_URL', 'SASPAY_SECRET_KEY', 'SASPAY_WEBHOOK_SECRET', 'CRON_SECRET'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error('Variables manquantes: ' + missingEnv.join(', '));
  if (isProd) process.exit(1);
}

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const json = JSON.parse(raw);
    if (typeof json.private_key === 'string') {
      json.private_key = json.private_key.replace(/\\n/g, '\n');
    }
    return admin.credential.cert(json);
  }
  return admin.credential.applicationDefault();
}

admin.initializeApp({ credential: loadCredential() });
admin.firestore().settings({ ignoreUndefinedProperties: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] }
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' }
  })
);

const allowedOrigins = new Set(
  [process.env.APP_BASE_URL, process.env.ADMIN_BASE_URL]
    .filter(Boolean)
    .map((u) => u.replace(/\/+$/, ''))
);
if (!isProd) {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://127.0.0.1:5500');
  allowedOrigins.add('http://localhost:5500');
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600
  })
);

app.use(
  express.json({
    limit: '20kb',
    verify(req, _res, buf) {
      req.rawBody = buf;
    }
  })
);

function clientKey(req) {
  const auth = req.get('Authorization');
  if (auth) return 't:' + crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32);
  return 'ip:' + req.ip;
}

function limiter(limit, keyed) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyed ? clientKey : (req) => 'ip:' + req.ip,
    message: { error: 'too_many_requests' }
  });
}

const globalLimiter = limiter(900, false);
const authLimiter = limiter(90, true);
const paymentLimiter = limiter(150, true);
const adminLimiter = limiter(240, true);
const cronLimiter = limiter(60, false);
const webhookLimiter = limiter(600, false);

app.use(globalLimiter);

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

const catalogBody = publicCatalog();
app.get('/api/catalog', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(catalogBody);
});

function mount(path, file, ...middlewares) {
  try {
    const router = require(file);
    app.use(path, ...middlewares, router);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(file)) {
      console.warn('Route non chargée (fichier absent): ' + file);
      return;
    }
    throw err;
  }
}

mount('/api/auth', './routes/auth', authLimiter);
mount('/api/payments', './routes/payments', paymentLimiter);
mount('/api/webhooks/saspay', './routes/webhook', webhookLimiter);
mount('/api/cron', './routes/cron', cronLimiter);
mount('/api/admin', './routes/admin', adminLimiter);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  console.error('Erreur serveur:', err && err.message ? err.message : err);
  res.status(500).json({ error: 'server_error' });
});

const PORT = Number(process.env.PORT) || 10000;
const server = app.listen(PORT, () => {
  console.log('Kontra Africa API sur le port ' + PORT);
});

server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (r) => console.error('unhandledRejection:', r));
