/**
 * Contrôleur Webhook pour la réception des Pulses Chariow.
 */
const crypto = require("crypto");
const { db, CHARIOW_WEBHOOK_SECRET, CHARIOW_API_URL, CHARIOW_API_KEY, CHARIOW_PRODUCT_ID } = require("./config");

/**
 * Vérifie la signature HMAC-SHA256 envoyée par Chariow dans l'en-tête
 * "x-chariow-signature", calculée sur le corps BRUT de la requête.
 */
function isValidSignature(req) {
  if (!CHARIOW_WEBHOOK_SECRET) {
    console.error("CHARIOW_WEBHOOK_SECRET n'est pas configuré sur le serveur — webhook refusé.");
    return false;
  }

  if (!req.rawBody) {
    console.error("req.rawBody est absent — vérifie que bodyParser.json({ verify }) est bien configuré dans server.js.");
    return false;
  }

  const received = req.header("x-chariow-signature") || "";

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", CHARIOW_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest("hex");

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// CORRECTIF (15/09, confirmé via un Pulse test réel) : Chariow n'envoie
// JAMAIS "custom_metadata" (objet). Il envoie "custom_fields", un TABLEAU
// de paires { name, value }. Il faut chercher dedans par nom.
function getCustomField(fieldsArray, fieldName) {
  if (!Array.isArray(fieldsArray)) return null;
  const field = fieldsArray.find((f) => f && f.name === fieldName);
  return field ? field.value : null;
}

// ============================================================
// RÉCUPÉRATION DIRECTE DE LA LICENCE APRÈS UN ACHAT
// ============================================================
// Le payload de "successful.sale" ne contient JAMAIS la clé de licence ni
// sa date d'expiration (confirmé sur la doc Chariow : l'objet "sale" n'a
// pas de champ "license"). On va donc la chercher nous-mêmes, tout de
// suite, avec les identifiants qu'on a déjà (customer.id, product.id) —
// au lieu d'attendre un événement license.issued/license.activated qui,
// lui, n'a pas non plus de custom_fields et nous forcerait à deviner le
// compte par email.
//
// Ça élimine le besoin pour l'utilisateur de recopier sa clé à la main :
// le compte est actif et lié dès la confirmation du paiement.

async function fetchLatestLicenseForCustomer(customerId) {
  const url = `${CHARIOW_API_URL}/licenses?customer_id=${encodeURIComponent(customerId)}&product_id=${encodeURIComponent(CHARIOW_PRODUCT_ID)}&per_page=10`;

  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${CHARIOW_API_KEY}` }
  });

  if (!response.ok) {
    console.error(`Impossible de lister les licences du client ${customerId} : HTTP ${response.status}`);
    return null;
  }

  const body = await response.json();
  const licenses = (body.data && body.data.data) || body.data || [];

  if (!Array.isArray(licenses) || licenses.length === 0) {
    return null;
  }

  // La plus récente d'abord (au cas où l'ordre renvoyé par l'API ne serait
  // pas garanti trié).
  licenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return licenses[0];
}

async function activateLicenseForUser(licenseKey, firebaseUid) {
  const response = await fetch(
    `${CHARIOW_API_URL}/licenses/${encodeURIComponent(licenseKey)}/activate`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CHARIOW_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ device_identifier: firebaseUid })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    // "already active" (produit requires_activation=false) n'est pas une
    // erreur pour nous : la licence est de toute façon utilisable.
    console.warn(`Activation licence ${licenseKey} : HTTP ${response.status} — ${errorText}`);
    return null;
  }

  const result = await response.json();
  return result.data || null;
}

// Traite un paiement réussi : va chercher la licence fraîchement émise,
// l'active si besoin, et met à jour Firestore avec les VRAIES données
// Chariow (pas une date inventée à +30 jours).
async function handleSuccessfulSale(sale, customer, firebaseUid, userRef) {
  if (!customer.id) {
    console.error(`successful.sale pour ${firebaseUid} sans customer.id — impossible de retrouver la licence. Payload customer :`, JSON.stringify(customer));
    // On accorde quand même un accès provisoire COURT, pour ne pas bloquer
    // l'utilisateur qui vient de payer, mais on le flague pour investigation
    // plutôt que de lui donner silencieusement 30 jours sur une hypothèse.
    await userRef.set({
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      licenseKeyPending: true,
      updatedAt: new Date(),
    }, { merge: true });
    return;
  }

  const license = await fetchLatestLicenseForCustomer(customer.id);

  if (!license) {
    console.error(`Aucune licence trouvée chez Chariow pour customer ${customer.id} (uid ${firebaseUid}) juste après successful.sale.`);
    await userRef.set({
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      licenseKeyPending: true,
      updatedAt: new Date(),
    }, { merge: true });
    return;
  }

  let licenseData = license;

  // Active automatiquement si la licence attend son activation (mode
  // requires_activation=true). Si le produit est configuré en
  // requires_activation=false, la licence arrive déjà active et l'appel
  // renverra un 400 "already active" — sans conséquence, ignoré ci-dessus.
  if (!licenseData.is_active && licenseData.can_activate) {
    const activated = await activateLicenseForUser(licenseData.license.key, firebaseUid);
    if (activated) licenseData = activated;
  }

  await userRef.set({
    subscriptionStatus: "active",
    subscriptionExpiresAt: licenseData.expires_at ? new Date(licenseData.expires_at) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    chariowLicenseKey: licenseData.license.key,
    licenseKeyPending: false,
    updatedAt: new Date(),
  }, { merge: true });

  console.log(`Statut de ${firebaseUid} mis à jour : active (licence ${licenseData.license.key}, expire le ${licenseData.expires_at || "inconnu"}).`);
}

exports.chariowWebhook = async (req, res) => {
  try {
    if (!isValidSignature(req)) {
      console.warn("Webhook Chariow refusé : signature manquante ou invalide.");
      return res.status(401).json({ received: false, error: "unauthorized" });
    }

    const body = req.body || {};
    const eventType = body.event || "unknown_event";
    const normalizedEvent = eventType.toLowerCase();

    const sale = body.sale || {};
    const license = body.license || {};
    const customer = body.customer || {};

    console.log(`Webhook Chariow reçu. Événement : ${eventType}`);

    // CORRECTIF (15/09) : lecture de custom_fields (tableau), plus jamais
    // custom_metadata (objet, qui n'existe pas dans le vrai payload Chariow).
    let firebaseUid =
      getCustomField(sale.custom_fields, "firebase_uid") ||
      getCustomField(license.custom_fields, "firebase_uid") ||
      null;

    // Clé de licence : utile pour retrouver l'utilisateur sur les events
    // license.* UNE FOIS que handleSuccessfulSale (ci-dessus) a déjà
    // enregistré chariowLicenseKey sur le bon compte. C'est le seul
    // fallback fiable pour license.* — on n'utilise plus l'email sur ces
    // events (voir plus bas), car customer.email peut refléter le VRAI
    // client Chariow, qui n'est pas nécessairement le compte Firebase qui
    // a fait la démarche d'activation (cause avérée d'un incident réel :
    // un compte de test a été réactivé à la place d'un autre parce que
    // les deux comptes utilisaient/avaient utilisé la même adresse email).
    const licenseKeyForLookup = license.key || null;

    let userRef = null;

    if (firebaseUid) {
      userRef = db.collection("users").doc(firebaseUid);
    } else if (licenseKeyForLookup) {
      const snap = await db.collection("users").where("chariowLicenseKey", "==", licenseKeyForLookup).limit(1).get();
      if (!snap.empty) {
        userRef = snap.docs[0].ref;
        firebaseUid = snap.docs[0].id;
        console.log(`Utilisateur résolu par clé de licence : ${firebaseUid}`);
      }
    }

    // Fallback email : UNIQUEMENT pour les events de vente (sale.*), où
    // "customer" est authentiquement l'acheteur de CETTE vente précise.
    // Volontairement désactivé pour tout event license.* — voir commentaire
    // ci-dessus.
    if (!userRef && customer.email && !normalizedEvent.startsWith("license.")) {
      console.warn(`Aucun firebase_uid/clé de licence trouvé, tentative de résolution par email : ${customer.email}`);
      const snap = await db.collection("users").where("email", "==", customer.email).limit(1).get();
      if (!snap.empty) {
        userRef = snap.docs[0].ref;
        firebaseUid = snap.docs[0].id;
        console.log(`Utilisateur résolu par email : ${firebaseUid}`);
      }
    }

    if (!userRef) {
      console.warn("Aucun utilisateur trouvé (ni firebase_uid, ni clé de licence, ni email correspondant). Payload complet :", JSON.stringify(body));
      return res.status(200).json({ received: true, status: "skipped_no_user" });
    }

    if (normalizedEvent === "successful.sale") {
      // Chemin principal : on va chercher la licence nous-mêmes plutôt que
      // d'attendre/deviner via license.issued (voir handleSuccessfulSale).
      await handleSuccessfulSale(sale, customer, firebaseUid, userRef);

    } else if (normalizedEvent === "license.issued" || normalizedEvent === "license.activated") {
      // Ces events arrivent en parallèle de successful.sale (ordre non
      // garanti) et sont surtout redondants avec handleSuccessfulSale
      // ci-dessus. On ne les traite que si on a pu résoudre le compte via
      // chariowLicenseKey (donc handleSuccessfulSale a déjà tourné) : ils
      // servent alors de confirmation / rattrapage si le premier appel a
      // échoué, jamais de source de vérité autonome.
      if (license.key && license.expires_at) {
        await userRef.set({
          subscriptionStatus: "active",
          subscriptionExpiresAt: new Date(license.expires_at),
          chariowLicenseKey: license.key,
          licenseKeyPending: false,
          updatedAt: new Date(),
        }, { merge: true });
        console.log(`Statut de ${firebaseUid} confirmé actif via ${eventType} (licence ${license.key}).`);
      }

    } else if (normalizedEvent === "license.expired") {
      await userRef.set({ subscriptionStatus: "expired", updatedAt: new Date() }, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : expired`);

    } else if (normalizedEvent === "failed.sale" || normalizedEvent === "abandoned.sale") {
      // IMPORTANT : failed.sale / abandoned.sale signifient "cette tentative
      // de paiement a échoué", PAS "l'abonnement en cours est révoqué". Les
      // webhooks Chariow peuvent arriver dans le désordre (retries,
      // confirmation mobile money asynchrone) : on ne doit jamais écraser
      // un abonnement encore actif et non expiré à cause d'une tentative
      // ratée reçue en retard.
      const currentSnap = await userRef.get();
      const currentData = currentSnap.exists ? currentSnap.data() : {};
      const currentlyActive = currentData.subscriptionStatus === "active";
      const expiresAt = currentData.subscriptionExpiresAt?.toDate
        ? currentData.subscriptionExpiresAt.toDate()
        : currentData.subscriptionExpiresAt ? new Date(currentData.subscriptionExpiresAt) : null;
      const stillWithinPaidPeriod = expiresAt && expiresAt > new Date();

      if (currentlyActive && stillWithinPaidPeriod) {
        console.log(`${eventType} reçu pour ${firebaseUid} mais abonnement encore actif jusqu'au ${expiresAt.toISOString()} — statut inchangé (tentative ratée ignorée).`);
      } else {
        await userRef.set({ subscriptionStatus: "cancelled", updatedAt: new Date() }, { merge: true });
        console.log(`Statut de ${firebaseUid} mis à jour : cancelled`);
      }

    } else if (normalizedEvent === "license.revoked") {
      // Action explicite et volontaire (remboursement, fraude) : contrairement
      // à failed/abandoned, elle doit toujours s'appliquer.
      await userRef.set({ subscriptionStatus: "cancelled", updatedAt: new Date() }, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : cancelled (licence révoquée)`);

    } else {
      console.log(`Événement ${eventType} reçu mais non traité (pas d'action nécessaire) — ex. license.nearing_expiry.`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erreur traitement webhook:", error);
    return res.status(200).json({ received: true, error: error.message });
  }
};
