/* ==========================================================================
   Kontra-Africa — Pays & indicatifs pour le paiement Mobile Money
   Utilisé par auth-guard.js (paywall) et profil.js (réabonnement).
   ========================================================================== */

// Pays actuellement pris en charge (mêmes marchés que la page d'accueil).
// `code` = code pays ISO envoyé tel quel au backend (`phone.countryCode`).
// Gabon (GA) et Congo-Brazzaville (CG) retirés : pas de réseau mobile money
// actif chez SasPay pour ces deux pays (voir docs.saspay.me/api-reference/
// reference/formats) — seule la carte bancaire y fonctionnerait.
export const COUNTRIES = [
  { code: 'CD', name: 'RD Congo', dial: '+243', flag: '🇨🇩', flagImage: 'rdc.png' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '+225', flag: '🇨🇮', flagImage: 'cote-ivoire.png' },
  { code: 'CM', name: 'Cameroun', dial: '+237', flag: '🇨🇲', flagImage: 'cameroun.png' },
  { code: 'SN', name: 'Sénégal', dial: '+221', flag: '🇸🇳', flagImage: 'senegal.png' },
  { code: 'TG', name: 'Togo', dial: '+228', flag: '🇹🇬', flagImage: 'togo.png' },
  { code: 'BJ', name: 'Bénin', dial: '+229', flag: '🇧🇯', flagImage: 'benin.png' },
  { code: 'BF', name: 'Burkina Faso', dial: '+226', flag: '🇧🇫', flagImage: 'burkina-faso.png' },
  { code: 'ML', name: 'Mali', dial: '+223', flag: '🇲🇱', flagImage: 'mali.png' },
];

const DEFAULT_COUNTRY_CODE = 'CD';

/* --- Construit les <option> du <select> pays pour le paiement ------------
   Texte = nom du pays uniquement (pas d'emoji drapeau ici : sur certains
   téléphones/navigateurs l'emoji drapeau ne s'affiche pas et retombe sur
   les 2 lettres du code pays, ex. "CD" au lieu du drapeau congolais). Le
   vrai drapeau (image PNG, /assets/flags/...) est affiché séparément à
   côté du sélecteur, voir updateSelectedCountry() dans auth-guard.js.
   L'indicatif (+243, +225, ...) est stocké dans data-dial sur chaque
   option et le fichier image dans data-flag. --------------------------- */
export function buildCountryOptionsHtml(selectedCode = DEFAULT_COUNTRY_CODE) {
  return COUNTRIES.map((country) => {
    const selected = country.code === selectedCode ? ' selected' : '';
    return `<option value="${country.code}"${selected} data-dial="${country.dial}" data-flag="${country.flagImage}">${country.name}</option>`;
  }).join('');
}

/* --- Retourne l'indicatif téléphonique (+243, +225, ...) pour un code pays --- */
export function getDialCode(countryCode) {
  const country = COUNTRIES.find((c) => c.code === countryCode);
  return country ? country.dial : '';
}

/* --- Retourne le chemin de l'image du drapeau pour un code pays --- */
export function getFlagImage(countryCode) {
  const country = COUNTRIES.find((c) => c.code === countryCode);
  return country ? `/assets/flags/${country.flagImage}` : '';
}

export { DEFAULT_COUNTRY_CODE };

/* --- Ne garde que les chiffres d'un numéro saisi (espaces, +, tirets, etc. retirés) --- */
export function cleanPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}
