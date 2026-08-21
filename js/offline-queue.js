// js/offline-queue.js
// File d'attente IndexedDB générique pour les actions créées hors ligne.
// Réutilisable par n'importe quel module (Finances aujourd'hui, d'autres
// demain) : chaque action en attente est stockée avec un `localId`, un
// `storeName` logique (ex: "transactions"), un `payload`, et une date locale.
//
// Ce module ne connaît rien de Firestore : c'est au module appelant
// (ex: js/finances.js) de fournir la fonction qui "rejoue" une action en
// attente vers Firestore.

const DB_NAME = 'kontra-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pendingActions';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'localId' });
        store.createIndex('by_type', 'type');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function generateLocalId() {
  if (window.crypto?.randomUUID) return `local_${window.crypto.randomUUID()}`;
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Ajoute une action en attente de synchronisation.
 * @param {string} type - identifiant logique du type d'action (ex: "transaction")
 * @param {object} payload - données nécessaires pour rejouer l'action
 * @returns {Promise<object>} l'entrée créée, incluant localId et createdAtLocal
 */
export async function addPendingAction(type, payload) {
  const db = await openDb();
  const entry = {
    localId: generateLocalId(),
    type,
    payload,
    createdAtLocal: new Date().toISOString(),
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return entry;
}

/**
 * Retourne toutes les actions en attente, optionnellement filtrées par type.
 */
export async function getPendingActions(type) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result || [];
      resolve(type ? all.filter((e) => e.type === type) : all);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Supprime une action une fois synchronisée avec succès.
 */
export async function removePendingAction(localId) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Tente de synchroniser toutes les actions en attente d'un type donné.
 * `syncFn(payload)` doit renvoyer une Promise qui résout si l'action a bien
 * été rejouée côté serveur/Firestore, ou qui rejette sinon (l'action reste
 * alors en attente pour une tentative future).
 */
export async function syncPendingActions(type, syncFn) {
  const pending = await getPendingActions(type);
  for (const entry of pending) {
    try {
      await syncFn(entry.payload, entry);
      await removePendingAction(entry.localId);
    } catch (err) {
      console.warn('Synchro échouée pour', entry.localId, err);
      // On arrête ici pour respecter l'ordre chronologique des opérations
      // (ex: transactions financières) ; on réessaiera au prochain retour en ligne.
      break;
    }
  }
}
