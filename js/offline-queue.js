// js/offline-queue.js
// File d'attente IndexedDB pour les actions hors ligne.
// Les actions restent en attente tant qu'elles ne sont pas confirmées
// comme synchronisées avec succès.

const DB_NAME = "kontra-offline";
const DB_VERSION = 1;
const STORE_NAME = "pendingActions";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "localId",
        });

        store.createIndex("by_type", "type");
        store.createIndex("by_createdAtLocal", "createdAtLocal");
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onclose = () => {
        dbPromise = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn(
        "IndexedDB est bloquée par un autre onglet."
      );
    };
  });

  return dbPromise;
}

function generateLocalId() {
  if (window.crypto?.randomUUID) {
    return `local_${window.crypto.randomUUID()}`;
  }

  return `local_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
}

/**
 * Ajoute une action dans la file d'attente.
 */
export async function addPendingAction(type, payload) {
  if (!type) {
    throw new Error("Type d'action manquant.");
  }

  const db = await openDb();

  const entry = {
    localId: generateLocalId(),
    type,
    payload,
    createdAtLocal: new Date().toISOString(),
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const request = store.add(entry);

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(tx.error);
    };

    tx.onabort = () => {
      reject(tx.error || new Error("Transaction IndexedDB annulée."));
    };
  });

  return entry;
}

/**
 * Retourne les actions en attente.
 *
 * Si type est fourni, seules les actions de ce type sont retournées.
 */
export async function getPendingActions(type = null) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const request = type
      ? store.index("by_type").getAll(type)
      : store.getAll();

    request.onsuccess = () => {
      const actions = request.result || [];

      // Toujours respecter l'ordre chronologique.
      actions.sort((a, b) => {
        return String(a.createdAtLocal).localeCompare(
          String(b.createdAtLocal)
        );
      });

      resolve(actions);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Supprime une action après synchronisation réussie.
 */
export async function removePendingAction(localId) {
  if (!localId) return;

  const db = await openDb();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");

    tx.objectStore(STORE_NAME).delete(localId);

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(tx.error);
    };

    tx.onabort = () => {
      reject(tx.error || new Error("Suppression IndexedDB annulée."));
    };
  });
}

/**
 * Retourne le nombre d'actions en attente.
 */
export async function getPendingCount(type = null) {
  const actions = await getPendingActions(type);
  return actions.length;
}

/**
 * Synchronise les actions d'un type.
 *
 * Important :
 * - Une action est supprimée UNIQUEMENT si syncFn réussit.
 * - Une erreur HTTP/serveur reste visible dans la console.
 * - On arrête la file à la première erreur afin de conserver l'ordre.
 */
export async function syncPendingActions(type, syncFn) {
  if (typeof syncFn !== "function") {
    throw new Error(
      `syncFn manquante pour le type "${type}".`
    );
  }

  const pending = await getPendingActions(type);

  if (!pending.length) {
    return {
      type,
      total: 0,
      synced: 0,
      remaining: 0,
      failed: false,
    };
  }

  let synced = 0;
  let failed = false;
  let lastError = null;

  for (const entry of pending) {
    try {
      console.log(
        `[Offline] Synchronisation ${type} :`,
        entry.localId,
        entry.payload
      );

      const result = await syncFn(entry.payload, entry);

      // L'action n'est supprimée qu'après succès.
      await removePendingAction(entry.localId);

      synced++;

      console.log(
        `[Offline] Synchronisation réussie : ${entry.localId}`
      );

      // Petit délai pour éviter de bombarder immédiatement le serveur
      // lorsqu'il y a beaucoup d'actions en attente.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // result est volontairement ignoré ici :
      // le module appelant peut l'utiliser dans syncFn.
      void result;
    } catch (error) {
      failed = true;
      lastError = error;

      console.error(
        `[Offline] Synchronisation échouée : ${entry.localId}`,
        error
      );

      // On ne supprime surtout PAS l'action.
      // Elle sera retentée lorsque le problème sera corrigé.
      break;
    }
  }

  const remainingActions = await getPendingActions(type);

  return {
    type,
    total: pending.length,
    synced,
    remaining: remainingActions.length,
    failed,
    error: lastError,
  };
}

/**
 * Permet de vérifier rapidement le contenu de la file depuis la console.
 *
 * Exemple :
 *   await debugPendingActions()
 */
export async function debugPendingActions() {
  const actions = await getPendingActions();

  console.table(
    actions.map((action) => ({
      localId: action.localId,
      type: action.type,
      createdAtLocal: action.createdAtLocal,
      payload: JSON.stringify(action.payload),
    }))
  );

  return actions;
}
