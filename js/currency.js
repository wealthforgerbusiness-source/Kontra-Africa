// js/currency.js
// Module de gestion des devises (extrait de la logique auparavant dupliquée
// et non exportée dans js/finances.js). Toutes les fonctions reçoivent
// désormais `userData` explicitement en paramètre plutôt que de dépendre
// d'une variable globale.
//
// userData attendu : { currencySymbol, exchangeRate, ... } (doc Firestore users/{uid})

/**
 * Parse un montant saisi par l'utilisateur (accepte virgule ou point).
 * @param {string|number} rawValue
 * @returns {number} montant numérique, ou NaN si invalide
 */
export function parseAmount(rawValue) {
  if (typeof rawValue !== 'string') return Number(rawValue) || 0;
  const normalized = rawValue.trim().replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  return isNaN(value) ? NaN : value;
}

/**
 * Convertit un montant depuis la devise choisie vers la devise locale.
 * @param {number} amount
 * @param {'usd'|'local'} chosenCurrency
 * @param {object} userData
 * @returns {number} montant en devise locale
 */
export function convertToLocal(amount, chosenCurrency, userData) {
  if (chosenCurrency === 'usd') return amount * Number(userData.exchangeRate || 0);
  return amount;
}

/**
 * Convertit un montant depuis la devise locale vers la devise cible.
 * @param {number} amountLocal
 * @param {'usd'|'local'} targetCurrency
 * @param {object} userData
 * @returns {number} montant dans la devise cible
 */
export function convertFromLocal(amountLocal, targetCurrency, userData) {
  if (targetCurrency === 'usd') {
    const rate = Number(userData.exchangeRate || 0);
    return rate > 0 ? amountLocal / rate : 0;
  }
  return amountLocal;
}

/**
 * Formate un montant (stocké en devise locale) pour l'affichage,
 * dans la devise de visualisation demandée.
 * @param {number} amountLocal
 * @param {object} userData
 * @param {'local'|'usd'} [viewCurrency='local']
 * @returns {string} montant formaté avec symbole
 */
export function formatAmount(amountLocal, userData, viewCurrency = 'local') {
  const displayed = convertFromLocal(amountLocal, viewCurrency, userData);
  if (viewCurrency === 'usd') {
    return `$ ${Number(displayed || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
  }
  const symbol = userData.currencySymbol || '';
  const formatted = Number(displayed || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Retourne le symbole de devise locale configuré pour l'utilisateur.
 * @param {object} userData
 * @returns {string}
 */
export function getCurrencySymbol(userData) {
  return userData.currencySymbol || '';
}
