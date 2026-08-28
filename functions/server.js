/**
 * Point d'entrée principal pour le backend déployé sur Render.
 */
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

// Importation des contrôleurs depuis src/
const { initUser } = require("./src/auth");
const { checkout } = require("./src/checkout");
const { chariowWebhook } = require("./src/webhook");
const { verifyLicenseKey } = require("./src/license-verify");
const contractsRouter = require("./src/contracts");
const { ALLOWED_ORIGINS } = require("./src/config");

const app = express();

// Le port est fourni par Render via la variable d'environnement PORT
const PORT = process.env.PORT || 8080;

// Configuration des middlewares
// N'autorise que les origines listées dans ALLOWED_ORIGINS (voir config.js).
// Le webhook Chariow n'a pas besoin de CORS (server-to-server, pas de navigateur).
const corsOptions = {
  origin(origin, callback) {
    // Requêtes sans "Origin" (ex. server-to-server, curl, webhook Chariow) : autorisées.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`CORS refusé pour l'origine : ${origin}`);
    return callback(new Error("Origine non autorisée par CORS."));
  },
};

app.use(cors(corsOptions));

// Parse les requêtes entrantes avec des payloads JSON.
// IMPORTANT : on capture aussi le corps BRUT (req.rawBody) via l'option
// "verify". La vérification de signature Chariow (voir src/webhook.js)
// doit être calculée sur les octets bruts exacts reçus, PAS sur
// JSON.stringify(req.body) qui peut ré-échapper différemment les
// caractères (slashes, accents) et casser la signature.
// Voir https://chariow.dev/en/guides/pulse-security
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Définition des routes
app.post("/api/init-user", initUser);
app.post("/api/checkout", checkout);
app.post("/api/chariow-webhook", chariowWebhook);
app.post("/api/verify-license", verifyLicenseKey);
app.use("/api/contracts", contractsRouter);

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré et en écoute sur le port ${PORT}`);
});
