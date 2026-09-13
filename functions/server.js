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
const { chariowWebhook } = require("./src/webhook");
const { verifyLicenseKey } = require("./src/license-verify");
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

// 15 requêtes / 15 minutes / IP pour les routes sensibles.
const sensitiveRoutesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: "Trop de tentatives, réessaie dans quelques minutes.",
  },
});

// ============================================================
// CORS
// ============================================================

const corsOptions = {
  origin(origin, callback) {
    // Requêtes sans Origin :
    // server-to-server, curl, webhook Chariow, etc.
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

// Capture également le corps brut pour la signature Chariow.
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

app.post(
  "/api/init-user",
  sensitiveRoutesLimiter,
  initUser
);

app.post(
  "/api/checkout",
  sensitiveRoutesLimiter,
  checkout
);

// Webhook Chariow : server-to-server,
// donc pas de rate limit par IP.
app.post(
  "/api/chariow-webhook",
  chariowWebhook
);

app.post(
  "/api/verify-license",
  sensitiveRoutesLimiter,
  verifyLicenseKey
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
