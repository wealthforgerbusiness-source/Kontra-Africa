import { $, h, clear, money, toast, setLoading } from '../ui.js';

const TZ_CURRENCY = { 'Africa/Kinshasa': 'CDF', 'Africa/Lubumbashi': 'CDF', 'Africa/Douala': 'XAF' };
const DEBT_PREFIX = 'Dette payée - ';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

/* ---------- Calculs (purs, sans écran) ---------- */

/* Bilan d'une journée.
   rep = { stats, sales, txs, truncated }
   - chiffre d'affaires, bénéfice, dépenses et entrées viennent des statistiques journalières (exactes) ;
   - le détail comptant / crédit et la caisse viennent des ventes et opérations du jour. */
export function computeDay(rep) {
  const st = (rep && rep.stats) || {};
  const sales = (rep && rep.sales) || [];
  const txs = (rep && rep.txs) || [];

  let cashTotal = 0;
  let cashCount = 0;
  let creditTotal = 0;
  let creditCount = 0;
  let creditDue = 0;
  let down = 0;
  let touchedCredit = 0;

  sales.forEach((s) => {
    if (s.status === 'cancelled') return;
    const total = Number(s.total) || 0;
    const paid = Number(s.paid) || 0;
    if (s.customerId) {
      creditCount += 1;
      creditTotal += total;
      creditDue += Math.max(0, total - paid);
      /* Une vente à crédit déjà modifiée (dette encaissée) a un « payé » qui contient aussi
         ces remboursements, déjà comptés dans les dettes encaissées : on ne les compte pas deux fois. */
      if (s.touched) touchedCredit += 1;
      else down += paid;
    } else {
      cashCount += 1;
      cashTotal += total;
    }
  });

  const income = r2(st.income);
  const expenses = r2(st.expenses);
  let debtCollected = 0;
  txs.forEach((t) => {
    if (t.type === 'in' && String(t.label || '').startsWith(DEBT_PREFIX)) debtCollected += Number(t.amount) || 0;
  });
  debtCollected = Math.min(r2(debtCollected), income);
  const otherIncome = r2(income - debtCollected);
  const salesCash = r2(cashTotal + down);
  const revenue = r2(st.revenue);
  const profit = r2(st.profit);

  return {
    revenue,
    profit,
    salesCount: Math.round(Number(st.salesCount) || 0),
    expenses,
    income,
    net: r2(profit - expenses),
    cashTotal: r2(cashTotal),
    cashCount,
    creditTotal: r2(creditTotal),
    creditCount,
    creditDue: r2(creditDue),
    down: r2(down),
    touchedCredit,
    debtCollected,
    otherIncome,
    salesCash,
    expected: r2(salesCash + income - expenses),
    partial: Boolean(rep && rep.truncated)
  };
}

/* Bilan d'un mois, à partir des statistiques de chaque jour. */
export function computeMonth(rep) {
  const days = (rep && rep.days) || [];
  const closings = (rep && rep.closings) || [];
  const closedMap = new Map(closings.map((c) => [c.day, c]));
  const tot = { revenue: 0, profit: 0, expenses: 0, income: 0, salesCount: 0 };
  const rows = days.map((d) => {
    const row = {
      day: d.day,
      revenue: r2(d.revenue),
      profit: r2(d.profit),
      expenses: r2(d.expenses),
      income: r2(d.income),
      salesCount: Math.round(Number(d.salesCount) || 0),
      closing: closedMap.get(d.day) || null
    };
    row.net = r2(row.profit - row.expenses);
    row.active = row.salesCount > 0 || row.expenses > 0 || row.income > 0 || row.revenue !== 0;
    tot.revenue += row.revenue;
    tot.profit += row.profit;
    tot.expenses += row.expenses;
    tot.income += row.income;
    tot.salesCount += row.salesCount;
    return row;
  });
  const active = rows.filter((r) => r.active);
  let best = null;
  active.forEach((r) => {
    if (!best || r.net > best.net) best = r;
  });
  const net = r2(tot.profit - tot.expenses);
  return {
    rows,
    revenue: r2(tot.revenue),
    profit: r2(tot.profit),
    expenses: r2(tot.expenses),
    income: r2(tot.income),
    salesCount: tot.salesCount,
    net,
    activeDays: active.length,
    closedDays: rows.filter((r) => r.closing).length,
    average: active.length ? r2(net / active.length) : 0,
    best
  };
}

/* ---------- Écran ---------- */

let ctx = null;
let tab = 'day';
let day = '';
let month = '';
let report = null;
let monthReport = null;
let editing = false;
let token = 0;
let fresh = true;
let draft = { day: '', counted: '', note: '' };

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

const todayId = () => ctx.store.dayId(new Date());
const monthOf = (id) => id.slice(0, 7);

function parseDay(id) {
  const [y, m, d] = id.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDay(id, delta) {
  const date = parseDay(id);
  date.setDate(date.getDate() + delta);
  return ctx.store.dayId(date);
}

function shiftMonth(id, delta) {
  const [y, m] = id.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1);
}

function dayLong(id) {
  return parseDay(id).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function dayShort(id) {
  return parseDay(id).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function monthLong(id) {
  const [y, m] = id.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function timeOf(msValue) {
  return new Date(msValue).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function signed(value, cur) {
  const v = r2(value);
  return (v > 0 ? '+ ' : v < 0 ? '− ' : '') + money(Math.abs(v), cur);
}

function row(title, sub, endText, cls) {
  return h(
    'div',
    { class: 'item', style: 'cursor:default' },
    h('div', { class: 'item-main' }, h('div', { class: 'item-title', style: 'white-space:normal', text: title }), sub ? h('div', { class: 'item-sub', style: 'white-space:normal', text: sub }) : null),
    h('div', { class: 'item-end' + (cls ? ' ' + cls : ''), text: endText })
  );
}

function stat(label, value, cls, sub) {
  return h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('small', { text: label }), h('strong', { text: value }), sub ? h('em', { style: 'font-style:normal;font-size:.8rem;color:var(--muted)', text: sub }) : null);
}

function panel(title, ...kids) {
  return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: title })), h('div', { class: 'list' }, ...kids));
}

function setTabs() {
  document.querySelectorAll('#closing-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
}

function renderLoading() {
  const box = $('#closing-body');
  clear(box);
  box.append(
    h('div', { class: 'stats', style: 'margin-top:1rem' }, h('div', { class: 'stat hero skeleton', style: 'min-height:96px' }), h('div', { class: 'stat skeleton', style: 'min-height:78px' }), h('div', { class: 'stat skeleton', style: 'min-height:78px' }))
  );
}

function renderError(err, retry) {
  const box = $('#closing-body');
  clear(box);
  box.append(
    h(
      'div',
      { class: 'empty' },
      h('h3', { text: 'Chargement impossible' }),
      h('p', { text: ctx.store.storeError(err) }),
      h('button', { type: 'button', class: 'btn btn-sm', text: 'Réessayer', onclick: retry })
    )
  );
}

function stepper(label, canNext, onPrev, onNext, extra) {
  return h(
    'div',
    { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap;margin:1rem 0 .25rem;gap:.5rem' },
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Précédent', text: '‹', onclick: onPrev }),
    h('div', { style: 'text-align:center;min-width:0' }, h('b', { style: 'display:block', text: label.charAt(0).toUpperCase() + label.slice(1) }), extra || null),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Suivant', text: '›', disabled: canNext ? false : true, onclick: onNext })
  );
}

function shareText(calc, frozen, closing, cur) {
  const profile = ctx.store.getProfile();
  const f = (v) => money(v, cur);
  const lines = ['*' + (profile.businessName || 'Ma boutique') + '*', 'Clôture du ' + dayLong(day), ''];
  lines.push('Ventes : ' + calc.salesCount + ' (' + f(calc.revenue) + ')');
  lines.push('Bénéfice sur les ventes : ' + f(calc.profit));
  lines.push('Dépenses : ' + f(calc.expenses));
  lines.push('*Bénéfice net : ' + f(calc.net) + '*');
  if (calc.creditCount) lines.push('', 'Ventes à crédit : ' + f(calc.creditTotal) + ' (reste à encaisser : ' + f(calc.creditDue) + ')');
  if (calc.debtCollected > 0) lines.push('Dettes encaissées : ' + f(calc.debtCollected));
  if (frozen && closing && closing.expected !== null) {
    lines.push('', 'Caisse attendue : ' + f(closing.expected));
    if (closing.counted !== null) lines.push('Caisse comptée : ' + f(closing.counted), 'Écart : ' + signed(closing.gap || 0, cur));
  }
  if (closing && closing.note) lines.push('', 'Remarque : ' + closing.note);
  return lines.join('\n');
}

function isStale(closing, calc) {
  return Boolean(closing) && (closing.salesCount !== calc.salesCount || r2(closing.revenue) !== calc.revenue || r2(closing.expenses) !== calc.expenses || r2(closing.income) !== calc.income);
}

async function submitClosing(calc, withCash, counted, note, button, errorBox, previous) {
  const cur = currency();
  const payload = {
    revenue: calc.revenue,
    profit: calc.profit,
    salesCount: calc.salesCount,
    expenses: calc.expenses,
    income: calc.income,
    creditDue: calc.creditDue,
    note
  };
  if (withCash) {
    payload.cashSales = calc.salesCash;
    payload.debtCollected = calc.debtCollected;
    payload.otherIncome = calc.otherIncome;
    payload.expected = calc.expected;
    if (counted !== null) {
      payload.counted = counted;
      payload.gap = r2(counted - calc.expected);
    }
  }
  if (!withCash && previous && previous.expected !== null) {
    /* Jour passé déjà clôturé avec sa caisse : on conserve la caisse figée à l'époque. */
    ['cashSales', 'debtCollected', 'otherIncome', 'expected', 'counted', 'gap'].forEach((k) => {
      if (previous[k] !== null && previous[k] !== undefined) payload[k] = previous[k];
    });
  }
  const ok = await ctx.confirm({
    title: 'Clôturer la journée ?',
    text: 'Le bilan du ' + dayLong(day) + ' sera enregistré : bénéfice net ' + money(calc.net, cur) + '. Vous pourrez le mettre à jour ensuite si besoin.',
    ok: 'Clôturer'
  });
  if (!ok) return;
  errorBox.classList.add('hide');
  setLoading(button, true);
  try {
    const saved = await ctx.store.saveClosing(day, payload);
    if (report && report.day === day) report.closing = saved;
    editing = false;
    draft = { day: '', counted: '', note: '' };
    toast('Journée clôturée.');
    renderDay();
  } catch (err) {
    errorBox.textContent = ctx.store.storeError(err);
    errorBox.classList.remove('hide');
  } finally {
    setLoading(button, false);
  }
}

function captureDraft() {
  const c = document.getElementById('closing-counted');
  const n = document.getElementById('closing-note');
  if (c || n) draft = { day, counted: c ? c.value : draft.counted, note: n ? n.value : draft.note };
}

function renderDay() {
  captureDraft();
  const box = $('#closing-body');
  clear(box);
  if (!report || report.day !== day) return;

  const cur = currency();
  const f = (v) => money(v, cur);
  const calc = computeDay(report);
  const closing = report.closing;
  const isToday = day === todayId();
  const canWrite = ctx.canWrite();
  const stale = isStale(closing, calc);
  const frozen = Boolean(closing) && closing.expected !== null;
  const showCash = (isToday && !calc.partial) || frozen;
  const cash = frozen
    ? { salesCash: closing.cashSales || 0, debtCollected: closing.debtCollected || 0, otherIncome: closing.otherIncome || 0, expenses: closing.expenses, expected: closing.expected }
    : { salesCash: calc.salesCash, debtCollected: calc.debtCollected, otherIncome: calc.otherIncome, expenses: calc.expenses, expected: calc.expected };
  const form = canWrite && (!closing || stale || editing);

  box.append(
    stepper(
      dayLong(day),
      day < todayId(),
      () => goDay(shiftDay(day, -1)),
      () => goDay(shiftDay(day, 1)),
      isToday ? null : h('button', { type: 'button', class: 'link-btn', style: 'font-size:.8rem', text: 'Revenir à aujourd’hui', onclick: () => goDay(todayId()) })
    )
  );

  if (closing) {
    box.append(h('div', { class: 'banner banner-ok', style: 'margin-top:.75rem' }, h('b', { text: 'Journée clôturée ' }), 'le ' + new Date(closing.closedAtMs).toLocaleDateString('fr-FR') + ' à ' + timeOf(closing.closedAtMs) + '.'));
    if (stale) box.append(h('div', { class: 'banner', style: 'margin-top:.5rem' }, 'Des opérations ont été enregistrées après la clôture. Mettez-la à jour pour que le bilan soit complet.'));
  } else if (!isToday) {
    box.append(h('div', { class: 'banner', style: 'margin-top:.75rem' }, 'Cette journée n’a pas été clôturée.'));
  }
  if (calc.partial) box.append(h('div', { class: 'banner', style: 'margin-top:.5rem' }, 'Cette journée contient beaucoup d’opérations : le détail de la caisse n’est pas calculé.'));
  if (!report.closingsAvailable && !closing) box.append(h('div', { class: 'banner', style: 'margin-top:.5rem' }, 'L’enregistrement de la clôture n’est pas encore activé sur votre compte. Le bilan reste consultable.'));

  const hero = h(
    'div',
    { class: 'stat hero' },
    h('small', { text: 'Bénéfice net ' + (isToday ? 'd’aujourd’hui' : 'de la journée') }),
    h('strong', { text: f(calc.net) }),
    h('em', { style: 'font-style:normal;font-size:.82rem;color:var(--gold)', text: 'Bénéfice sur ventes ' + f(calc.profit) + ' − dépenses ' + f(calc.expenses) })
  );
  box.append(
    h(
      'div',
      { class: 'stats', style: 'margin-top:1rem' },
      hero,
      stat('Ventes (chiffre d’affaires)', f(calc.revenue), 'gold', calc.salesCount + (calc.salesCount > 1 ? ' ventes' : ' vente')),
      stat('Dépenses', f(calc.expenses), calc.expenses > 0 ? 'warn' : ''),
      stat('Dont à crédit', f(calc.creditTotal), '', calc.creditCount + (calc.creditCount > 1 ? ' ventes' : ' vente')),
      stat('Reste à encaisser', f(calc.creditDue), calc.creditDue > 0 ? 'danger' : '', 'sur les ventes du jour')
    )
  );

  if (showCash) {
    const rows = [
      row('Ventes encaissées', 'Comptant + acomptes reçus', '+ ' + f(cash.salesCash), 'ok'),
      row('Dettes clients encaissées', null, '+ ' + f(cash.debtCollected), 'ok'),
      row('Autres entrées', null, '+ ' + f(cash.otherIncome), 'ok'),
      row('Dépenses', null, '− ' + f(cash.expenses), 'low'),
      h('div', { class: 'item', style: 'cursor:default;background:var(--bg-soft)' }, h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: 'Caisse attendue' })), h('div', { class: 'item-end', style: 'font-size:1.05rem', text: f(cash.expected) }))
    ];
    if (frozen && closing.counted !== null && !form) {
      const gap = closing.gap === null ? r2(closing.counted - closing.expected) : closing.gap;
      rows.push(row('Argent compté en caisse', null, f(closing.counted)));
      rows.push(row(gap === 0 ? 'Caisse juste' : gap > 0 ? 'Surplus' : 'Manque', null, gap === 0 ? '0' : signed(gap, cur), gap < 0 ? 'low' : gap > 0 ? 'ok' : ''));
    }
    box.append(panel('Argent en caisse', ...rows));
    if (isToday && !frozen && calc.touchedCredit > 0) {
      box.append(h('p', { class: 'muted', style: 'font-size:.82rem;margin:.5rem .25rem 0', text: 'Note : l’acompte d’une vente à crédit déjà remboursée aujourd’hui n’est pas compté ici. Vérifiez avec votre comptage.' }));
    }
  }

  if (calc.creditCount === 0 && calc.salesCount === 0 && calc.expenses === 0 && calc.income === 0) {
    box.append(h('p', { class: 'muted', style: 'margin:.75rem .25rem 0', text: 'Aucune opération enregistrée ce jour-là.' }));
  }

  if (form) {
    const withCash = isToday && !calc.partial;
    const mine = draft.day === day;
    const startCounted = mine ? draft.counted : closing && closing.counted !== null ? closing.counted : '';
    const counted = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', id: 'closing-counted', placeholder: 'Ex. ' + Math.max(0, Math.round(cash.expected)), value: startCounted });
    const gapLine = h('p', { class: 'muted', style: 'margin-top:.4rem;font-size:.9rem', role: 'status' });
    const note = h('textarea', { id: 'closing-note', maxlength: '300', rows: '2', placeholder: 'Ex. client à rappeler demain' });
    if (mine) note.value = draft.note;
    else if (closing && closing.note) note.value = closing.note;
    const error = h('p', { class: 'error hide', role: 'alert', style: 'margin-top:.5rem' });
    const button = h('button', { type: 'button', class: 'btn btn-block btn-lg', text: closing ? 'Mettre à jour la clôture' : 'Clôturer la journée' });

    const readCounted = () => {
      const raw = String(counted.value || '').trim();
      if (!raw) return null;
      const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? r2(n) : NaN;
    };
    const updateGap = () => {
      const v = readCounted();
      if (v === null) {
        gapLine.textContent = '';
        return;
      }
      if (Number.isNaN(v)) {
        gapLine.textContent = 'Montant invalide.';
        return;
      }
      const gap = r2(v - calc.expected);
      gapLine.textContent = gap === 0 ? 'Caisse juste.' : gap > 0 ? 'Surplus de ' + f(gap) + ' par rapport à la caisse attendue.' : 'Manque de ' + f(Math.abs(gap)) + ' par rapport à la caisse attendue.';
    };
    counted.addEventListener('input', updateGap);
    updateGap();

    button.addEventListener('click', () => {
      const v = readCounted();
      if (Number.isNaN(v)) {
        error.textContent = 'Le montant compté en caisse est invalide.';
        error.classList.remove('hide');
        return;
      }
      submitClosing(calc, withCash, v, String(note.value || '').trim(), button, error, closing);
    });

    const fields = [];
    if (withCash && isToday) {
      fields.push(h('label', { class: 'field' }, h('span', { text: 'Argent compté en caisse (facultatif)' }), counted, gapLine));
    }
    fields.push(h('label', { class: 'field', style: 'margin-top:1rem' }, h('span', { text: 'Remarque (facultatif)' }), note));
    box.append(h('div', { class: 'panel', style: 'padding:1rem' }, ...fields, error, h('div', { style: 'margin-top:1.1rem' }, button)));
  } else if (closing && canWrite) {
    box.append(h('div', { style: 'margin-top:1rem' }, h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Modifier la clôture', onclick: () => { editing = true; renderDay(); } })));
  } else if (!canWrite && !closing) {
    box.append(h('div', { class: 'banner banner-danger', style: 'margin-top:1rem' }, 'Votre accès est suspendu : vous pouvez consulter le bilan, mais plus clôturer. Choisissez une offre pour continuer.'));
  }

  if (closing && closing.note && !form) {
    box.append(h('p', { class: 'muted', style: 'margin:.75rem .25rem 0;font-size:.9rem', text: 'Remarque : ' + closing.note }));
  }

  box.append(
    h(
      'div',
      { style: 'margin-top:1rem' },
      h('a', { class: 'btn btn-gold btn-block', href: 'https://wa.me/?text=' + encodeURIComponent(shareText(calc, frozen, closing, cur)), target: '_blank', rel: 'noopener', text: 'Envoyer le bilan sur WhatsApp' })
    )
  );
}

function renderMonth() {
  const box = $('#closing-body');
  clear(box);
  if (!monthReport || monthReport.month !== month) return;

  const cur = currency();
  const f = (v) => money(v, cur);
  const calc = computeMonth(monthReport);
  const thisMonth = monthOf(todayId());

  box.append(
    stepper(
      monthLong(month),
      month < thisMonth,
      () => goMonth(shiftMonth(month, -1)),
      () => goMonth(shiftMonth(month, 1)),
      month === thisMonth ? null : h('button', { type: 'button', class: 'link-btn', style: 'font-size:.8rem', text: 'Revenir à ce mois-ci', onclick: () => goMonth(thisMonth) })
    )
  );

  if (!calc.rows.length) {
    box.append(h('div', { class: 'empty' }, h('h3', { text: 'Aucune activité ce mois-là' }), h('p', { text: 'Les ventes et dépenses de ce mois apparaîtront ici.' })));
    return;
  }

  box.append(
    h(
      'div',
      { class: 'stats', style: 'margin-top:1rem' },
      h('div', { class: 'stat hero' }, h('small', { text: 'Bénéfice net du mois' }), h('strong', { text: f(calc.net) }), h('em', { style: 'font-style:normal;font-size:.82rem;color:var(--gold)', text: 'Bénéfice sur ventes ' + f(calc.profit) + ' − dépenses ' + f(calc.expenses) })),
      stat('Ventes (chiffre d’affaires)', f(calc.revenue), 'gold', calc.salesCount + (calc.salesCount > 1 ? ' ventes' : ' vente')),
      stat('Dépenses', f(calc.expenses), calc.expenses > 0 ? 'warn' : ''),
      stat('Moyenne par jour', f(calc.average), '', 'sur ' + calc.activeDays + (calc.activeDays > 1 ? ' jours d’activité' : ' jour d’activité')),
      stat('Meilleur jour', calc.best ? f(calc.best.net) : '—', '', calc.best ? dayShort(calc.best.day) : '')
    )
  );

  const items = calc.rows.map((r) =>
    h(
      'button',
      { type: 'button', class: 'item', onclick: () => goDay(r.day, true) },
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', style: 'text-transform:capitalize', text: dayShort(r.day) }), h('div', { class: 'item-sub', text: r.salesCount + (r.salesCount > 1 ? ' ventes' : ' vente') + ' · ' + f(r.revenue) + (r.expenses > 0 ? ' · dép. ' + f(r.expenses) : '') })),
      h('div', { class: 'item-end ' + (r.net < 0 ? 'low' : r.net > 0 ? 'ok' : ''), text: signed(r.net, cur) }, r.closing ? h('small', { text: 'Clôturée' }) : null)
    )
  );
  box.append(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Jour par jour' }), h('span', { class: 'muted', style: 'font-size:.82rem', text: calc.closedDays + ' / ' + calc.rows.length + ' clôturées' })), h('div', { class: 'list' }, ...items)));
}

async function loadDay(silent) {
  const mine = ++token;
  if (!silent) renderLoading();
  try {
    const rep = await ctx.store.loadDayReport(day);
    if (mine !== token) return;
    report = rep;
    renderDay();
  } catch (err) {
    if (mine === token && !silent) renderError(err, () => loadDay());
  }
}

async function loadMonth(silent) {
  const mine = ++token;
  if (!silent) renderLoading();
  try {
    const rep = await ctx.store.loadMonthReport(month);
    if (mine !== token) return;
    monthReport = rep;
    renderMonth();
  } catch (err) {
    if (mine === token && !silent) renderError(err, () => loadMonth());
  }
}

function goDay(id, fromMonth) {
  if (!DAY_RE.test(id)) return;
  day = id > todayId() ? todayId() : id;
  tab = 'day';
  editing = false;
  report = null;
  draft = { day: '', counted: '', note: '' };
  setTabs();
  loadDay();
  if (fromMonth) window.scrollTo(0, 0);
}

function goMonth(id) {
  month = id;
  tab = 'month';
  monthReport = null;
  setTabs();
  loadMonth();
}

export function init(context) {
  ctx = context;
  const section = document.getElementById('view-closing');
  if (section && !section.dataset.watched && typeof MutationObserver !== 'undefined') {
    section.dataset.watched = '1';
    /* Quand l'utilisateur quitte l'écran, le prochain affichage repart d'aujourd'hui. */
    new MutationObserver(() => {
      if (!section.classList.contains('active')) fresh = true;
    }).observe(section, { attributes: true, attributeFilter: ['class'] });
  }
  const tabs = $('#closing-tabs');
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = '1';
    tabs.addEventListener('click', (event) => {
      const b = event.target.closest('button[data-tab]');
      if (!b || b.dataset.tab === tab) return;
      if (b.dataset.tab === 'month') goMonth(monthOf(day || todayId()));
      else goDay(day || todayId());
    });
  }
}

export async function show(_name, context) {
  ctx = context || ctx;
  try {
    await ctx.store.loadProfile();
  } catch (_e) {
    /* le bilan reste affichable sans le profil */
  }
  if (fresh || !day) {
    fresh = false;
    goDay(todayId());
    return;
  }
  /* Simple actualisation (compte rafraîchi) : on garde le jour, l'onglet et ce qui est saisi. */
  if (tab === 'month') loadMonth(true);
  else loadDay(true);
}

export function hide() {
  token += 1;
}
