const $ = (id) => document.getElementById(id);

const cart = $('cart');
const pos = document.querySelector('#view-sale .pos');
const search = $('pos-search');
const totalEl = $('cart-total');
const calc = $('calc');

if (cart && pos && search && totalEl && calc) {
  const RATE_KEY = 'kontra_rate_usd_fc';
  const received = $('calc-received');
  const rcvCur = $('calc-rcv-cur');
  const retCur = $('calc-ret-cur');
  const rateIn = $('calc-rate');
  const result = $('calc-result');

  try { rateIn.value = localStorage.getItem(RATE_KEY) || ''; } catch (e) { /* stockage indisponible */ }

  const parse = (s) => {
    const n = parseFloat(String(s || '').replace(/[\s\u00A0\u202F]/g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = (n, cur) => cur === 'USD'
    ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' $'
    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' FC';

  const row = (label, value, cls) => {
    const d = document.createElement('div');
    d.className = 'row' + (cls ? ' ' + cls : '');
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('b'); b.textContent = value;
    d.append(a, b);
    return d;
  };

  const isCredit = () => {
    const on = document.querySelector('#pay-mode [aria-pressed="true"]');
    return !!on && on.dataset.mode === 'credit';
  };

  function update() {
    calc.classList.toggle('hide', isCredit());
    result.textContent = '';
    const text = totalEl.textContent || '';
    const total = parse(text);
    if (!total) return;
    const baseCur = /\$|USD/i.test(text) ? 'USD' : 'FC';
    const rate = parse(rateIn.value);
    const needRate = baseCur === 'USD' || rcvCur.value === 'USD' || retCur.value === 'USD';

    const frag = document.createDocumentFragment();
    frag.append(row('Total à payer', fmt(total, baseCur)));

    if (needRate && !rate) {
      const w = document.createElement('div');
      w.className = 'warn-line';
      w.textContent = 'Entrez le taux de change (1 USD = … FC).';
      frag.append(w);
      result.append(frag);
      return;
    }

    const toFC = (amt, cur) => (cur === 'USD' ? amt * rate : amt);
    const fromFC = (amt, cur) => (cur === 'USD' ? amt / rate : amt);

    const rcv = parse(received.value);
    if (!rcv) { result.append(frag); return; }

    const totalFC = toFC(total, baseCur);
    const rcvFC = toFC(rcv, rcvCur.value);
    const diffFC = rcvFC - totalFC;

    frag.append(row('Reçu', fmt(rcv, rcvCur.value)));

    const big = document.createElement('div');
    const out = retCur.value;
    const other = out === 'FC' ? 'USD' : 'FC';
    if (Math.abs(diffFC) < 0.005) {
      big.className = 'row big';
      big.append(Object.assign(document.createElement('span'), { textContent: 'Compte juste' }));
      frag.append(big);
    } else {
      const abs = Math.abs(diffFC);
      big.className = 'row big' + (diffFC < 0 ? ' miss' : '');
      big.append(
        Object.assign(document.createElement('span'), { textContent: diffFC < 0 ? 'Il manque' : 'À rendre' }),
        Object.assign(document.createElement('b'), { textContent: fmt(fromFC(abs, out), out) })
      );
      frag.append(big);
      if (rate) {
        const alt = document.createElement('div');
        alt.className = 'alt';
        alt.textContent = '≈ ' + fmt(fromFC(abs, other), other);
        frag.append(alt);
      }
    }
    result.append(frag);
  }

  received.addEventListener('input', update);
  rcvCur.addEventListener('change', update);
  retCur.addEventListener('change', update);
  rateIn.addEventListener('input', () => {
    try { localStorage.setItem(RATE_KEY, rateIn.value); } catch (e) { /* ignore */ }
    update();
  });
  $('calc-exact').addEventListener('click', () => {
    const text = totalEl.textContent || '';
    const baseCur = /\$|USD/i.test(text) ? 'USD' : 'FC';
    rcvCur.value = baseCur;
    received.value = String(parse(text));
    update();
  });

  // Recalcul quand le total ou le mode de paiement change
  new MutationObserver(update).observe(totalEl, { childList: true, characterData: true, subtree: true });
  const pay = $('pay-mode');
  if (pay) new MutationObserver(update).observe(pay, { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });

  // Recherche : on replie le panier en barre compacte, il revient quand la recherche est vide
  const syncSearch = () => {
    const searching = document.activeElement === search || search.value.trim() !== '';
    pos.classList.toggle('searching', searching);
  };
  search.addEventListener('focus', syncSearch);
  search.addEventListener('blur', () => setTimeout(syncSearch, 0));
  search.addEventListener('input', syncSearch);

  // Ouverture automatique au premier produit ajouté ; remise à zéro quand le panier se vide
  let wasEmpty = cart.classList.contains('is-empty');
  new MutationObserver(() => {
    const empty = cart.classList.contains('is-empty');
    if (wasEmpty && !empty && !pos.classList.contains('searching')) {
      cart.classList.add('open');
      const t = $('cart-toggle');
      if (t) t.setAttribute('aria-expanded', 'true');
    }
    if (!wasEmpty && empty) {
      received.value = '';
      result.textContent = '';
    }
    wasEmpty = empty;
  }).observe(cart, { attributes: true, attributeFilter: ['class'] });

  update();
}
