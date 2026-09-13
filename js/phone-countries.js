/* ==========================================================================
   Kontra-Africa — Pays & indicatifs pour le paiement Mobile Money
   Utilisé par auth-guard.js (paywall) et profil.js (réabonnement).
   ========================================================================== */

// Pays actuellement pris en charge (mêmes marchés que la page d'accueil).
// `code` = code pays ISO envoyé tel quel au backend (`phone.countryCode`).
export const COUNTRIES = [
  { code: 'CD', name: 'RD Congo', dial: '+243', flag: '🇨🇩' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '+225', flag: '🇨🇮' },
  { code: 'CM', name: 'Cameroun', dial: '+237', flag: '🇨🇲' },
  { code: 'SN', name: 'Sénégal', dial: '+221', flag: '🇸🇳' },
  { code: 'TG', name: 'Togo', dial: '+228', flag: '🇹🇬' },
  { code: 'BJ', name: 'Bénin', dial: '+229', flag: '🇧🇯' },
  { code: 'BF', name: 'Burkina Faso', dial: '+226', flag: '🇧🇫' },
  { code: 'ML', name: 'Mali', dial: '+223', flag: '🇲🇱' },
  { code: 'GA', name: 'Gabon', dial: '+241', flag: '🇬🇦' },
  { code: 'CG', name: 'Congo-Brazzaville', dial: '+242', flag: '🇨🇬' },
];

const DEFAULT_COUNTRY_CODE = 'CD';

/* --- Construit les <option> du <select> pays pour le paiement ------------
   Le nom du pays seul est affiché dans l'option (le drapeau + nom) : c'est
   plus lisible qu'un texte du type "RD Congo (+243)" collé dans la liste.
   L'indicatif (+243, +225, ...) est stocké dans data-dial sur chaque option
   et affiché séparément, en préfixe fixe, à côté du champ de saisie du
   numéro (voir updateDialPrefix() dans auth-guard.js). --------------------- */
export function buildCountryOptionsHtml(selectedCode = DEFAULT_COUNTRY_CODE) {
  return COUNTRIES.map((country) => {
    const selected = country.code === selectedCode ? ' selected' : '';
    return `<option value="${country.code}"${selected} data-dial="${country.dial}">${country.flag} ${country.name}</option>`;
  }).join('');
}

/* --- Retourne l'indicatif téléphonique (+243, +225, ...) pour un code pays --- */
export function getDialCode(countryCode) {
  const country = COUNTRIES.find((c) => c.code === countryCode);
  return country ? country.dial : '';
}

export { DEFAULT_COUNTRY_CODE };

/* --- Ne garde que les chiffres d'un numéro saisi (espaces, +, tirets, etc. retirés) --- */
export function cleanPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}
