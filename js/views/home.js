// js/views/home.js — écran Accueil
// Coût Firestore : 2 requêtes (stats du mois + 7 jours) + 1 requête (5 dernières ventes).
// Les alertes de stock viennent du cache mémoire de store.js : 0 lecture.

export async function mount(container, ctx) {
  const { store, ui } = ctx;
  const { esc, money, num, icon } = ui;
  let chart = null;
  let alive = true;

  container.innerHTML = shell();

  /* ---------- Données ---------- */
  async function load() {
    try {
      const [summary, recent] = await Promise.all([
        store.getHomeSummary(),
        store.listSales({ pageSize: 5 })
      ]);
      if (!alive) return;
      paintKpis(summary);
      paintChart(summary.days);
      paintRecent(recent.sales);
    } catch (e) {
      if (!alive) return;
      container.querySelector("#homeKpis").innerHTML = "";
      container.querySelector("#homeError").innerHTML = `
        <div class="banner is-warning">
          <div class="banner-text">${esc(e.message || "Impossible de charger les chiffres.")}</div>
          <button class="btn btn-secondary btn-sm" type="button" data-action="retry">Réessayer</button>
        </div>`;
    }
    paintLowStock();
    paintOnboarding();
  }

  /* ---------- Rendu ---------- */
  function shell() {
    const name = ctx.profile.businessName || "Mon commerce";
    return `
      <div class="page-head">
        <div>
          <h2 class="page-title">${esc(name)}</h2>
          <p class="page-sub">${esc(todayLabel())}</p>
        </div>
        <div class="page-actions hide-mobile">
          <button class="btn btn-primary" type="button" data-action="new-sale" ${ctx.canWrite ? "" : "disabled"}>
            ${icon("plus", 18)} Nouvelle vente
          </button>
        </div>
      </div>

      <div id="homeError"></div>
      <div id="homeOnboarding"></div>

      <div class="grid grid-4 stagger" id="homeKpis">
        ${[1, 2, 3, 4].map(() => '<div class="card"><div class="skeleton" style="height:56px"></div></div>').join("")}
      </div>

      <div class="split mt-5">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <h3 class="card-title">Ventes des 7 derniers jours</h3>
            </div>
            <div class="chart-box"><canvas id="homeChart" aria-label="Graphique des ventes des 7 derniers jours" role="img"></canvas></div>
          </section>

          <section>
            <h3 class="section-title" style="margin-top:0">Dernières ventes <a href="#/ventes">Tout voir</a></h3>
            <div class="card card-flush" id="homeRecent">
              <div class="list">${'<div class="list-item"><div class="skeleton" style="height:36px;width:100%"></div></div>'.repeat(3)}</div>
            </div>
          </section>
        </div>

        <section>
          <h3 class="section-title" style="margin-top:0">À réapprovisionner <a href="#/stock">Stock</a></h3>
          <div class="card card-flush" id="homeLow"></div>
        </section>
      </div>`;
  }

  function kpi(label, value, note, cls = "") {
    return `<div class="card kpi ${cls}">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value num">${esc(value)}</div>
      <div class="kpi-note">${esc(note)}</div>
    </div>`;
  }

  function paintKpis({ today, month }) {
    const net = month.profit + month.income - month.expenses;
    container.querySelector("#homeKpis").innerHTML = [
      kpi("Ventes du jour", money(today.revenue), `${num(today.salesCount)} vente${today.salesCount > 1 ? "s" : ""}`),
      kpi("Bénéfice du jour", money(today.profit), "Marge sur les ventes", today.profit > 0 ? "is-profit" : today.profit < 0 ? "is-loss" : ""),
      kpi("Ventes du mois", money(month.revenue), `${num(month.salesCount)} vente${month.salesCount > 1 ? "s" : ""}`),
      kpi("Résultat net du mois", money(net), `Dépenses : ${money(month.expenses)}`, net > 0 ? "is-profit" : net < 0 ? "is-loss" : "")
    ].join("");
  }

  function paintChart(days) {
    const canvas = container.querySelector("#homeChart");
    if (!canvas) return;
    if (!window.Chart) {                      // bibliothèque pas encore chargée
      canvas.parentElement.innerHTML = '<p class="text-sm text-muted">Graphique indisponible.</p>';
      return;
    }
    if (chart) chart.destroy();
    const labels = days.map((d) => {
      const [y, m, dd] = d.day.split("-").map(Number);
      return new Date(y, m - 1, dd).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
    });
    chart = new window.Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Ventes", data: days.map((d) => d.revenue), backgroundColor: "#5B3FE0", borderRadius: 4, maxBarThickness: 36 },
          { label: "Bénéfice", data: days.map((d) => d.profit), backgroundColor: "#1E9E6B", borderRadius: 4, maxBarThickness: 36 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 600 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${money(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: "#EEEAF7" }, ticks: { font: { size: 11 }, maxTicksLimit: 5, callback: (v) => compact(v) } }
        }
      }
    });
  }

  function paintRecent(sales) {
    const host = container.querySelector("#homeRecent");
    if (!sales.length) {
      host.innerHTML = `<div class="empty">${icon("receipt", 44)}
        <div class="empty-title">Aucune vente pour l'instant</div>
        <p>Vos ventes apparaîtront ici dès la première.</p></div>`;
      return;
    }
    host.innerHTML = `<div class="list">${sales.map((s) => `
      <a class="list-item" href="#/ventes">
        <div class="list-main">
          <div class="list-title">${esc(s.customerName || "Client comptoir")}</div>
          <div class="list-sub">${esc(s.invoiceNo)} · ${esc(ui.fmtDate(s.createdAt))}</div>
        </div>
        <div style="text-align:right">
          <div class="list-value">${esc(money(s.total))}</div>
          ${statusBadge(s)}
        </div>
      </a>`).join("")}</div>`;
  }

  function statusBadge(s) {
    if (s.status === "cancelled") return '<span class="badge badge-error">Annulée</span>';
    if (s.status === "credit") return `<span class="badge badge-warning">Reste ${esc(money(s.total - s.paid))}</span>`;
    return '<span class="badge badge-success">Payée</span>';
  }

  function paintLowStock() {
    const host = container.querySelector("#homeLow");
    if (!host) return;
    const low = store.getLowStock().sort((a, b) => a.qty - b.qty);
    if (!low.length) {
      host.innerHTML = `<div class="empty" style="padding:var(--space-6) var(--space-4)">
        <div class="empty-title">Tout est en ordre</div>
        <p>Aucun produit n'est sous son seuil d'alerte.</p></div>`;
      return;
    }
    const shown = low.slice(0, 6);
    host.innerHTML = `<div class="list">${shown.map((p) => `
      <a class="list-item" href="#/stock">
        <div class="list-main">
          <div class="list-title">${esc(p.name)}</div>
          <div class="list-sub">Seuil d'alerte : ${esc(num(p.alertAt, 2))}</div>
        </div>
        <span class="badge ${p.qty <= 0 ? "badge-error" : "badge-warning"}">${p.qty <= 0 ? "Rupture" : "Reste " + esc(num(p.qty, 2))}</span>
      </a>`).join("")}
      ${low.length > shown.length ? `<a class="list-item" href="#/stock"><div class="list-main text-sm text-muted">+ ${low.length - shown.length} autre${low.length - shown.length > 1 ? "s" : ""} produit${low.length - shown.length > 1 ? "s" : ""}</div></a>` : ""}
    </div>`;
  }

  // Premier lancement : aucun produit → on guide l'utilisateur
  function paintOnboarding() {
    const host = container.querySelector("#homeOnboarding");
    if (!host) return;
    if (store.getProducts().length > 0) { host.innerHTML = ""; return; }
    host.innerHTML = `
      <div class="card mb-4" style="margin-bottom:var(--space-4);border-color:var(--color-primary);background:var(--color-primary-light)">
        <h3 style="margin-bottom:var(--space-2)">Bienvenue, commençons par votre stock</h3>
        <p class="text-sm" style="margin-bottom:var(--space-4)">Ajoutez vos premiers produits avec leur prix d'achat et de vente. Ensuite, chaque vente mettra le stock et le bénéfice à jour toute seule.</p>
        <a class="btn btn-primary" href="#/stock">Ajouter mon premier produit</a>
      </div>`;
  }

  /* ---------- Événements ---------- */
  const stopDelegate = ui.delegate(container, { retry: () => { container.querySelector("#homeError").innerHTML = ""; load(); } });
  // Les produits changent (vente, réappro, autre appareil) : on met à jour sans relire Firestore
  const offProducts = ctx.on("products", () => { paintLowStock(); paintOnboarding(); });
  // Une vente ou une dépense vient d'être enregistrée : on recharge les chiffres
  const offChange = ctx.on("data-changed", () => load());

  await load();

  return () => {
    alive = false;
    if (chart) chart.destroy();
    stopDelegate(); offProducts(); offChange();
  };
}

/* ---------- Utilitaires locaux ---------- */
function todayLabel() {
  const s = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(".0", "") + " Md";
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(".0", "") + " M";
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(".0", "") + " k";
  return String(v);
}
