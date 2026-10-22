import { $, h, clear, money, toast, setLoading, debounce } from '../ui.js';

const PAGE = 100;
const TZ_CURRENCY = { 'Africa/Kinshasa': 'CDF', 'Africa/Lubumbashi': 'CDF', 'Africa/Douala': 'XAF' };
const TZ_COUNTRY = {
  'Africa/Kinshasa': 'CD',
  'Africa/Lubumbashi': 'CD',
  'Africa/Abidjan': 'CI',
  'Africa/Dakar': 'SN',
  'Africa/Lome': 'TG',
  'Africa/Porto-Novo': 'BJ',
  'Africa/Ouagadougou': 'BF',
  'Africa/Bamako': 'ML',
  'Africa/Douala': 'CM'
};
const DIAL = { BJ: '229', BF: '226', CM: '237', CI: '225', ML: '223', CD: '243', SN: '221', TG: '228' };
const KEEP_ZERO = new Set(['CI', 'BJ']);

let ctx = null;
let active = false;
let token = 0;
let term = '';
let shown = PAGE;
let wired = false;

function currency() {
  const profile = ctx.store.getProfile();
  if (profile.currency) return profile.currency;
  const sub = ctx.subscription();
  if (sub && sub.currency) return sub.currency;
  try {
    return TZ_CURRENCY[Intl.DateTimeFormat().resolvedOptions().timeZone] || 'XOF';
  } catch (_e) {
    return 'XOF';
  }
}

function countryCode() {
  const sub = ctx.subscription();
  if (sub && DIAL[sub.country]) return sub.country;
  try {
    const saved = localStorage.getItem('kontra_country');
    if (saved && DIAL[saved]) return saved;
  } catch (_e) {
    /* stockage indisponible */
  }
  try {
    return TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone] || '';
  } catch (_e) {
    return '';
  }
}

function waNumber(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  const code = countryCode();
  const dial = DIAL[code];
  if (!dial) return '';
  if (digits.startsWith(dial) && digits.length >= dial.length + 8) return digits;
  const local = KEEP_ZERO.has(code) ? digits : digits.replace(/^0+/, '');
  return local.length >= 8 ? dial + local : '';
}

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

function isLimit(err) {
  return Boolean(err) && typeof err.code === 'string' && err.code.startsWith('limit_');
}

function fail(err) {
  toast(ctx.store.storeError(err), 'error', 5000);
  if (isLimit(err)) {
    ctx.closeSheet();
    ctx.openPaywall();
  }
}

function field(label, id, attrs, value, hint) {
  const input = h('input', Object.assign({ id, type: 'text', autocomplete: 'off' }, attrs || {}));
  if (value !== undefined && value !== null && value !== '') input.value = String(value);
  return h('label', { class: 'field' }, h('span', { text: label }), input, hint ? h('small', { class: 'hint', text: hint }) : null);
}

function kv(label, value) {
  return h('div', { class: 'kv' }, h('small', { text: label }), h('b', { text: value }));
}

function sorted() {
  const list = ctx.store.getCustomers().slice();
  list.sort((a, b) => {
    if ((b.debt > 0) !== (a.debt > 0)) return b.debt > 0 ? 1 : -1;
    if (a.debt !== b.debt) return b.debt - a.debt;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });
  return list;
}

function filtered() {
  const list = sorted();
  if (!term) return list;
  const t = norm(term);
  return list.filter((c) => norm(c.name).includes(t) || norm(c.phone).includes(t));
}

function renderStats() {
  const s = ctx.store;
  const cur = currency();
  const total = s.totalDebt();
  const count = s.debtors().length;
  const r = s.usage().reminders;
  const customers = s.getCustomers().length;
  const u = s.usage().customers;

  $('#debts-count').textContent = customers
    ? customers + (customers > 1 ? ' clients' : ' client') + (u.max ? ' · limite ' + u.max.toLocaleString('fr-FR') : '')
    : 'Aucun client pour le moment';

  const box = $('#debts-stats');
  clear(box);
  box.append(
    h('div', { class: 'stat' + (total > 0 ? ' danger' : '') }, h('small', { text: 'Total des dettes' }), h('strong', { text: money(total, cur) })),
    h('div', { class: 'stat gold' }, h('small', { text: 'Clients qui doivent' }), h('strong', { text: String(count) })),
    h('div', { class: 'stat' }, h('small', { text: 'Relances ce mois-ci' }), h('strong', { text: r.used.toLocaleString('fr-FR') + (r.max ? ' / ' + r.max.toLocaleString('fr-FR') : '') }))
  );
}

function renderList() {
  renderStats();
  const box = $('#debts-list');
  clear(box);
  const cur = currency();
  const all = ctx.store.getCustomers();

  if (!all.length) {
    box.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'icon-box gold', text: 'D' }),
        h('h3', { text: 'Aucun client enregistré' }),
        h('p', { text: 'Ajoutez vos clients à crédit pour suivre qui vous doit combien, et les relancer en un clic.' }),
        h('button', { type: 'button', class: 'btn', 'data-action': 'add-customer', text: 'Ajouter un client' })
      )
    );
    return;
  }

  const list = filtered();
  if (!list.length) {
    box.append(h('div', { class: 'empty' }, h('h3', { text: 'Aucun résultat' }), h('p', { text: 'Essayez un autre nom ou numéro.' })));
    return;
  }

  list.slice(0, shown).forEach((c) => {
    box.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => openDetail(c.id) },
        h('span', { class: 'avatar', text: initials(c.name), 'aria-hidden': 'true' }),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: c.name }), h('div', { class: 'item-sub', text: c.phone || 'Pas de téléphone' })),
        c.debt > 0
          ? h('div', { class: 'item-end low', text: money(c.debt, cur) }, h('small', { text: 'à encaisser' }))
          : h('div', { class: 'item-end ok', text: 'À jour' })
      )
    );
  });

  if (list.length > shown) {
    box.append(
      h('div', { style: 'padding:1rem' }, h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Afficher plus (' + (list.length - shown) + ')', onclick: () => { shown += PAGE; renderList(); } }))
    );
  }
}

function openForm(customer) {
  const editing = Boolean(customer);
  const u = ctx.store.usage().customers;
  const c = customer || { name: '', phone: '' };

  const form = h(
    'form',
    { novalidate: true },
    field('Nom du client', 'cf-n', { maxlength: 80 }, c.name),
    field('Téléphone', 'cf-p', { maxlength: 24, inputmode: 'tel', autocomplete: 'off' }, c.phone, 'Pour envoyer les relances par WhatsApp ou SMS'),
    h('p', { class: 'error hide', id: 'cf-error', role: 'alert' }),
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onclick: () => ctx.closeSheet() }),
      h('button', { type: 'submit', class: 'btn', id: 'cf-save', text: editing ? 'Enregistrer' : 'Ajouter le client' })
    )
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#cf-save');
    const error = $('#cf-error');
    error.classList.add('hide');
    const input = { name: $('#cf-n').value, phone: $('#cf-p').value };
    setLoading(button, true);
    try {
      if (editing) await ctx.store.updateCustomer(customer.id, input);
      else await ctx.store.addCustomer(input);
      ctx.closeSheet();
      toast(editing ? 'Client modifié.' : 'Client ajouté.');
    } catch (err) {
      if (isLimit(err)) fail(err);
      else {
        error.textContent = ctx.store.storeError(err);
        error.classList.remove('hide');
      }
    } finally {
      setLoading(button, false);
    }
  });

  ctx.openSheet([
    h('h3', { text: editing ? 'Modifier le client' : 'Nouveau client' }),
    !editing && u.max
      ? h('p', { class: 'muted', style: 'margin:.25rem 0 1rem;font-size:.85rem', text: u.used + ' / ' + u.max.toLocaleString('fr-FR') + ' clients utilisés' })
      : h('div', { style: 'height:1rem' }),
    form
  ]);
  setTimeout(() => $('#cf-n') && $('#cf-n').focus({ preventScroll: true }), 80);
}

function reminderText(customer) {
  const profile = ctx.store.getProfile();
  const shop = profile.businessName || 'votre boutique';
  return (
    'Bonjour ' +
    customer.name +
    ', ici ' +
    shop +
    '. Petit rappel : il vous reste ' +
    money(customer.debt, currency()) +
    ' à régler chez nous. Vous pouvez payer en espèces ou par Mobile Money quand cela vous arrange. Merci beaucoup !'
  );
}

function countReminder(customer, event) {
  const r = ctx.store.usage().reminders;
  if (r.max > 0 && r.used >= r.max) {
    event.preventDefault();
    toast('Limite de relances du mois atteinte pour votre offre.', 'warn');
    ctx.closeSheet();
    ctx.openPaywall();
    return;
  }
  ctx.store.addReminder(customer.id).catch((err) => toast(ctx.store.storeError(err), 'error', 5000));
}

function reminderButtons(customer) {
  const number = waNumber(customer.phone);
  if (!number) {
    return [
      h('p', { class: 'muted', style: 'font-size:.88rem', text: customer.phone ? 'Ce numéro semble incomplet : modifiez la fiche pour pouvoir envoyer une relance.' : 'Ajoutez un numéro de téléphone pour envoyer des relances.' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Modifier la fiche', onclick: () => openForm(customer) })
    ];
  }
  const body = encodeURIComponent(reminderText(customer));
  const r = ctx.store.usage().reminders;
  return [
    h('a', { class: 'btn btn-gold btn-block', href: 'https://wa.me/' + number + '?text=' + body, target: '_blank', rel: 'noopener', text: 'Relancer sur WhatsApp', onclick: (event) => countReminder(customer, event) }),
    h('a', { class: 'btn btn-ghost btn-block', href: 'sms:+' + number + '?&body=' + body, text: 'Relancer par SMS', onclick: (event) => countReminder(customer, event) }),
    r.max ? h('p', { class: 'muted', style: 'font-size:.82rem;text-align:center', text: 'Relances ce mois-ci : ' + r.used + ' / ' + r.max.toLocaleString('fr-FR') }) : null
  ];
}

function openDetail(customerId) {
  const s = ctx.store;
  const c = s.findCustomer(customerId);
  if (!c) return;
  const cur = currency();
  const writable = ctx.canWrite();

  const body = [
    h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:.75rem' }, h('span', { class: 'avatar', text: initials(c.name), 'aria-hidden': 'true' }), h('h3', { text: c.name })),
    h('div', { class: 'panel', style: 'margin:1rem 0 0' }, kv('Téléphone', c.phone || 'Non renseigné'), kv('Dette actuelle', c.debt > 0 ? money(c.debt, cur) : 'Aucune dette'))
  ];

  if (!writable) {
    body.push(
      h('div', { class: 'banner banner-danger', style: 'margin-top:1rem', text: 'Accès suspendu : vous pouvez consulter vos clients mais pas les modifier.' }),
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', text: 'Choisir une offre', onclick: () => { ctx.closeSheet(); ctx.openPaywall(); } }))
    );
    ctx.openSheet(body);
    return;
  }

  if (c.debt > 0) {
    const amount = h('input', { id: 'dc-a', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Montant reçu' });
    amount.value = String(c.debt);
    const go = h('button', { type: 'button', class: 'btn', text: 'Encaisser' });
    go.addEventListener('click', async () => {
      setLoading(go, true);
      try {
        const result = await s.collectDebt(c.id, amount.value);
        ctx.closeSheet();
        toast('Encaissé : ' + money(result.amount, cur) + (result.remaining > 0 ? ' · reste ' + money(result.remaining, cur) : ' · dette soldée'), 'ok', 5000);
      } catch (err) {
        fail(err);
      } finally {
        setLoading(go, false);
      }
    });
    body.push(
      h('div', { class: 'field', style: 'margin-top:1.25rem' }, h('span', { text: 'Encaisser un paiement' }), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1' }, amount), go)),
      h('div', { class: 'stack', style: '--gap:.6rem;margin-top:.5rem' }, ...reminderButtons(c))
    );
  }

  body.push(
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Modifier', onclick: () => openForm(c) }),
      h('button', {
        type: 'button',
        class: 'btn btn-danger',
        text: 'Supprimer',
        onclick: async () => {
          const ok = await ctx.confirm({
            title: 'Supprimer ce client ?',
            text: c.debt > 0 ? c.name + ' doit encore ' + money(c.debt, cur) + '. Cette dette ne sera plus suivie. Les ventes passées restent dans l’historique.' : c.name + ' sera retiré de votre carnet. Les ventes passées restent dans l’historique.',
            ok: 'Supprimer',
            danger: true
          });
          if (!ok) return;
          try {
            await s.removeCustomer(c.id);
            ctx.closeSheet();
            toast('Client supprimé.');
          } catch (err) {
            fail(err);
          }
        }
      })
    )
  );

  ctx.openSheet(body);
}

function wire() {
  if (wired) return;
  wired = true;
  $('#debts-search').addEventListener(
    'input',
    debounce((event) => {
      term = event.target.value.trim();
      shown = PAGE;
      renderList();
    }, 200)
  );
}

export function init(context) {
  ctx = context;
  wire();
  ctx.store.subscribe(() => {
    if (active) renderList();
  });
}

export async function show(_name, context) {
  ctx = context || ctx;
  active = true;
  const mine = ++token;
  renderList();
  try {
    await Promise.all([ctx.store.loadCustomers(), ctx.store.loadStats()]);
  } catch (err) {
    if (mine === token) toast(ctx.store.storeError(err), 'error', 5000);
    return;
  }
  if (mine === token) renderList();
}

export function hide() {
  active = false;
}

export async function action(name, context) {
  ctx = context || ctx;
  if (name !== 'add-customer') return;
  try {
    await Promise.all([ctx.store.loadCustomers(), ctx.store.loadStats()]);
  } catch (err) {
    toast(ctx.store.storeError(err), 'error');
    return;
  }
  openForm(null);
}
