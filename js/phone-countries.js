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

/* --- Construit les <option> du <select> pays pour le paiement --- */
export function buildCountryOptionsHtml(selectedCode = DEFAULT_COUNTRY_CODE) {
  return COUNTRIES.map((country) => {
    const selected = country.code === selectedCode ? ' selected' : '';
    return `<option value="${country.code}"${selected}>${country.flag} ${country.name} (${country.dial})</option>`;
  }).join('');
}

/* --- Ne garde que les chiffres d'un numéro saisi (espaces, +, tirets, etc. retirés) --- */
export function cleanPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}
