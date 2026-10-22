import { $, $$, h, clear, money, toast, setLoading, debounce } from '../ui.js';

const PAGE = 100;
const TZ_CURRENCY = { 'Africa/Kinshasa': 'CDF', 'Africa/Lubumbashi': 'CDF', 'Africa/Douala': 'XAF' };

let ctx = null;
let active = false;
let token = 0;
let filter = 'all';
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

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function qtyText(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
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

function filtered() {
  const s = ctx.store;
  let list = s.getProducts();
  if (filter === 'low') list = list.filter((p) => p.isLow && p.qty > 0);
  else if (filter === 'out') list = list.filter((p) => p.qty <= 0);
  if (term) {
    const t = norm(term);
    list = list.filter((p) => norm(p.name).includes(t) || norm(p.sku).includes(t));
  }
  return list;
}

function renderCount() {
  const u = ctx.store.usage().products;
  const total = ctx.store.getProducts().length;
  $('#stock-count').textContent = total
    ? total + (total > 1 ? ' produits' : ' produit') + (u.max ? ' · limite ' + u.max.toLocaleString('fr-FR') : '')
    : 'Aucun produit pour le moment';
}

function renderList() {
  const box = $('#stock-list');
  clear(box);
  renderCount();
  const all = ctx.store.getProducts();
  const cur = currency();

  if (!all.length) {
    box.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'icon-box gold', text: 'S' }),
        h('h3', { text: 'Votre stock est vide' }),
        h('p', { text: 'Ajoutez vos produits avec leur prix et leur quantité. Chaque vente mettra le stock à jour.' }),
        h('button', { type: 'button', class: 'btn', 'data-action': 'add-product', text: 'Ajouter mon premier produit' })
      )
    );
    return;
  }

  const list = filtered();
  if (!list.length) {
    box.append(h('div', { class: 'empty' }, h('h3', { text: 'Aucun résultat' }), h('p', { text: 'Essayez un autre nom ou un autre filtre.' })));
    return;
  }

  list.slice(0, shown).forEach((p) => {
    const out = p.qty <= 0;
    const low = p.isLow && !out;
    box.append(
      h(
        'button',
        { type: 'button', class: 'item' + (out ? ' sold-out' : ''), onclick: () => openDetail(p.id) },
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title', text: p.name }),
          h('div', { class: 'item-sub', text: 'Vente ' + money(p.sellPrice, cur) + (p.sku ? ' · ' + p.sku : '') })
        ),
        h('div', { class: 'item-end' + (out || low ? ' low' : ''), text: out ? 'Épuisé' : qtyText(p.qty) }, h('small', { text: out ? 'à réapprovisionner' : low ? 'stock bas' : 'en stock' }))
      )
    );
  });

  if (list.length > shown) {
    box.append(
      h('div', { style: 'padding:1rem' }, h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Afficher plus (' + (list.length - shown) + ')', onclick: () => { shown += PAGE; renderList(); } }))
    );
  }
}

function openForm(product) {
  const editing = Boolean(product);
  const u = ctx.store.usage().products;
  const p = product || { name: '', sku: '', buyPrice: '', sellPrice: '', qty: '', alertAt: 5 };

  const form = h(
    'form',
    { novalidate: true },
    field('Nom du produit', 'pf-n', { maxlength: 80, autocomplete: 'off' }, p.name),
    h(
      'div',
      { class: 'form-grid two' },
      field('Prix d’achat', 'pf-b', { inputmode: 'decimal' }, p.buyPrice, 'Ce que vous payez au fournisseur'),
      field('Prix de vente', 'pf-s', { inputmode: 'decimal' }, p.sellPrice, 'Ce que paie le client')
    ),
    h(
      'div',
      { class: 'form-grid two' },
      field(editing ? 'Quantité en stock' : 'Quantité de départ', 'pf-q', { inputmode: 'decimal' }, p.qty),
      field('Alerte quand il reste', 'pf-a', { inputmode: 'decimal' }, p.alertAt, 'Vous serez prévenu sous ce seuil')
    ),
    field('Référence (facultatif)', 'pf-k', { maxlength: 40 }, p.sku),
    h('p', { class: 'error hide', id: 'pf-error', role: 'alert' }),
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onclick: () => ctx.closeSheet() }),
      h('button', { type: 'submit', class: 'btn', id: 'pf-save', text: editing ? 'Enregistrer' : 'Ajouter le produit' })
    )
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#pf-save');
    const error = $('#pf-error');
    error.classList.add('hide');
    const input = {
      name: $('#pf-n').value,
      buyPrice: $('#pf-b').value || 0,
      sellPrice: $('#pf-s').value,
      qty: $('#pf-q').value || 0,
      alertAt: $('#pf-a').value || 0,
      sku: $('#pf-k').value
    };
    setLoading(button, true);
    try {
      if (editing) await ctx.store.updateProduct(product.id, input);
      else await ctx.store.addProduct(input);
      ctx.closeSheet();
      toast(editing ? 'Produit modifié.' : 'Produit ajouté.');
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
    h('h3', { text: editing ? 'Modifier le produit' : 'Nouveau produit' }),
    !editing && u.max ? h('p', { class: 'muted', style: 'margin:.25rem 0 1rem;font-size:.85rem', text: u.used + ' / ' + u.max.toLocaleString('fr-FR') + ' produits utilisés' }) : h('div', { style: 'height:1rem' }),
    form
  ]);
  setTimeout(() => $('#pf-n') && $('#pf-n').focus({ preventScroll: true }), 80);
}

function kv(label, value) {
  return h('div', { class: 'kv' }, h('small', { text: label }), h('b', { text: value }));
}

function openDetail(productId) {
  const s = ctx.store;
  const p = s.findProduct(productId);
  if (!p) return;
  const cur = currency();
  const writable = ctx.canWrite();
  const unit = p.sellPrice - p.buyPrice;

  const body = [
    h('h3', { text: p.name }),
    h(
      'div',
      { class: 'panel', style: 'margin:1rem 0 0' },
      kv('En stock', p.qty <= 0 ? 'Épuisé' : qtyText(p.qty) + (p.isLow ? ' · stock bas' : '')),
      kv('Prix d’achat', money(p.buyPrice, cur)),
      kv('Prix de vente', money(p.sellPrice, cur)),
      kv('Bénéfice par unité', money(unit, cur)),
      kv('Déjà vendu', qtyText(p.soldQty)),
      p.sku ? kv('Référence', p.sku) : null
    )
  ];

  if (writable) {
    const qtyInput = h('input', { id: 'rs-q', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Quantité reçue' });
    const add = h('button', { type: 'button', class: 'btn', id: 'rs-go', text: 'Ajouter' });
    add.addEventListener('click', async () => {
      setLoading(add, true);
      try {
        await s.restock(p.id, qtyInput.value);
        ctx.closeSheet();
        toast('Stock mis à jour.');
      } catch (err) {
        fail(err);
      } finally {
        setLoading(add, false);
      }
    });
    body.push(
      h('div', { class: 'field', style: 'margin-top:1.25rem' }, h('span', { text: 'Réapprovisionner' }), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1' }, qtyInput), add)),
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'Modifier', onclick: () => openForm(p) }),
        h('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: 'Supprimer',
          onclick: async () => {
            const ok = await ctx.confirm({ title: 'Supprimer ce produit ?', text: p.name + ' sera retiré du stock. Vos ventes passées ne changent pas.', ok: 'Supprimer', danger: true });
            if (!ok) return;
            try {
              await s.removeProduct(p.id);
              ctx.closeSheet();
              toast('Produit supprimé.');
            } catch (err) {
              fail(err);
            }
          }
        })
      )
    );
  } else {
    body.push(h('div', { class: 'banner banner-danger', style: 'margin-top:1rem', text: 'Accès suspendu : vous pouvez consulter le stock mais pas le modifier.' }), h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', text: 'Choisir une offre', onclick: () => { ctx.closeSheet(); ctx.openPaywall(); } })));
  }

  ctx.openSheet(body);
}

function wire() {
  if (wired) return;
  wired = true;
  $('#stock-search').addEventListener(
    'input',
    debounce((event) => {
      term = event.target.value.trim();
      shown = PAGE;
      renderList();
    }, 200)
  );
  $('#stock-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    shown = PAGE;
    $$('#stock-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    renderList();
  });
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
    await Promise.all([ctx.store.loadProducts(), ctx.store.loadStats()]);
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
  if (name !== 'add-product') return;
  try {
    await ctx.store.loadProducts();
  } catch (err) {
    toast(ctx.store.storeError(err), 'error');
    return;
  }
  openForm(null);
}
