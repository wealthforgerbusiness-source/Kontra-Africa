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
const contractsRouter = require("./src/contracts");

const app = express();

// Le port est fourni par Render via la variable d'environnement PORT
const PORT = process.env.PORT || 8080;

// Configuration des middlewares
// Autorise les requêtes provenant du frontend
app.use(cors());
// Parse les requêtes entrantes avec des payloads JSON
app.use(bodyParser.json());

// Définition des routes
app.post("/api/init-user", initUser);
app.post("/api/checkout", checkout);
app.post("/api/chariow-webhook", chariowWebhook);
app.use("/api/contracts", contractsRouter);

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré et en écoute sur le port ${PORT}`);
});
