// ============================================================
// functions/src/stock.js
// Gestion du stock, des ventes et des dépenses (Kontra-Africa)
// ============================================================

const express = require("express");
const PDFDocument = require("pdfkit");
const { db } = require("./config");
const { getVerifiedUid } = require("./verify-auth");
const { formatDate, drawLine, drawSeal } = require("./pdf-generator");

const router = express.Router();

// ============================================================
// Helpers
// ============================================================

function getTodayInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function extractDayInTimezone(saleDateValue, timezone) {
  let dateObj;
  if (saleDateValue && typeof saleDateValue.toDate === "function") {
    dateObj = saleDateValue.toDate();
  } else if (saleDateValue instanceof Date) {
    dateObj = saleDateValue;
  } else {
    dateObj = new Date(saleDateValue);
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(dateObj);
}

async function getUserTimezone(uid) {
  const userSnap = await db.collection("users").doc(uid).get();
  const data = userSnap.exists ? userSnap.data() : null;
  return (data && data.timezone) || "Africa/Kinshasa";
}

// ============================================================
// PRODUCTS
// ============================================================

router.post("/products", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { name, purchasePrice, sellingPrice, stockQuantity, lowStockThreshold, unit } = req.body;
    if (!name || purchasePrice === undefined || sellingPrice === undefined || stockQuantity === undefined) {
      return res.status(400).json({ error: "Champs requis manquants : name, purchasePrice, sellingPrice, stockQuantity" });
    }
    if (purchasePrice < 0 || sellingPrice < 0 || stockQuantity < 0) {
      return res.status(400).json({ error: "Les valeurs numériques ne peuvent pas être négatives" });
    }
    const now = new Date();
    const productRef = db.collection("users").doc(uid).collection("products").doc();
    const product = {
      name,
      purchasePrice: Number(purchasePrice),
      sellingPrice: Number(sellingPrice),
      stockQuantity: Number(stockQuantity),
      lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : 5,
      unit: unit || null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await productRef.set(product);
    return res.status(201).json({ id: productRef.id, ...product });
  } catch (error) {
    console.error("Erreur POST /products :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la création du produit" });
  }
});

router.put("/products/:id", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { id } = req.params;
    const { name, purchasePrice, sellingPrice, stockQuantity, lowStockThreshold, unit } = req.body;
    const productRef = db.collection("users").doc(uid).collection("products").doc(id);
    const snap = await productRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Produit introuvable" });
    const updates = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (purchasePrice !== undefined) updates.purchasePrice = Number(purchasePrice);
    if (sellingPrice !== undefined) updates.sellingPrice = Number(sellingPrice);
    if (stockQuantity !== undefined) updates.stockQuantity = Number(stockQuantity);
    if (lowStockThreshold !== undefined) updates.lowStockThreshold = Number(lowStockThreshold);
    if (unit !== undefined) updates.unit = unit;
    await productRef.update(updates);
    return res.status(200).json({ id, ...snap.data(), ...updates });
  } catch (error) {
    console.error("Erreur PUT /products/:id :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la modification du produit" });
  }
});

router.delete("/products/:id", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { id } = req.params;
    const productRef = db.collection("users").doc(uid).collection("products").doc(id);
    const snap = await productRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Produit introuvable" });
    await productRef.update({ archived: true, updatedAt: new Date() });
    return res.status(200).json({ id, archived: true });
  } catch (error) {
    console.error("Erreur DELETE /products/:id :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'archivage du produit" });
  }
});

router.get("/products", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const snap = await db.collection("users").doc(uid).collection("products").where("archived", "==", false).get();
    const products = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ products });
  } catch (error) {
    console.error("Erreur GET /products :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la récupération des produits" });
  }
});

// ============================================================
// SALES
// ============================================================

router.post("/sales", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { productId, quantity, saleDate, localId } = req.body;
    if (!productId || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: "productId et quantity (> 0) sont requis" });
    }
    const userRef = db.collection("users").doc(uid);
    const productRef = userRef.collection("products").doc(productId);
    const salesRef = userRef.collection("sales");
    if (localId) {
      const existingSnap = await salesRef.where("localId", "==", localId).limit(1).get();
      if (!existingSnap.empty) {
        const existingDoc = existingSnap.docs[0];
        return res.status(200).json({ id: existingDoc.id, ...existingDoc.data(), alreadyExisted: true });
      }
    }
    const qty = Number(quantity);
    const saleDocRef = salesRef.doc();
    const result = await db.runTransaction(async (transaction) => {
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists) throw { status: 404, message: "Produit introuvable" };
      const product = productSnap.data();
      if (product.stockQuantity < qty) throw { status: 400, message: "Stock insuffisant" };
      const newStock = product.stockQuantity - qty;
      const totalRevenue = qty * product.sellingPrice;
      const totalProfit = qty * (product.sellingPrice - product.purchasePrice);
      const saleData = {
        productId,
        productName: product.name,
        quantity: qty,
        unitSellingPrice: product.sellingPrice,
        unitPurchasePrice: product.purchasePrice,
        totalRevenue,
        totalProfit,
        saleDate: saleDate ? new Date(saleDate) : new Date(),
        localId: localId || null,
        createdAt: new Date(),
      };
      transaction.update(productRef, { stockQuantity: newStock, updatedAt: new Date() });
      transaction.set(saleDocRef, saleData);
      return { sale: saleData, newStock, lowStockThreshold: product.lowStockThreshold !== undefined ? product.lowStockThreshold : 5 };
    });
    const lowStockAlert = result.newStock <= result.lowStockThreshold;
    return res.status(201).json({ id: saleDocRef.id, ...result.sale, lowStockAlert });
  } catch (error) {
    if (error && error.status) return res.status(error.status).json({ error: error.message });
    console.error("Erreur POST /sales :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'enregistrement de la vente" });
  }
});

router.get("/sales", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const timezone = await getUserTimezone(uid);
    let { date } = req.query;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Paramètre date invalide, format attendu YYYY-MM-DD" });
    }
    if (!date) date = getTodayInTimezone(timezone);
    const windowStart = new Date(`${date}T00:00:00.000Z`);
    windowStart.setUTCDate(windowStart.getUTCDate() - 1);
    const windowEnd = new Date(`${date}T23:59:59.999Z`);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
    const snap = await db.collection("users").doc(uid).collection("sales")
      .where("saleDate", ">=", windowStart).where("saleDate", "<=", windowEnd).get();
    const sales = snap.docs.map((doc) => {
      const data = doc.data();
      const saleDateObj = data.saleDate && typeof data.saleDate.toDate === "function" ? data.saleDate.toDate() : new Date(data.saleDate);
      return {
        id: doc.id, productId: data.productId, productName: data.productName, quantity: data.quantity,
        unitSellingPrice: data.unitSellingPrice, unitPurchasePrice: data.unitPurchasePrice,
        totalRevenue: data.totalRevenue, totalProfit: data.totalProfit,
        saleDate: saleDateObj.toISOString(), _saleDateObj: saleDateObj,
      };
    }).filter((sale) => extractDayInTimezone(sale._saleDateObj, timezone) === date)
      .sort((a, b) => b._saleDateObj - a._saleDateObj)
      .map(({ _saleDateObj, ...sale }) => sale);
    const summary = sales.reduce((acc, sale) => {
      acc.revenue += sale.totalRevenue || 0; acc.profit += sale.totalProfit || 0; acc.count += 1; return acc;
    }, { revenue: 0, profit: 0, count: 0 });
    return res.status(200).json({ date, sales, summary });
  } catch (error) {
    console.error("Erreur GET /sales :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la récupération des ventes" });
  }
});

router.delete("/sales/:id", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { id } = req.params;
    const userRef = db.collection("users").doc(uid);
    const saleRef = userRef.collection("sales").doc(id);
    const saleSnap = await saleRef.get();
    if (!saleSnap.exists) return res.status(404).json({ error: "Vente introuvable" });
    const sale = saleSnap.data();
    const timezone = await getUserTimezone(uid);
    const today = getTodayInTimezone(timezone);
    const saleDay = extractDayInTimezone(sale.saleDate, timezone);
    if (saleDay !== today) return res.status(403).json({ error: "Impossible de retirer une vente d'un jour précédent" });
    const productRef = userRef.collection("products").doc(sale.productId);
    await db.runTransaction(async (transaction) => {
      const productSnap = await transaction.get(productRef);
      if (productSnap.exists) {
        const product = productSnap.data();
        transaction.update(productRef, { stockQuantity: product.stockQuantity + sale.quantity, updatedAt: new Date() });
      }
      transaction.delete(saleRef);
    });
    return res.status(200).json({ id, deleted: true });
  } catch (error) {
    console.error("Erreur DELETE /sales/:id :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la suppression de la vente" });
  }
});

// ============================================================
// REPORTS
// ============================================================

router.get("/reports/daily", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Paramètre date requis au format YYYY-MM-DD" });
    }
    const timezone = await getUserTimezone(uid);
    const userRef = db.collection("users").doc(uid);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59.999`);
    const salesSnap = await userRef.collection("sales").where("saleDate", ">=", dayStart).where("saleDate", "<=", dayEnd).get();
    let salesRevenue = 0, salesProfit = 0, salesCount = 0;
    salesSnap.forEach((doc) => {
      const sale = doc.data();
      if (extractDayInTimezone(sale.saleDate, timezone) === date) {
        salesRevenue += sale.totalRevenue || 0; salesProfit += sale.totalProfit || 0; salesCount += 1;
      }
    });
    const expensesSnap = await userRef.collection("expenses").where("expenseDate", ">=", dayStart).where("expenseDate", "<=", dayEnd).get();
    let totalExpenses = 0;
    expensesSnap.forEach((doc) => {
      const expense = doc.data();
      if (extractDayInTimezone(expense.expenseDate, timezone) === date) totalExpenses += expense.amount || 0;
    });
    const netProfit = salesProfit - totalExpenses;
    return res.status(200).json({ date, salesCount, salesRevenue, salesProfit, totalExpenses, netProfit });
  } catch (error) {
    console.error("Erreur GET /reports/daily :", error);
    return res.status(500).json({ error: "Erreur serveur lors du calcul du rapport" });
  }
});

// ============================================================
// CLÔTURE DE JOURNÉE (génération PDF + archivage des ventes)
// ============================================================

function generateCloseDayPdf({ date, sales, totalExpenses, summary, netProfit }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // ------------------------------------------------------------
      // En-tête
      // ------------------------------------------------------------
      doc.fillColor("#000000");
      doc.font("Helvetica-Bold").fontSize(20).text("KONTRA-AFRICA", 50, 45);
      doc.font("Helvetica").fontSize(8).text(`Rapport journalier — ${formatDate(new Date())}`, 50, 72);
      drawLine(doc, 50, 90, 545, 90);

      // ------------------------------------------------------------
      // Titre
      // ------------------------------------------------------------
      doc.font("Helvetica-Bold").fontSize(12).text("RAPPORT DU JOUR", 50, 110);

      // ------------------------------------------------------------
      // Liste des ventes
      // ------------------------------------------------------------
      let y = 135;
      doc.font("Helvetica").fontSize(10);
      if (sales.length === 0) {
        doc.text("Aucune vente enregistrée aujourd'hui.", 50, y);
        y += 20;
      } else {
        sales.forEach((sale) => {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
          const line = `${sale.productName}  —  Qté : ${sale.quantity}  —  Prix vente : ${sale.unitSellingPrice}  —  Bénéfice : ${sale.totalProfit}`;
          doc.font("Helvetica").fontSize(10).text(line, 50, y);
          y += 16;
        });
      }

      // ------------------------------------------------------------
      // Encadré résumé
      // ------------------------------------------------------------
      y += 10;
      if (y > 650) {
        doc.addPage();
        y = 50;
      }
      const boxTop = y;
      doc.rect(50, boxTop, 495, 110).strokeColor("#000000").stroke();
      let ry = boxTop + 12;
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text("Chiffre d'affaires total :", 60, ry);
      doc.font("Helvetica").text(`${summary.revenue}`, 300, ry);
      ry += 18;
      doc.font("Helvetica-Bold").text("Bénéfice total des ventes :", 60, ry);
      doc.font("Helvetica").text(`${summary.profit}`, 300, ry);
      ry += 18;
      doc.font("Helvetica-Bold").text("Nombre de ventes :", 60, ry);
      doc.font("Helvetica").text(`${summary.count}`, 300, ry);
      ry += 18;
      doc.font("Helvetica-Bold").text("Total des dépenses :", 60, ry);
      doc.font("Helvetica").text(`${totalExpenses}`, 300, ry);
      ry += 18;
      doc.font("Helvetica-Bold").text("Bénéfice net :", 60, ry);
      doc.font("Helvetica").text(`${netProfit}`, 300, ry);

      // ------------------------------------------------------------
      // Pied de page (répété sur chaque page)
      // ------------------------------------------------------------
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const pageHeight = doc.page.height;
        drawLine(doc, 50, pageHeight - 70, 545, pageHeight - 70);
        doc.font("Helvetica").fontSize(8).fillColor("#000000");
        doc.text("Kontra-Africa — Rapport de gestion", 50, pageHeight - 55);
        doc.text(`Page ${i - range.start + 1} / ${range.count}`, 0, pageHeight - 55, { align: "right", width: 545 });
        drawSeal(doc, 500, pageHeight - 75, 30);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

router.post("/reports/close-day", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const timezone = await getUserTimezone(uid);
    const date = getTodayInTimezone(timezone);
    const userRef = db.collection("users").doc(uid);

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59.999`);

    // ------------------------------------------------------------
    // Ventes du jour non archivées
    // ------------------------------------------------------------
    const salesSnap = await userRef.collection("sales")
      .where("saleDate", ">=", dayStart)
      .where("saleDate", "<=", dayEnd)
      .get();

    const dailySales = [];
    salesSnap.forEach((doc) => {
      const sale = doc.data();
      if (sale.archived === true) return;
      if (extractDayInTimezone(sale.saleDate, timezone) === date) {
        dailySales.push({ id: doc.id, ...sale });
      }
    });

    // ------------------------------------------------------------
    // Dépenses du jour
    // ------------------------------------------------------------
    const expensesSnap = await userRef.collection("expenses")
      .where("expenseDate", ">=", dayStart)
      .where("expenseDate", "<=", dayEnd)
      .get();

    let totalExpenses = 0;
    expensesSnap.forEach((doc) => {
      const expense = doc.data();
      if (extractDayInTimezone(expense.expenseDate, timezone) === date) {
        totalExpenses += expense.amount || 0;
      }
    });

    const summary = dailySales.reduce((acc, sale) => {
      acc.revenue += sale.totalRevenue || 0;
      acc.profit += sale.totalProfit || 0;
      acc.count += 1;
      return acc;
    }, { revenue: 0, profit: 0, count: 0 });

    const netProfit = summary.profit - totalExpenses;

    // ------------------------------------------------------------
    // Génération du PDF (aucune écriture Firestore avant succès)
    // ------------------------------------------------------------
    let buffer;
    try {
      buffer = await generateCloseDayPdf({ date, sales: dailySales, totalExpenses, summary, netProfit });
    } catch (pdfError) {
      console.error("Erreur génération PDF clôture :", pdfError);
      return res.status(500).json({ error: "Erreur serveur lors de la génération du PDF de clôture" });
    }

    // ------------------------------------------------------------
    // Suppression définitive des ventes du jour (seulement si le PDF a réussi)
    // Choix produit : le PDF téléchargé est la seule trace conservée de la
    // journée, les documents Firestore sont libérés pour repartir à zéro.
    // ------------------------------------------------------------
    if (dailySales.length > 0) {
      const batch = db.batch();
      dailySales.forEach((sale) => {
        const saleRef = userRef.collection("sales").doc(sale.id);
        batch.delete(saleRef);
      });
      await batch.commit();
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-${date}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    console.error("Erreur POST /reports/close-day :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la clôture du jour" });
  }
});

// ============================================================
// EXPENSES
// ============================================================

router.post("/expenses", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { label, amount, category, expenseDate } = req.body;
    if (!label || amount === undefined || Number(amount) < 0) {
      return res.status(400).json({ error: "label et amount (>= 0) sont requis" });
    }
    const expenseRef = db.collection("users").doc(uid).collection("expenses").doc();
    const expense = { label, amount: Number(amount), category: category || null, expenseDate: expenseDate ? new Date(expenseDate) : new Date(), createdAt: new Date() };
    await expenseRef.set(expense);
    return res.status(201).json({ id: expenseRef.id, ...expense });
  } catch (error) {
    console.error("Erreur POST /expenses :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'ajout de la dépense" });
  }
});

router.get("/expenses", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });
    const { from, to } = req.query;
    let query = db.collection("users").doc(uid).collection("expenses");
    if (from) query = query.where("expenseDate", ">=", new Date(`${from}T00:00:00`));
    if (to) query = query.where("expenseDate", "<=", new Date(`${to}T23:59:59.999`));
    const snap = await query.get();
    const expenses = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ expenses });
  } catch (error) {
    console.error("Erreur GET /expenses :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la récupération des dépenses" });
  }
});

module.exports = router;
