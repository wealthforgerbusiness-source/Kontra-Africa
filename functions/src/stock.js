// ============================================================
// functions/src/stock.js
// Gestion du stock, des ventes et des dépenses (Kontra-Africa)
// ============================================================

const express = require("express");
const { db } = require("./config");
const { getVerifiedUid } = require("./verify-auth");

const router = express.Router();

// ============================================================
// Helpers
// ============================================================

/**
 * Retourne la date du jour (YYYY-MM-DD) dans le fuseau donné,
 * sans dépendance externe (Intl.DateTimeFormat natif).
 */
function getTodayInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "en-CA" formate directement en YYYY-MM-DD
  return formatter.format(new Date());
}

/**
 * Extrait la partie YYYY-MM-DD d'un saleDate (Timestamp Firestore,
 * string ISO, ou objet Date), dans le fuseau donné.
 */
function extractDayInTimezone(saleDateValue, timezone) {
  let dateObj;

  if (saleDateValue && typeof saleDateValue.toDate === "function") {
    // Timestamp Firestore
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

/**
 * Récupère le fuseau horaire de l'utilisateur (défaut Africa/Kinshasa).
 */
async function getUserTimezone(uid) {
  const userSnap = await db.collection("users").doc(uid).get();
  const data = userSnap.exists ? userSnap.data() : null;
  return (data && data.timezone) || "Africa/Kinshasa";
}

// ============================================================
// PRODUCTS
// ============================================================

// POST /products — créer un produit
router.post("/products", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const {
      name,
      purchasePrice,
      sellingPrice,
      stockQuantity,
      lowStockThreshold,
      unit,
    } = req.body;

    if (
      !name ||
      purchasePrice === undefined ||
      sellingPrice === undefined ||
      stockQuantity === undefined
    ) {
      return res.status(400).json({
        error:
          "Champs requis manquants : name, purchasePrice, sellingPrice, stockQuantity",
      });
    }

    if (purchasePrice < 0 || sellingPrice < 0 || stockQuantity < 0) {
      return res.status(400).json({ error: "Les valeurs numériques ne peuvent pas être négatives" });
    }

    const now = new Date();
    const productRef = db
      .collection("users")
      .doc(uid)
      .collection("products")
      .doc();

    const product = {
      name,
      purchasePrice: Number(purchasePrice),
      sellingPrice: Number(sellingPrice),
      stockQuantity: Number(stockQuantity),
      lowStockThreshold:
        lowStockThreshold !== undefined ? Number(lowStockThreshold) : 5,
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

// PUT /products/:id — modifier un produit
router.put("/products/:id", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const { id } = req.params;
    const {
      name,
      purchasePrice,
      sellingPrice,
      stockQuantity,
      lowStockThreshold,
      unit,
    } = req.body;

    const productRef = db
      .collection("users")
      .doc(uid)
      .collection("products")
      .doc(id);

    const snap = await productRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Produit introuvable" });
    }

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

// DELETE /products/:id — soft delete (archivage, jamais de suppression physique)
router.delete("/products/:id", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const { id } = req.params;

    const productRef = db
      .collection("users")
      .doc(uid)
      .collection("products")
      .doc(id);

    const snap = await productRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Produit introuvable" });
    }

    await productRef.update({ archived: true, updatedAt: new Date() });

    return res.status(200).json({ id, archived: true });
  } catch (error) {
    console.error("Erreur DELETE /products/:id :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'archivage du produit" });
  }
});

// GET /products — lister les produits actifs
router.get("/products", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("products")
      .where("archived", "==", false)
      .get();

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

// POST /sales — enregistrer une vente (décrémente le stock via transaction)
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

    // Idempotence : si une vente avec ce localId existe déjà, la renvoyer telle quelle
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

      if (!productSnap.exists) {
        throw { status: 404, message: "Produit introuvable" };
      }

      const product = productSnap.data();

      if (product.stockQuantity < qty) {
        throw { status: 400, message: "Stock insuffisant" };
      }

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

      return {
        sale: saleData,
        newStock,
        lowStockThreshold: product.lowStockThreshold !== undefined ? product.lowStockThreshold : 5,
      };
    });

    const lowStockAlert = result.newStock <= result.lowStockThreshold;

    return res.status(201).json({
      id: saleDocRef.id,
      ...result.sale,
      lowStockAlert,
    });
  } catch (error) {
    if (error && error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Erreur POST /sales :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'enregistrement de la vente" });
  }
});

// DELETE /sales/:id — retrait autorisé uniquement le jour même (fuseau utilisateur)
router.delete("/sales/:id", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const { id } = req.params;

    const userRef = db.collection("users").doc(uid);
    const saleRef = userRef.collection("sales").doc(id);

    const saleSnap = await saleRef.get();
    if (!saleSnap.exists) {
      return res.status(404).json({ error: "Vente introuvable" });
    }

    const sale = saleSnap.data();
    const timezone = await getUserTimezone(uid);

    const today = getTodayInTimezone(timezone);
    const saleDay = extractDayInTimezone(sale.saleDate, timezone);

    if (saleDay !== today) {
      return res.status(403).json({
        error: "Impossible de retirer une vente d'un jour précédent",
      });
    }

    const productRef = userRef.collection("products").doc(sale.productId);

    await db.runTransaction(async (transaction) => {
      const productSnap = await transaction.get(productRef);

      if (productSnap.exists) {
        const product = productSnap.data();
        transaction.update(productRef, {
          stockQuantity: product.stockQuantity + sale.quantity,
          updatedAt: new Date(),
        });
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

// GET /reports/daily?date=YYYY-MM-DD
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

    // Bornes du jour dans le fuseau utilisateur, ramenées en UTC pour la requête
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59.999`);

    const salesSnap = await userRef
      .collection("sales")
      .where("saleDate", ">=", dayStart)
      .where("saleDate", "<=", dayEnd)
      .get();

    let salesRevenue = 0;
    let salesProfit = 0;
    let salesCount = 0;

    salesSnap.forEach((doc) => {
      const sale = doc.data();
      const saleDay = extractDayInTimezone(sale.saleDate, timezone);
      if (saleDay === date) {
        salesRevenue += sale.totalRevenue || 0;
        salesProfit += sale.totalProfit || 0;
        salesCount += 1;
      }
    });

    const expensesSnap = await userRef
      .collection("expenses")
      .where("expenseDate", ">=", dayStart)
      .where("expenseDate", "<=", dayEnd)
      .get();

    let totalExpenses = 0;
    expensesSnap.forEach((doc) => {
      const expense = doc.data();
      const expenseDay = extractDayInTimezone(expense.expenseDate, timezone);
      if (expenseDay === date) {
        totalExpenses += expense.amount || 0;
      }
    });

    const netProfit = salesProfit - totalExpenses;

    return res.status(200).json({
      date,
      salesCount,
      salesRevenue,
      salesProfit,
      totalExpenses,
      netProfit,
    });
  } catch (error) {
    console.error("Erreur GET /reports/daily :", error);
    return res.status(500).json({ error: "Erreur serveur lors du calcul du rapport" });
  }
});

// ============================================================
// EXPENSES
// ============================================================

// POST /expenses — ajouter une dépense
router.post("/expenses", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const { label, amount, category, expenseDate } = req.body;

    if (!label || amount === undefined || Number(amount) < 0) {
      return res.status(400).json({ error: "label et amount (>= 0) sont requis" });
    }

    const expenseRef = db
      .collection("users")
      .doc(uid)
      .collection("expenses")
      .doc();

    const expense = {
      label,
      amount: Number(amount),
      category: category || null,
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      createdAt: new Date(),
    };

    await expenseRef.set(expense);

    return res.status(201).json({ id: expenseRef.id, ...expense });
  } catch (error) {
    console.error("Erreur POST /expenses :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'ajout de la dépense" });
  }
});

// GET /expenses?from=&to= — lister sur une période
router.get("/expenses", async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);
    if (!uid) return res.status(401).json({ error: "Non authentifié" });

    const { from, to } = req.query;

    let query = db.collection("users").doc(uid).collection("expenses");

    if (from) {
      query = query.where("expenseDate", ">=", new Date(`${from}T00:00:00`));
    }
    if (to) {
      query = query.where("expenseDate", "<=", new Date(`${to}T23:59:59.999`));
    }

    const snap = await query.get();
    const expenses = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return res.status(200).json({ expenses });
  } catch (error) {
    console.error("Erreur GET /expenses :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la récupération des dépenses" });
  }
});

module.exports = router;
