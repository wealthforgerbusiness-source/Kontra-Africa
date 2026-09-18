/**
 * Point d'entrée principal pour le backend déployé sur Render.
 */

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// ============================================================
// IMPORTATION DES CONTRÔLEURS EXISTANTS
// ============================================================

const { initUser } = require("./src/auth");
const { checkout } = require("./src/checkout");
const { saspayWebhook } = require("./src/webhook");
const { verifyPayment } = require("./src/verify-payment");
const contractsRouter = require("./src/contracts");

// ============================================================
// NOUVEAU : ROUTES STOCK & VENTES
// ============================================================

const stockRouter = require("./src/stock");

// ============================================================
// CONFIG
// ============================================================

const { ALLOWED_ORIGINS } = require("./src/config");

const app = express();

// Le port est fourni par Render via la variable d'environnement PORT
const PORT = process.env.PORT || 8080;

// ============================================================
// TRUST PROXY — INDISPENSABLE SUR RENDER
// ============================================================
//
// Render place un reverse proxy devant l'application. Sans cette ligne,
// Express croit que TOUTES les requêtes viennent de l'IP du proxy :
// express-rate-limit met alors le monde entier dans le même compteur,
// et le quota global est épuisé dès quelques dizaines d'utilisateurs.
//
// Avec trust proxy, Express lit l'en-tête X-Forwarded-For et retrouve
// la vraie IP du client.
app.set("trust proxy", 1);

// ============================================================
// SÉCURITÉ HTTP
// ============================================================

// Désactivation de Cross-Origin-Resource-Policy pour éviter
// des blocages inutiles entre ton frontend et ton backend.
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// ============================================================
// RATE LIMIT
// ============================================================
//
// PROBLÈME CORRIGÉ ICI : le rate limit était calculé par adresse IP.
// En RDC (et plus largement en Afrique), les opérateurs mobiles
// (Vodacom, Airtel, Orange) font du NAT à grande échelle : des centaines
// d'abonnés partagent la même IP publique. Un quota par IP revenait donc
// à bloquer des utilisateurs légitimes à cause de l'activité d'inconnus
// sur le même réseau mobile.
//
// SOLUTION : pour les routes authentifiées, on compte par utilisateur
// (UID Firebase) plutôt que par IP. Chacun a son propre quota, quel que
// soit son opérateur.

/**
 * Décode la partie "payload" d'un token Firebase SANS le vérifier.
 *
 * Ce décodage n'est PAS une vérification d'authentification et ne sert
 * strictement qu'à choisir une clé de comptage pour le rate limit. La
 * vraie vérification cryptographique du token reste faite plus loin par
 * getVerifiedUid() dans chaque contrôleur : un token falsifié ne donne
 * donc aucun accès, il permet juste de choisir son propre compteur —
 * ce qui n'a aucun intérêt pour un attaquant, puisqu'un attaquant peut
 * de toute façon déjà changer d'IP.
 */
function extractUidForRateLimit(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const idToken = authorization.substring(7).trim();
  const parts = idToken.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf8")
    );

    return payload.user_id || payload.sub || null;
  } catch (error) {
    return null;
  }
}

/**
 * Clé de comptage : l'UID quand l'utilisateur est identifiable,
 * sinon l'IP (cas des appels anonymes, ex. première connexion).
 */
function rateLimitKey(req) {
  const uid = extractUidForRateLimit(req);

  if (uid) {
    return `uid:${uid}`;
  }

  return `ip:${req.ip}`;
}

// Routes sensibles authentifiées (init-user, checkout, verify-payment).
// 60 requêtes / 15 min / utilisateur : largement suffisant pour un usage
// normal, tout en bloquant un script qui boucle.
const sensitiveRoutesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,

  handler: (req, res) => {
    console.warn(
      `[RATE-LIMIT] ⛔ Route sensible bloquée — clé: ${rateLimitKey(req)}, chemin: ${req.originalUrl}`
    );
    res.status(429).json({
      error: "Trop de tentatives, réessaie dans quelques minutes.",
    });
  },
});

// Garde-fou global anti-abus, par IP, volontairement très large :
// il n'est là que pour absorber un flood brutal depuis une seule source,
// pas pour limiter l'usage normal. Le seuil est assez haut pour ne jamais
// gêner un réseau mobile partagé par de nombreux utilisateurs légitimes.
const globalAbuseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,

  // Le webhook SasPay est un appel server-to-server : il doit toujours
  // passer, sous peine de perdre la confirmation d'un paiement client.
  skip: (req) => req.path === "/saspay-webhook",

  message: {
    error: "Trop de requêtes, réessaie dans un instant.",
  },
});

// ============================================================
// CORS
// ============================================================

const corsOptions = {
  origin(origin, callback) {
    // Requêtes sans Origin :
    // server-to-server, curl, webhook SasPay, etc.
    if (!origin) {
      return callback(null, true);
    }

    // Autorise les origines définies dans config.js
    if (
      Array.isArray(ALLOWED_ORIGINS) &&
      ALLOWED_ORIGINS.includes(origin)
    ) {
      return callback(null, true);
    }

    console.warn(`CORS refusé pour l'origine : ${origin}`);

    return callback(
      new Error("Origine non autorisée par CORS.")
    );
  },

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
  ],
};

app.use(cors(corsOptions));

// ============================================================
// BODY PARSER JSON
// ============================================================

// Capture également le corps brut pour la signature SasPay.
app.use(
  bodyParser.json({
    limit: "5mb",

    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    service: "Kontra-Africa Backend",
    status: "online",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "Kontra-Africa Backend",
    status: "online",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ROUTES EXISTANTES
// ============================================================

// Garde-fou anti-flood appliqué à toutes les routes /api.
// Le webhook SasPay en est exclu via l'option skip du limiter.
app.use("/api", globalAbuseLimiter);

app.post(
  "/api/init-user",
  (req, res, next) => {
    console.log(
      `[SERVER] 📥 POST /api/init-user reçu — IP: ${req.ip}, Origin: ${req.headers.origin || "(absent)"}, a un header Authorization: ${Boolean(req.headers.authorization)}`
    );
    next();
  },
  sensitiveRoutesLimiter,
  initUser
);

app.post(
  "/api/checkout",
  sensitiveRoutesLimiter,
  checkout
);

// Webhook SasPay : server-to-server,
// donc pas de rate limit par IP.
app.post(
  "/api/saspay-webhook",
  saspayWebhook
);

app.post(
  "/api/verify-payment",
  sensitiveRoutesLimiter,
  verifyPayment
);

// ============================================================
// CONTRATS
// ============================================================

app.use(
  "/api/contracts",
  contractsRouter
);

// ============================================================
// STOCK & VENTES
// ============================================================
//
// IMPORTANT : c'est cette partie qui manquait.
//
// Ton stock.js appelle actuellement :
//
// GET    /api/stock/products
// POST   /api/stock/products
// PUT    /api/stock/products/:id
// DELETE /api/stock/products/:id
//
// GET    /api/stock/sales
// POST   /api/stock/sales
//
// GET    /api/stock/reports/daily?date=YYYY-MM-DD
//
// ============================================================

app.use(
  "/api/stock",
  stockRouter
);

// ============================================================
// GESTION DES ROUTES INTROUVABLES
// ============================================================

app.use((req, res) => {
  console.warn(
    `Route introuvable : ${req.method} ${req.originalUrl}`
  );

  res.status(404).json({
    success: false,
    error: "Route API introuvable.",
    path: req.originalUrl,
  });
});

// ============================================================
// GESTION GLOBALE DES ERREURS
// ============================================================

app.use((error, req, res, next) => {
  console.error(
    "Erreur serveur :",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    error:
      error.message ||
      "Erreur interne du serveur.",
  });
});

// ============================================================
// DÉMARRAGE DU SERVEUR
// ============================================================

app.listen(PORT, () => {
  console.log(
    `🚀 Serveur Kontra-Africa démarré sur le port ${PORT}`
  );

  console.log(
    "📦 Routes Stock disponibles sur /api/stock"
  );

  console.log(
    "📄 Routes Contrats disponibles sur /api/contracts"
  );

  console.log(
    "❤️ Health check disponible sur /health"
  );
});
