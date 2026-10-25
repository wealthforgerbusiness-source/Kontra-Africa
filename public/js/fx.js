import { h, clear, money, setLoading, toast } from './ui.js';

const K_MODE = 'kontra_fx_mode';
const SYMBOL = { XOF: 'FCFA', XAF: 'FCFA', CDF: 'FC' };
const listeners = new Set();

function read() {
  try {
    return localStorage.getItem(K_MODE) === 'usd' ? 'usd' : 'local';
  } catch (_e) {
    return 'local';
  }
}

let mode = read();

export const symbol = (cur) => SYMBOL[String(cur || '').toUpperCase()] || String(cur || '');

export function rateOf(profile) {
  const r = Number(profile && profile.rate);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

export function fxMode() {
  return mode;
}

export function setFxMode(next) {
  mode = next === 'usd' ? 'usd' : 'local';
  try {
    localStorage.setItem(K_MODE, mode);
  } catch (_e) {
    /* préférence non sauvegardée */
  }
  listeners.forEach((cb) => cb());
}

export function onFxChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function fxActive(profile) {
  return mode === 'usd' && rateOf(profile) > 0;
}

export function fxMoney(amount, cur, profile) {
  if (fxActive(profile)) return money(Number(amount) / rateOf(profile), 'USD');
  return money(amount, cur);
}

function openRateSheet(ctx, cur, switchAfter) {
  const profile = ctx.store.getProfile();
  const sym = symbol(cur);
  const current = rateOf(profile);

  const input = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: 'Ex. 2250', value: current || '' });
  const error = h('p', { class: 'error hide', role: 'alert', style: 'margin-top:.5rem' });
  const save = h('button', { type: 'button', class: 'btn btn-block btn-lg', text: 'Enregistrer le taux' });
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Annuler', onclick: () => ctx.closeSheet() });

  save.addEventListener('click', async () => {
    const value = Number(String(input.value).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      error.textContent = 'Entrez un taux supérieur à 0.';
      error.classList.remove('hide');
      return;
    }
    error.classList.add('hide');
    setLoading(save, true);
    try {
      await ctx.store.saveProfile({ rate: value });
      if (switchAfter) setFxMode('usd');
      ctx.closeSheet();
      toast('Taux enregistré.');
    } catch (err) {
      error.textContent = ctx.store.storeError(err);
      error.classList.remove('hide');
    } finally {
      setLoading(save, false);
    }
  });

  ctx.openSheet([
    h('h3', { text: 'Taux de change' }),
    h('p', { class: 'muted', style: 'margin:.25rem 0 1rem;font-size:.9rem', text: 'Combien de ' + sym + ' valent 1 dollar aujourd’hui ? Vous pouvez le modifier à tout moment.' }),
    h('label', { class: 'field' }, h('span', { text: '1 $ = … ' + sym }), input),
    error,
    h('div', { class: 'stack', style: '--gap:.6rem;margin-top:1.25rem' }, save, cancel)
  ]);
  setTimeout(() => input.focus({ preventScroll: true }), 80);
}

export function renderFxBar(box, ctx, cur) {
  if (!box) return;
  clear(box);
  const profile = ctx.store.getProfile();
  const rate = rateOf(profile);
  const sym = symbol(cur);
  const usd = mode === 'usd' && rate > 0;

  const seg = (label, on, onclick, aria) =>
    h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), 'aria-label': aria, onclick, text: label });

  const group = h(
    'div',
    { class: 'fx-seg', role: 'group', 'aria-label': 'Monnaie d’affichage' },
    seg(sym, !usd, () => setFxMode('local'), 'Afficher en ' + sym),
    seg('$', usd, () => (rate > 0 ? setFxMode('usd') : openRateSheet(ctx, cur, true)), 'Afficher en dollars')
  );

  const info = h('button', {
    type: 'button',
    class: 'fx-rate',
    onclick: () => openRateSheet(ctx, cur, false),
    text: rate > 0 ? '1 $ = ' + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(rate) + ' ' + sym + ' · Modifier' : 'Définir le taux de change'
  });

  box.append(h('div', { class: 'fx-bar' }, group, info));
}
