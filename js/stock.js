// functions/src/stock.js
// Backend Stock & Ventes — Kontra-Africa

const express = require("express");
const router = express.Router();

const { Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const { db, adminApp } = require("./config");

// ============================================================
// AUTHENTIFICATION
// ============================================================

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.substring(7).trim();
}

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  try {
    return await getAuth(adminApp).verifyIdToken(token);
  } catch (error) {
    console.error("Token Firebase invalide :", error);
    return null;
  }
}

async function requireAuth(req, res) {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    res.status(401).json({
      error: "Authentification requise ou session Firebase invalide.",
    });

    return null;
  }

  return user;
}

// ============================================================
// OUTILS
// ============================================================

function cleanString(value, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    return null;
  }

  return number;
}

function timestampFromDate(value) {
  if (!value) {
    return Timestamp.now();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return Timestamp.now();
  }

  return Timestamp.fromDate(date);
}

function timestampToISO(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function serializeProduct(doc) {
  const data = doc.data();

  return {
    id: doc.id,
    name: data.name || "",
    purchasePrice: Number(data.purchasePrice || 0),
    sellingPrice: Number(data.sellingPrice || 0),
    stockQuantity: Number(data.stockQuantity || 0),
    lowStockThreshold: Number(data.lowStockThreshold ?? 5),
    unit: data.unit || "piece",
    archived: Boolean(data.archived),
    createdAt: timestampToISO(data.createdAt),
    updatedAt: timestampToISO(data.updatedAt),
  };
}

function serializeSale(doc) {
  const data = doc.data();

  return {
    id: doc.id,
    productId: data.productId || "",
    productName: data.productName || "",
    quantity: Number(data.quantity || 0),
    unitSellingPrice: Number(data.unitSellingPrice || 0),
    unitPurchasePrice: Number(data.unitPurchasePrice || 0),
    totalRevenue: Number(data.totalRevenue || 0),
    totalProfit: Number(data.totalProfit || 0),
    saleDate: timestampToISO(data.saleDate),
    createdAt: timestampToISO(data.createdAt),
  };
}

// ============================================================
// COLLECTIONS
// ============================================================

function productsCollection(uid) {
  return db.collection("users").doc(uid).collection("stockProducts");
}

function salesCollection(uid) {
  return db.collection("users").doc(uid).collection("stockSales");
}

function expensesCollection(uid) {
  return db.collection("users").doc(uid).collection("expenses");
}

// ============================================================
// PRODUITS
// GET /api/stock/products
// ============================================================

router.get("/products", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const snapshot = await productsCollection(user.uid)
      .orderBy("createdAt", "desc")
      .get();

    const products = snapshot.docs.map(serializeProduct);

    return res.status(200).json({
      products,
    });
  } catch (error) {
    console.error("GET /products :", error);

    return res.status(500).json({
      error: "Impossible de charger les produits.",
    });
  }
});

// ============================================================
// POST /api/stock/products
// ============================================================

router.post("/products", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = req.body || {};

    const name = cleanString(body.name, 150);
    const purchasePrice = positiveNumber(body.purchasePrice);
    const sellingPrice = positiveNumber(body.sellingPrice);
    const stockQuantity = positiveInteger(body.stockQuantity);
    const lowStockThreshold =
      body.lowStockThreshold === undefined ||
      body.lowStockThreshold === null ||
      body.lowStockThreshold === ""
        ? 5
        : positiveInteger(body.lowStockThreshold);

    const unit = cleanString(body.unit || "piece", 50);

    if (!name) {
      return res.status(400).json({
        error: "Le nom du produit est obligatoire.",
      });
    }

    if (purchasePrice === null || sellingPrice === null) {
      return res.status(400).json({
        error: "Prix invalide.",
      });
    }

    if (stockQuantity === null) {
      return res.status(400).json({
        error: "Quantité de stock invalide.",
      });
    }

    if (lowStockThreshold === null) {
      return res.status(400).json({
        error: "Seuil de stock invalide.",
      });
    }

    // IMPORTANT :
    // Si la vente/produit vient d'IndexedDB, on réutilise son localId.
    // Cela évite de créer deux produits lors d'une resynchronisation.
    const requestedId = cleanString(body.localId, 150);

    const productRef = requestedId
      ? productsCollection(user.uid).doc(requestedId)
      : productsCollection(user.uid).doc();

    const existing = await productRef.get();

    if (existing.exists) {
      return res.status(200).json(
        serializeProduct(existing)
      );
    }

    const now = Timestamp.now();

    await productRef.set({
      name,
      purchasePrice,
      sellingPrice,
      stockQuantity,
      lowStockThreshold,
      unit,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    const created = await productRef.get();

    return res.status(201).json(
      serializeProduct(created)
    );
  } catch (error) {
    console.error("POST /products :", error);

    return res.status(500).json({
      error: "Impossible de créer le produit.",
    });
  }
});

// ============================================================
// PUT /api/stock/products/:id
// ============================================================

router.put("/products/:id", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = cleanString(req.params.id, 150);

    if (!id) {
      return res.status(400).json({
        error: "Identifiant produit manquant.",
      });
    }

    const productRef = productsCollection(user.uid).doc(id);
    const productDoc = await productRef.get();

    if (!productDoc.exists) {
      return res.status(404).json({
        error: "Produit introuvable.",
      });
    }

    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) {
      const name = cleanString(body.name, 150);

      if (!name) {
        return res.status(400).json({
          error: "Nom de produit invalide.",
        });
      }

      updates.name = name;
    }

    if (body.purchasePrice !== undefined) {
      const value = positiveNumber(body.purchasePrice);

      if (value === null) {
        return res.status(400).json({
          error: "Prix d'achat invalide.",
        });
      }

      updates.purchasePrice = value;
    }

    if (body.sellingPrice !== undefined) {
      const value = positiveNumber(body.sellingPrice);

      if (value === null) {
        return res.status(400).json({
          error: "Prix de vente invalide.",
        });
      }

      updates.sellingPrice = value;
    }

    if (body.stockQuantity !== undefined) {
      const value = positiveInteger(body.stockQuantity);

      if (value === null) {
        return res.status(400).json({
          error: "Quantité invalide.",
        });
      }

      updates.stockQuantity = value;
    }

    if (body.lowStockThreshold !== undefined) {
      const value = positiveInteger(body.lowStockThreshold);

      if (value === null) {
        return res.status(400).json({
          error: "Seuil invalide.",
        });
      }

      updates.lowStockThreshold = value;
    }

    if (body.unit !== undefined) {
      updates.unit = cleanString(body.unit, 50) || "piece";
    }

    if (body.archived !== undefined) {
      updates.archived = Boolean(body.archived);
    }

    updates.updatedAt = Timestamp.now();

    await productRef.update(updates);

    const updated = await productRef.get();

    return res.status(200).json(
      serializeProduct(updated)
    );
  } catch (error) {
    console.error("PUT /products/:id :", error);

    return res.status(500).json({
      error: "Impossible de modifier le produit.",
    });
  }
});

// ============================================================
// DELETE /api/stock/products/:id
// ============================================================

router.delete("/products/:id", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = cleanString(req.params.id, 150);

    if (!id) {
      return res.status(400).json({
        error: "Identifiant produit manquant.",
      });
    }

    const productRef = productsCollection(user.uid).doc(id);

    const productDoc = await productRef.get();

    if (!productDoc.exists) {
      return res.status(404).json({
        error: "Produit introuvable.",
      });
    }

    // On archive plutôt que supprimer définitivement.
    await productRef.update({
      archived: true,
      updatedAt: Timestamp.now(),
    });

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.error("DELETE /products/:id :", error);

    return res.status(500).json({
      error: "Impossible d'archiver le produit.",
    });
  }
});

// ============================================================
// VENTES
// GET /api/stock/sales
// ============================================================

router.get("/sales", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const snapshot = await salesCollection(user.uid)
      .orderBy("saleDate", "desc")
      .limit(500)
      .get();

    const today = new Date();

    const sales = snapshot.docs
      .map(serializeSale)
      .filter((sale) => {
        if (!sale.saleDate) return false;

        const date = new Date(sale.saleDate);

        return (
          date.getFullYear() === today.getFullYear() &&
          date.getMonth() === today.getMonth() &&
          date.getDate() === today.getDate()
        );
      });

    return res.status(200).json({
      sales,
    });
  } catch (error) {
    console.error("GET /sales :", error);

    return res.status(500).json({
      error: "Impossible de charger les ventes.",
    });
  }
});

// ============================================================
// POST /api/stock/sales
// ============================================================

router.post("/sales", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = req.body || {};

    const productId = cleanString(body.productId, 150);
    const quantity = positiveInteger(body.quantity);

    if (!productId) {
      return res.status(400).json({
        error: "Produit manquant.",
      });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        error: "Quantité de vente invalide.",
      });
    }

    // Utilisation du localId pour rendre la synchronisation idempotente.
    const saleId =
      cleanString(body.localId, 150) ||
      db.collection("_tmp").doc().id;

    const saleRef = salesCollection(user.uid).doc(saleId);
    const productRef = productsCollection(user.uid).doc(productId);

    const result = await db.runTransaction(async (transaction) => {
      // Si la vente existe déjà, on la retourne.
      const existingSale = await transaction.get(saleRef);

      if (existingSale.exists) {
        return {
          alreadyExists: true,
          sale: existingSale,
        };
      }

      const productDoc = await transaction.get(productRef);

      if (!productDoc.exists) {
        const error = new Error("Produit introuvable.");
        error.statusCode = 404;
        throw error;
      }

      const product = productDoc.data();

      if (product.archived) {
        const error = new Error("Ce produit est archivé.");
        error.statusCode = 400;
        throw error;
      }

      const currentStock = Number(product.stockQuantity || 0);

      if (quantity > currentStock) {
        const error = new Error(
          `Stock insuffisant. Stock disponible : ${currentStock}.`
        );

        error.statusCode = 409;
        throw error;
      }

      const sellingPrice = Number(product.sellingPrice || 0);
      const purchasePrice = Number(product.purchasePrice || 0);

      const totalRevenue = quantity * sellingPrice;
      const totalProfit =
        quantity * (sellingPrice - purchasePrice);

      const saleDate = timestampFromDate(body.saleDate);
      const now = Timestamp.now();

      const saleData = {
        productId,
        productName: product.name || "",
        quantity,
        unitSellingPrice: sellingPrice,
        unitPurchasePrice: purchasePrice,
        totalRevenue,
        totalProfit,
        saleDate,
        createdAt: now,
      };

      transaction.update(productRef, {
        stockQuantity: currentStock - quantity,
        updatedAt: now,
      });

      transaction.set(saleRef, saleData);

      return {
        alreadyExists: false,
        sale: {
          id: saleId,
          data: () => saleData,
        },
      };
    });

    if (result.alreadyExists) {
      return res.status(200).json(
        serializeSale(result.sale)
      );
    }

    return res.status(201).json(
      serializeSale(result.sale)
    );
  } catch (error) {
    console.error("POST /sales :", error);

    const status =
      Number.isInteger(error.statusCode)
        ? error.statusCode
        : 500;

    return res.status(status).json({
      error:
        error.message ||
        "Impossible d'enregistrer la vente.",
    });
  }
});

// ============================================================
// DELETE /api/stock/sales/:id
// (Le frontend appelait déjà cette route pour le retrait d'une vente et la
// réintégration de stock, mais elle n'existait pas côté backend — ajoutée
// ici. Nécessaire pour que le retrait de vente en ligne, ET la synchro
// différée du type "delete-sale" côté frontend, fonctionnent réellement.)
// ============================================================

router.delete("/sales/:id", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = cleanString(req.params.id, 150);

    if (!id) {
      return res.status(400).json({
        error: "Identifiant de vente manquant.",
      });
    }

    const saleRef = salesCollection(user.uid).doc(id);

    const result = await db.runTransaction(async (transaction) => {
      const saleDoc = await transaction.get(saleRef);

      if (!saleDoc.exists) {
        return { notFound: true };
      }

      const sale = saleDoc.data();
      const productRef = productsCollection(user.uid).doc(sale.productId);
      const productDoc = await transaction.get(productRef);

      // Si le produit a depuis été supprimé/archivé différemment, on ne
      // bloque pas le retrait de la vente pour autant — on réintègre le
      // stock seulement si le produit existe toujours.
      if (productDoc.exists) {
        const currentStock = Number(productDoc.data().stockQuantity || 0);

        transaction.update(productRef, {
          stockQuantity: currentStock + Number(sale.quantity || 0),
          updatedAt: Timestamp.now(),
        });
      }

      transaction.delete(saleRef);

      return { notFound: false };
    });

    if (result.notFound) {
      // Idempotent : si la vente n'existe déjà plus (ex: la file d'attente
      // hors ligne rejoue une suppression déjà appliquée), on répond succès
      // plutôt que 404 pour ne pas bloquer indéfiniment la synchro.
      return res.status(200).json({
        success: true,
        alreadyDeleted: true,
      });
    }

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.error("DELETE /sales/:id :", error);

    return res.status(500).json({
      error: "Impossible de retirer la vente.",
    });
  }
});

// ============================================================
// RAPPORT JOURNALIER
// GET /api/stock/reports/daily?date=YYYY-MM-DD
// ============================================================

router.get("/reports/daily", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const dateString =
      cleanString(req.query.date, 20);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return res.status(400).json({
        error: "Date invalide.",
      });
    }

    const startDate = new Date(
      `${dateString}T00:00:00`
    );

    const endDate = new Date(
      `${dateString}T23:59:59.999`
    );

    const snapshot = await salesCollection(user.uid)
      .where(
        "saleDate",
        ">=",
        Timestamp.fromDate(startDate)
      )
      .where(
        "saleDate",
        "<=",
        Timestamp.fromDate(endDate)
      )
      .get();

    let totalRevenue = 0;
    let totalProfit = 0;
    let totalQuantity = 0;

    snapshot.docs.forEach((doc) => {
      const sale = doc.data();

      totalRevenue += Number(
        sale.totalRevenue || 0
      );

      totalProfit += Number(
        sale.totalProfit || 0
      );

      totalQuantity += Number(
        sale.quantity || 0
      );
    });

    // Les dépenses de la page Finances sont normalement dans
    // users/{uid}/expenses. Si la collection n'existe pas encore,
    // Firestore renvoie simplement une collection vide.
    let totalExpenses = 0;

    try {
      const expensesSnapshot = await expensesCollection(user.uid)
        .where(
          "createdAt",
          ">=",
          Timestamp.fromDate(startDate)
        )
        .where(
          "createdAt",
          "<=",
          Timestamp.fromDate(endDate)
        )
        .get();

      expensesSnapshot.docs.forEach((doc) => {
        const expense = doc.data();

        totalExpenses += Number(
          expense.amount || 0
        );
      });
    } catch (expenseError) {
      console.warn(
        "Collection expenses indisponible :",
        expenseError.message
      );
    }

    return res.status(200).json({
      date: dateString,
      totalRevenue,
      totalProfit,
      totalExpenses,
      netProfit: totalProfit - totalExpenses,
      totalQuantity,
      salesCount: snapshot.size,
    });
  } catch (error) {
    console.error(
      "GET /reports/daily :",
      error
    );

    return res.status(500).json({
      error: "Impossible de générer le rapport journalier.",
    });
  }
});

// ============================================================
// CLÔTURE DE JOURNÉE
// POST /api/stock/reports/close-day
//
// ⚠️ CHANGEMENT : cette route ne supprime plus rien elle-même. Elle se
// contente de générer le PDF du rapport et de le renvoyer. La suppression
// réelle des ventes du jour se fait via la route séparée ci-dessous
// (/reports/close-day/confirm), appelée par le frontend UNIQUEMENT après que
// le PDF a bien été téléchargé côté client — pour ne jamais perdre de
// données si le téléchargement échoue ou si la connexion coupe entre les
// deux.
// ============================================================

router.post("/reports/close-day", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const today = new Date();

    const dateString =
      `${today.getFullYear()}-${String(
        today.getMonth() + 1
      ).padStart(2, "0")}-${String(
        today.getDate()
      ).padStart(2, "0")}`;

    const startDate = new Date(
      `${dateString}T00:00:00`
    );

    const endDate = new Date(
      `${dateString}T23:59:59.999`
    );

    const snapshot = await salesCollection(user.uid)
      .where(
        "saleDate",
        ">=",
        Timestamp.fromDate(startDate)
      )
      .where(
        "saleDate",
        "<=",
        Timestamp.fromDate(endDate)
      )
      .get();

    const sales = snapshot.docs.map((doc) => doc.data());

    let totalRevenue = 0;
    let totalProfit = 0;
    let totalQuantity = 0;
    const perProduct = new Map(); // productName -> { quantity, profit }

    sales.forEach((sale) => {
      totalRevenue += Number(sale.totalRevenue || 0);
      totalProfit += Number(sale.totalProfit || 0);
      totalQuantity += Number(sale.quantity || 0);

      const key = sale.productName || "Produit inconnu";
      const entry = perProduct.get(key) || { quantity: 0, profit: 0 };
      entry.quantity += Number(sale.quantity || 0);
      entry.profit += Number(sale.totalProfit || 0);
      perProduct.set(key, entry);
    });

    let topSeller = null;
    let lowestProfitProduct = null;

    for (const [name, stats] of perProduct.entries()) {
      if (!topSeller || stats.quantity > topSeller.quantity) {
        topSeller = { name, ...stats };
      }
      if (!lowestProfitProduct || stats.profit < lowestProfitProduct.profit) {
        lowestProfitProduct = { name, ...stats };
      }
    }

    // ---- Génération du PDF (mise en page plus professionnelle) ----
    const PDFDocument = require("pdfkit");
    const path = require("path");
    const fs = require("fs");
    const sealPath = path.join(__dirname, "assets", "kontrasceau.png");

    const pdf = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks = [];

    pdf.on("data", (chunk) => {
      chunks.push(chunk);
    });

    const pdfPromise = new Promise((resolve, reject) => {
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
    });

    // En-tête
    pdf.fillColor("#000000").font("Helvetica-Bold").fontSize(20).text("KONTRA-AFRICA", 50, 45);
    pdf.font("Helvetica").fontSize(8).text(`Rapport journalier — ${dateString}`, 50, 72);
    pdf.strokeColor("#000000").moveTo(50, 90).lineTo(545, 90).stroke();

    let y = 110;
    pdf.font("Helvetica-Bold").fontSize(12).text("RAPPORT DU JOUR", 50, y);
    y += 25;

    pdf.font("Helvetica-Bold").fontSize(10).text("Détail des ventes", 50, y);
    y += 18;
    pdf.font("Helvetica").fontSize(9);

    if (sales.length === 0) {
      pdf.text("Aucune vente enregistrée aujourd'hui.", 50, y);
      y += 16;
    } else {
      sales.forEach((sale) => {
        pdf.text(
          `${sale.productName || "?"} × ${sale.quantity} — ${sale.totalRevenue} (bénéfice ${sale.totalProfit})`,
          50,
          y
        );
        y += 14;
        if (y > 720) {
          pdf.addPage();
          y = 50;
        }
      });
    }

    y += 10;
    pdf.strokeColor("#000000").moveTo(50, y).lineTo(545, y).stroke();
    y += 15;

    pdf.font("Helvetica-Bold").fontSize(10).text("Résumé", 50, y);
    y += 16;
    pdf.font("Helvetica").fontSize(9);
    pdf.text(`Chiffre d'affaires total : ${totalRevenue}`, 50, y);
    y += 14;
    pdf.text(`Bénéfice total : ${totalProfit}`, 50, y);
    y += 14;
    pdf.text(`Nombre de ventes : ${snapshot.size}`, 50, y);
    y += 14;
    pdf.text(`Quantité totale vendue : ${totalQuantity}`, 50, y);
    y += 20;

    if (topSeller) {
      pdf.font("Helvetica-Bold").text("Produit le plus vendu : ", 50, y, { continued: true });
      pdf.font("Helvetica").text(`${topSeller.name} (${topSeller.quantity} unités)`);
      y += 16;
    }
    if (lowestProfitProduct) {
      pdf.font("Helvetica-Bold").text("Produit au bénéfice le plus faible : ", 50, y, { continued: true });
      pdf.font("Helvetica").text(`${lowestProfitProduct.name} (${lowestProfitProduct.profit})`);
      y += 16;
    }

    // Sceau + pied de page
    if (fs.existsSync(sealPath)) {
      try {
        pdf.image(sealPath, 480, 720, { fit: [50, 50] });
      } catch (e) {
        console.error("Erreur sceau :", e);
      }
    }
    pdf.strokeColor("#000000").moveTo(50, 770).lineTo(545, 770).stroke();
    pdf.font("Helvetica").fontSize(8).text("Kontra-Africa — Rapport de gestion", 50, 778);

    pdf.end();
    const buffer = await pdfPromise;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-${dateString}.pdf"`);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("POST /reports/close-day :", error);

    return res.status(500).json({
      error: "Impossible de générer le rapport de clôture.",
    });
  }
});

// ============================================================
// CONFIRMATION DE CLÔTURE — supprime réellement les ventes du jour
// POST /api/stock/reports/close-day/confirm
//
// Appelée par le frontend uniquement après confirmation que le PDF a bien
// été téléchargé côté client. Supprime réellement (pas d'archivage) les
// ventes du jour. Ne touche JAMAIS aux produits ni à leur stock.
// ============================================================

router.post("/reports/close-day/confirm", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const today = new Date();

    const dateString =
      `${today.getFullYear()}-${String(
        today.getMonth() + 1
      ).padStart(2, "0")}-${String(
        today.getDate()
      ).padStart(2, "0")}`;

    const startDate = new Date(`${dateString}T00:00:00`);
    const endDate = new Date(`${dateString}T23:59:59.999`);

    const snapshot = await salesCollection(user.uid)
      .where("saleDate", ">=", Timestamp.fromDate(startDate))
      .where("saleDate", "<=", Timestamp.fromDate(endDate))
      .get();

    if (!snapshot.empty) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return res.status(200).json({
      deleted: snapshot.size,
    });
  } catch (error) {
    console.error("POST /reports/close-day/confirm :", error);

    return res.status(500).json({
      error: "Erreur lors de la suppression des ventes du jour.",
    });
  }
});

module.exports = router;
