export async function mount(container, ctx) {
  const { store, ui } = ctx;
  const { esc, money, num, icon } = ui;

  const CURRENCIES = ["USD", "CDF", "XOF", "XAF", "EUR", "GNF", "RWF", "NGN", "GHS", "KES", "UGX", "TZS", "MAD", "DZD", "TND"];

  let month = store.localMonth();
  const cache = new Map();           // "YYYY-MM" -> stats (évite de relire un mois déjà vu)
  let txs = [];
  let txCursor = null;
  let txLoading = false;
  let chart = null;
  let alive = true;
  let seq = 0;                       // ignore les réponses d'un mois qu'on a quitté

  container.innerHTML = shell();
  const $ = (s) => container.querySelector(s);

  /* ============================================================
     Utilitaires de mois
     ============================================================ */
  const shiftMonth = (m, delta) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    return store.localMonth(d);
  };
  const monthLabel = (m) => {
    const [y, mo] = m.split("-").map(Number);
    const s = new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const shortMonth = (m) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "short" });
  };
  const parse = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  const netOf = (s) => (s.profit || 0) + (s.income || 0) - (s.expenses || 0);

  async function statsFor(m) {
    if (cache.has(m)) return cache.get(m);
    const s = await store.getMonthStats(m);
    cache.set(m, s);
    return s;
  }

  /* ============================================================
     Structure
     ============================================================ */
  function shell() {
    return `
      <div class="page-head">
        <div>
          <h2 class="page-title">Finances</h2>
          <p class="page-sub">Ce qui entre, ce qui sort, ce qu'il vous reste</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" type="button" data-action="add-tx" id="fnAdd">
            ${icon("plus", 18)} Nouvelle opération
          </button>
        </div>
      </div>

      <div id="fnError"></div>

      <div class="row-between" style="margin-bottom:var(--space-4)">
        <button class="btn btn-secondary btn-icon" type="button" data-action="prev" aria-label="Mois précédent">‹</button>
        <h3 id="fnMonth" style="font-size:var(--fs-md)" aria-live="polite"></h3>
        <button class="btn btn-secondary btn-icon" type="button" data-action="next" id="fnNext" aria-label="Mois suivant">›</button>
      </div>

      <div class="grid grid-3 stagger" id="fnKpis"></div>

      <div class="split mt-5">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h3 class="card-title">6 derniers mois</h3></div>
            <div class="chart-box"><canvas id="fnChart" role="img" aria-label="Ventes, bénéfice et dépenses des 6 derniers mois"></canvas></div>
          </section>

          <section>
            <h3 class="section-title" style="margin-top:0">Dernières opérations</h3>
            <div id="fnTx"></div>
          </section>
        </div>

        <div class="stack">
          <section class="card" id="fnGoal"></section>
          <section class="card" id="fnSettings"></section>
        </div>
      </div>`;
  }

  /* ============================================================
     Chiffres du mois
     ============================================================ */
  function kpi(label, value, note, cls = "") {
    return `<div class="card kpi ${cls}">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value num">${esc(value)}</div>
      <div class="kpi-note">${esc(note)}</div></div>`;
  }

  function paintKpis(s) {
    const net = netOf(s);
    const margin = s.revenue > 0 ? Math.round((s.profit / s.revenue) * 100) : 0;
    $("#fnKpis").innerHTML = [
      kpi("Ventes", money(s.revenue), `${num(s.salesCount)} vente${s.salesCount > 1 ? "s" : ""}`),
      kpi("Bénéfice sur ventes", money(s.profit), s.revenue > 0 ? `Marge ${margin} %` : "Aucune vente", s.profit > 0 ? "is-profit" : s.profit < 0 ? "is-loss" : ""),
      kpi("Autres entrées", money(s.income), "Apports, prêts, divers"),
      kpi("Dépenses", money(s.expenses), "Loyer, transport, charges", s.expenses > 0 ? "is-warn" : ""),
      kpi("Résultat net", money(net), usdNote(net), net > 0 ? "is-profit" : net < 0 ? "is-loss" : ""),
      kpi("Panier moyen", money(s.salesCount > 0 ? s.revenue / s.salesCount : 0), "Par vente")
    ].join("");
    paintGoal(net);
  }

  function usdNote(net) {
    const cur = ctx.profile.currency || "USD";
    const rate = Number(ctx.profile.rate) || 0;
    if (cur === "USD" || rate <= 1) return "Bénéfice + entrées − dépenses";
    return `≈ ${money(net / rate, "USD")} · 1 USD = ${num(rate, 2)} ${cur}`;
  }

  function paintGoal(net) {
    const goal = Number(ctx.profile.savingsGoal) || 0;
    const host = $("#fnGoal");
    if (!goal) {
      host.innerHTML = `
        <h3 class="card-title" style="margin-bottom:var(--space-3)">Objectif d'épargne du mois</h3>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">Fixez un montant à mettre de côté chaque mois et suivez votre progression.</p>
        <button class="btn btn-secondary btn-sm" type="button" data-action="edit-settings" ${ctx.canWrite ? "" : "disabled"}>Définir un objectif</button>`;
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round((Math.max(net, 0) / goal) * 100)));
    host.innerHTML = `
      <h3 class="card-title" style="margin-bottom:var(--space-3)">Objectif d'épargne du mois</h3>
      <div class="row-between"><span class="num fw-6">${esc(money(Math.max(net, 0)))}</span><span class="text-muted text-sm">sur ${esc(money(goal))}</span></div>
      <div class="progress ${pct >= 100 ? "is-success" : ""}" style="margin:var(--space-3) 0" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${pct}%"></span>
      </div>
      <p class="text-sm ${pct >= 100 ? "text-profit" : "text-muted"}">${
        pct >= 100 ? "Objectif atteint, bravo !" : net <= 0 ? "Aucun résultat positif ce mois-ci pour le moment." : `${pct} % atteint · il manque ${esc(money(goal - net))}`}</p>`;
  }

  function paintSettings() {
    const cur = ctx.profile.currency || "USD";
    const rate = Number(ctx.profile.rate) || 1;
    $("#fnSettings").innerHTML = `
      <div class="card-head">
        <h3 class="card-title">Devise et taux de change</h3>
        <button class="btn btn-secondary btn-sm" type="button" data-action="edit-settings" ${ctx.canWrite ? "" : "disabled"}>Modifier</button>
      </div>
      <div class="stack" style="gap:var(--space-2)">
        <div class="row-between text-sm"><span class="text-muted">Devise d'affichage</span><span class="fw-6">${esc(cur)}</span></div>
        <div class="row-between text-sm"><span class="text-muted">1 USD =</span><span class="num fw-6">${esc(num(rate, 2))} ${esc(cur)}</span></div>
      </div>`;
  }

  /* ============================================================
     Graphique : 6 mois (6 lectures au plus, mises en cache)
     ============================================================ */
  async function paintChart(token) {
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
    const data = await Promise.all(months.map((m) => statsFor(m).catch(() => ({ revenue: 0, profit: 0, expenses: 0 }))));
    if (!alive || token !== seq) return;
    const canvas = $("#fnChart");
    if (!canvas) return;
    if (!window.Chart) { canvas.parentElement.innerHTML = '<p class="text-sm text-muted">Graphique indisponible.</p>'; return; }
    if (chart) chart.destroy();
    chart = new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: months.map(shortMonth),
        datasets: [
          { label: "Ventes", data: data.map((d) => d.revenue), backgroundColor: "#5B3FE0", borderRadius: 4, maxBarThickness: 30 },
          { label: "Bénéfice", data: data.map((d) => d.profit), backgroundColor: "#1E9E6B", borderRadius: 4, maxBarThickness: 30 },
          { label: "Dépenses", data: data.map((d) => d.expenses), backgroundColor: "#FF8A3D", borderRadius: 4, maxBarThickness: 30 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${money(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: "#EEEAF7" }, ticks: { font: { size: 11 }, maxTicksLimit: 5, callback: compact } }
        }
      }
    });
  }

  /* ============================================================
     Opérations
     ============================================================ */
  async function loadTx(first = false) {
    if (txLoading) return;
    txLoading = true;
    const btn = $("#fnMore");
    if (btn) ui.setBusy(btn, true);
    try {
      const page = await store.listTransactions({ after: first ? null : txCursor, pageSize: 30 });
      if (!alive) return;
      if (first) txs = [];
      const known = new Set(txs.map((t) => t.id));
      page.items.forEach((t) => { if (!known.has(t.id)) txs.push(t); });
      txCursor = page.cursor;
    } catch (e) {
      if (alive) ui.toast(e.message, "error");
    } finally {
      txLoading = false;
      if (alive) paintTx();
    }
  }

  function paintTx() {
    const host = $("#fnTx");
    if (!txs.length) {
      host.innerHTML = `<div class="card"><div class="empty">${icon("wallet", 44)}
        <div class="empty-title">Aucune opération</div>
        <p>Notez vos dépenses (loyer, transport, électricité) pour connaître votre vrai résultat.</p>
        ${ctx.canWrite ? '<button class="btn btn-primary" type="button" data-action="add-tx">Ajouter une opération</button>' : ""}</div></div>`;
      return;
    }
    host.innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Libellé</th><th>Date</th><th>Type</th><th class="right">Montant</th><th></th></tr></thead>
        <tbody>${txs.map((t) => `<tr>
          <td class="cell-title"><div class="cell-main">${esc(t.label)}</div></td>
          <td data-label="Date">${esc(fmtDay(t.day))}</td>
          <td data-label="Type">${t.type === "in" ? '<span class="badge badge-success">Entrée</span>' : '<span class="badge badge-warning">Dépense</span>'}</td>
          <td class="num ${t.type === "in" ? "text-profit" : "text-loss"}" data-label="Montant">${t.type === "in" ? "+" : "−"}${esc(money(t.amount))}</td>
          <td class="cell-actions"><button class="btn btn-ghost btn-icon btn-sm" type="button" data-action="del-tx" data-id="${esc(t.id)}" aria-label="Supprimer ${esc(t.label)}" ${ctx.canWrite ? "" : "disabled"}>${icon("trash", 18)}</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
      ${txCursor ? '<div class="mt-4" style="display:grid;justify-items:center"><button class="btn btn-secondary" type="button" id="fnMore" data-action="more-tx">Charger plus</button></div>' : ""}`;
  }

  function addTx() {
    if (!ctx.canWrite) { ui.toast("Abonnement expiré : renouvelez pour ajouter une opération.", "error"); return; }
    let type = "out";
    const api = ui.openModal({
      title: "Nouvelle opération",
      content: `
        <form class="form" novalidate onsubmit="return false">
          <div class="segmented" role="group" aria-label="Type d'opération" id="txType">
            <button type="button" data-type="out" aria-pressed="true">Dépense</button>
            <button type="button" data-type="in" aria-pressed="false">Entrée d'argent</button>
          </div>
          <div class="field"><label class="label" for="txLabel">Libellé</label>
            <input class="input" id="txLabel" maxlength="100" autocomplete="off" placeholder="Ex. Loyer boutique" /></div>
          <div class="field"><label class="label" for="txAmt">Montant</label>
            <input class="input" id="txAmt" inputmode="decimal" autocomplete="off" placeholder="0" /></div>
          <p class="hint">L'opération est enregistrée à la date d'aujourd'hui.</p>
        </form>`,
      actions: [
        { label: "Annuler", variant: "secondary" },
        {
          label: "Enregistrer", variant: "primary",
          onClick: async (a) => {
            const label = a.body.querySelector("#txLabel").value.trim();
            const amount = parse(a.body.querySelector("#txAmt").value);
            if (!label) { ui.toast("Donnez un libellé à l'opération.", "error"); return false; }
            if (!isFinite(amount) || amount <= 0) { ui.toast("Entrez un montant supérieur à zéro.", "error"); return false; }
            const r = await ui.writeOrQueue(store.addTransaction({ type, amount, label }));
            ui.toast(r?.queued ? "Enregistré hors ligne." : "Opération enregistrée.", "success");
            afterChange();
          }
        }
      ]
    });
    api.body.querySelector("#txType").addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]");
      if (!b) return;
      type = b.dataset.type;
      api.body.querySelectorAll("#txType button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
  }

  async function delTx(id) {
    const t = txs.find((x) => x.id === id);
    if (!t || !ctx.canWrite) return;
    const ok = await ui.confirmDialog({
      title: "Supprimer cette opération ?",
      message: `« ${t.label} » (${money(t.amount)}) sera retirée et les totaux corrigés.`,
      confirmLabel: "Supprimer", danger: true
    });
    if (!ok) return;
    try {
      const r = await ui.writeOrQueue(store.deleteTransaction(t));
      ui.toast(r?.queued ? "Suppression enregistrée hors ligne." : "Opération supprimée.", "success");
      txs = txs.filter((x) => x.id !== id);
      afterChange(false);
      paintTx();
    } catch (e) { ui.toast(e.message, "error"); }
  }

  /* ============================================================
     Réglages : objectif, devise, taux
     ============================================================ */
  function editSettings() {
    if (!ctx.canWrite) { ui.toast("Abonnement expiré : renouvelez pour modifier vos réglages.", "error"); return; }
    const cur = ctx.profile.currency || "USD";
    const list = CURRENCIES.includes(cur) ? CURRENCIES : [cur, ...CURRENCIES];
    ui.openModal({
      title: "Devise, taux et objectif",
      content: `
        <form class="form" novalidate onsubmit="return false">
          <div class="field"><label class="label" for="sCur">Devise d'affichage</label>
            <select class="select" id="sCur">${list.map((c) => `<option value="${esc(c)}"${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
            <span class="hint">Change l'affichage des montants. Vos données ne sont pas converties : saisissez vos prix dans cette devise.</span></div>
          <div class="field"><label class="label" for="sRate">Votre taux : 1 USD = ? <span id="sRateCur">${esc(cur)}</span></label>
            <input class="input" id="sRate" inputmode="decimal" autocomplete="off" value="${esc(String(Number(ctx.profile.rate) || 1))}" />
            <span class="hint">Sert à afficher l'équivalent en dollars de votre résultat.</span></div>
          <div class="field"><label class="label" for="sGoal">Objectif d'épargne par mois</label>
            <input class="input" id="sGoal" inputmode="decimal" autocomplete="off" value="${esc(String(Number(ctx.profile.savingsGoal) || ""))}" placeholder="0 = aucun" /></div>
        </form>`,
      actions: [
        { label: "Annuler", variant: "secondary" },
        {
          label: "Enregistrer", variant: "primary",
          onClick: async (a) => {
            const rate = parse(a.body.querySelector("#sRate").value || "1");
            const goal = parse(a.body.querySelector("#sGoal").value || "0");
            if (!isFinite(rate) || rate <= 0) { ui.toast("Taux invalide.", "error"); return false; }
            if (!isFinite(goal) || goal < 0) { ui.toast("Objectif invalide.", "error"); return false; }
            const currency = a.body.querySelector("#sCur").value;
            await ui.writeOrQueue(store.saveProfile({ currency, rate, savingsGoal: goal }));
            await ctx.refreshProfile();
            ui.toast("Réglages enregistrés.", "success");
            paintSettings();
            const s = cache.get(month);
            if (s) paintKpis(s);
          }
        }
      ]
    });
    const last = [...document.querySelectorAll(".modal-backdrop")].pop();
    last?.querySelector("#sCur")?.addEventListener("change", (e) => {
      const el = last.querySelector("#sRateCur"); if (el) el.textContent = e.target.value;
    });
  }

  /* ============================================================
     Navigation entre mois
     ============================================================ */
  async function showMonth() {
    const token = ++seq;
    const nowMonth = store.localMonth();
    $("#fnMonth").textContent = monthLabel(month);
    $("#fnNext").disabled = month >= nowMonth;
    try {
      const s = await statsFor(month);
      if (!alive || token !== seq) return;
      $("#fnError").innerHTML = "";
      paintKpis(s);
    } catch (e) {
      if (!alive || token !== seq) return;
      $("#fnError").innerHTML = `<div class="banner is-warning"><div class="banner-text">${esc(e.message || "Impossible de charger ce mois.")}</div>
        <button class="btn btn-secondary btn-sm" type="button" data-action="retry">Réessayer</button></div>`;
      return;
    }
    paintChart(token);
  }

  // Après une écriture : on invalide le cache et on relit le mois affiché (1 lecture)
  function afterChange(emit = true) {
    cache.clear();
    showMonth();
    if (emit) { ctx.emit("data-changed", { source: "finances" }); loadTx(true); }
  }

  /* ============================================================
     Événements
     ============================================================ */
  const stop = ui.delegate(container, {
    prev: () => { month = shiftMonth(month, -1); showMonth(); },
    next: () => { if (month < store.localMonth()) { month = shiftMonth(month, 1); showMonth(); } },
    "add-tx": addTx,
    "del-tx": (el) => delTx(el.dataset.id),
    "more-tx": () => loadTx(false),
    "edit-settings": editSettings,
    retry: showMonth
  });

  const offChange = ctx.on("data-changed", (d) => { if (d?.source !== "finances") { cache.clear(); showMonth(); } });
  const offSub = ctx.on("sub", () => { $("#fnAdd").disabled = !ctx.canWrite; paintSettings(); paintTx(); });

  $("#fnAdd").disabled = !ctx.canWrite;
  paintSettings();
  await Promise.all([showMonth(), loadTx(true)]);

  return () => { alive = false; if (chart) chart.destroy(); stop(); offChange(); offSub(); };
}

/* ---------- Utilitaires locaux ---------- */
function fmtDay(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  if (!y) return "";
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(".0", "") + " Md";
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(".0", "") + " M";
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(".0", "") + " k";
  return String(v);
}
