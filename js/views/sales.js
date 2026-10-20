export async function mount(container, ctx) {
  const { store, ui } = ctx;
  const { esc, money, num, icon } = ui;

  let sales = [];            // ventes chargées, plus récentes d'abord
  let cursor = null;         // curseur de la page suivante (null = fin)
  let filter = "all";        // all | credit | paid | cancelled
  let term = "";
  let loading = false;
  let alive = true;

  container.innerHTML = shell();
  const $ = (s) => container.querySelector(s);

  /* ============================================================
     Chargement
     ============================================================ */
  async function loadFirst() {
    sales = []; cursor = null;
    $("#svList").innerHTML = skeleton();
    await loadMore(true);
  }

  async function loadMore(first = false) {
    if (loading) return;
    loading = true;
    const btn = $("#svMore");
    if (btn) ui.setBusy(btn, true);
    try {
      const page = await store.listSales({ after: first ? null : cursor, pageSize: 30 });
      if (!alive) return;
      const known = new Set(sales.map((s) => s.id));
      page.sales.forEach((s) => { if (!known.has(s.id)) sales.push(s); });
      cursor = page.cursor;
      $("#svError").innerHTML = "";
    } catch (e) {
      if (!alive) return;
      $("#svError").innerHTML = `
        <div class="banner is-warning">
          <div class="banner-text">${esc(e.message || "Impossible de charger les ventes.")}</div>
          <button class="btn btn-secondary btn-sm" type="button" data-action="retry">Réessayer</button>
        </div>`;
    } finally {
      loading = false;
      if (alive) paint();
    }
  }

  /* ============================================================
     Rendu
     ============================================================ */
  function shell() {
    return `
      <div class="page-head">
        <div>
          <h2 class="page-title">Ventes</h2>
          <p class="page-sub" id="svSub"></p>
        </div>
        <div class="page-actions hide-mobile">
          <button class="btn btn-primary" type="button" data-action="new-sale" ${ctx.canWrite ? "" : "disabled"}>
            ${icon("plus", 18)} Nouvelle vente
          </button>
        </div>
      </div>

      <div id="svError"></div>

      <div class="toolbar">
        <div class="input-group">
          ${icon("search", 18)}
          <input class="input" id="svSearch" type="search" placeholder="Client ou numéro de facture"
                 aria-label="Rechercher une vente" autocomplete="off" maxlength="60" />
        </div>
        <div class="segmented" role="group" aria-label="Filtrer les ventes" id="svFilter">
          <button type="button" data-filter="all" aria-pressed="true">Toutes</button>
          <button type="button" data-filter="credit" aria-pressed="false">À crédit</button>
          <button type="button" data-filter="paid" aria-pressed="false">Payées</button>
          <button type="button" data-filter="cancelled" aria-pressed="false">Annulées</button>
        </div>
      </div>

      <div id="svList"></div>`;
  }

  function skeleton() {
    return `<div class="card card-flush"><div class="list">${
      '<div class="list-item"><div class="skeleton" style="height:40px;width:100%"></div></div>'.repeat(4)}</div></div>`;
  }

  function visible() {
    const t = term.trim().toLowerCase();
    return sales.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (!t) return true;
      return (s.customerName || "").toLowerCase().includes(t) || (s.invoiceNo || "").toLowerCase().includes(t);
    });
  }

  function badge(s) {
    if (s.status === "cancelled") return '<span class="badge badge-error">Annulée</span>';
    if (s.status === "credit") return '<span class="badge badge-warning">À crédit</span>';
    return '<span class="badge badge-success">Payée</span>';
  }

  function paint() {
    const host = $("#svList");
    const list = visible();
    $("#svSub").textContent = sales.length
      ? `${num(sales.length)} vente${sales.length > 1 ? "s" : ""} affichée${sales.length > 1 ? "s" : ""}${cursor ? " (les plus récentes)" : ""}`
      : "";

    if (!sales.length && !loading) {
      host.innerHTML = `<div class="card"><div class="empty">${icon("receipt", 44)}
        <div class="empty-title">Aucune vente enregistrée</div>
        <p>Votre première vente apparaîtra ici avec sa facture.</p>
        ${ctx.canWrite ? '<button class="btn btn-primary" type="button" data-action="new-sale">Nouvelle vente</button>' : ""}
      </div></div>`;
      return;
    }

    if (!list.length) {
      host.innerHTML = `<div class="card"><div class="empty">${icon("search", 44)}
        <div class="empty-title">Aucun résultat</div>
        <p>${cursor ? "Essayez « Charger plus » : la recherche porte sur les ventes déjà affichées." : "Changez le filtre ou la recherche."}</p></div></div>
        ${moreBtn()}`;
      return;
    }

    host.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Facture</th><th>Client</th><th>Date</th>
            <th class="right">Total</th><th class="right">Bénéfice</th><th>État</th><th></th>
          </tr></thead>
          <tbody>
            ${list.map((s) => {
              const cancelled = s.status === "cancelled";
              const due = Math.max(Math.round((s.total - s.paid) * 100) / 100, 0);
              return `<tr${cancelled ? ' style="opacity:.6"' : ""}>
                <td class="cell-title"><div class="cell-main">${esc(s.invoiceNo)}</div>
                  <div class="cell-sub">${esc(num(s.items.length))} article${s.items.length > 1 ? "s" : ""}</div></td>
                <td data-label="Client">${esc(s.customerName || "Client comptoir")}</td>
                <td data-label="Date">${esc(ui.fmtDate(s.createdAt))}</td>
                <td class="num" data-label="Total">${esc(money(s.total))}${
                  s.status === "credit" ? `<div class="cell-sub text-loss">Reste ${esc(money(due))}</div>` : ""}</td>
                <td class="num ${s.profit < 0 ? "text-loss" : "text-profit"}" data-label="Bénéfice">${cancelled ? "—" : esc(money(s.profit))}</td>
                <td data-label="État">${badge(s)}</td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" type="button" data-action="open" data-id="${esc(s.id)}">Détails</button>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${moreBtn()}`;
  }

  function moreBtn() {
    return cursor
      ? `<div class="mt-4" style="display:grid;justify-items:center"><button class="btn btn-secondary" type="button" id="svMore" data-action="more">Charger plus de ventes</button></div>`
      : "";
  }

  /* ============================================================
     Détail d'une vente
     ============================================================ */
  function openDetail(id) {
    const s = sales.find((x) => x.id === id);
    if (!s) return;
    const cancelled = s.status === "cancelled";
    const due = Math.max(Math.round((s.total - s.paid) * 100) / 100, 0);

    const actions = [{ label: "Fermer", variant: "secondary" }];
    if (!cancelled) actions.push({ label: "Facture PDF", variant: "secondary", closes: false, onClick: () => { invoice(s); return false; } });
    if (s.status === "credit" && ctx.canWrite)
      actions.push({ label: "Encaisser", variant: "primary", onClick: () => { setTimeout(() => collect(s), 340); } });

    const api = ui.openModal({
      title: `Vente ${s.invoiceNo}`,
      content: `
        <div class="stack" style="gap:var(--space-4)">
          <div class="row-between">
            <div><div class="fw-6">${esc(s.customerName || "Client comptoir")}</div>
              <div class="text-xs text-muted">${esc(s.customerPhone || "")}${s.customerPhone ? " · " : ""}${esc(ui.fmtDate(s.createdAt))}</div></div>
            ${badge(s)}
          </div>
          <div class="card card-flush"><div class="list">
            ${s.items.map((i) => `
              <div class="list-item">
                <div class="list-main"><div class="list-title">${esc(i.name)}</div>
                  <div class="list-sub">${esc(money(i.price))} × ${esc(num(i.qty, 2))}</div></div>
                <div class="list-value">${esc(money(i.price * i.qty))}</div>
              </div>`).join("")}
          </div></div>
          <div class="stack" style="gap:var(--space-2)">
            <div class="row-between"><span class="text-muted">Total</span><span class="num fw-6">${esc(money(s.total))}</span></div>
            <div class="row-between"><span class="text-muted">Déjà payé</span><span class="num">${esc(money(s.paid))}</span></div>
            ${s.status === "credit" ? `<div class="row-between"><span class="text-muted">Reste à payer</span><span class="num fw-6 text-loss">${esc(money(due))}</span></div>` : ""}
            ${cancelled ? "" : `<div class="row-between"><span class="text-muted">Bénéfice</span><span class="num fw-6 ${s.profit < 0 ? "text-loss" : "text-profit"}">${esc(money(s.profit))}</span></div>`}
          </div>
          ${s.note ? `<p class="text-sm"><span class="text-muted">Note :</span> ${esc(s.note)}</p>` : ""}
          ${!cancelled && ctx.canWrite ? `<button class="btn btn-danger btn-sm" type="button" id="svCancel" style="justify-self:start">Annuler cette vente</button>` : ""}
        </div>`,
      actions
    });

    api.body.querySelector("#svCancel")?.addEventListener("click", () => { api.close(); setTimeout(() => cancel(s), 340); });
  }

  async function invoice(s) {
    try {
      const m = await import("../invoice.js");
      m.openInvoice(s, ctx);
    } catch (e) {
      console.error(e);
      ui.toast("La facture n'est pas disponible pour le moment.", "error");
    }
  }

  /* ============================================================
     Encaisser une dette
     ============================================================ */
  function collect(s) {
    if (!ctx.canWrite) { ui.toast("Abonnement expiré : renouvelez pour encaisser.", "error"); return; }
    const due = Math.max(Math.round((s.total - s.paid) * 100) / 100, 0);
    ui.openModal({
      title: "Encaisser un paiement",
      content: `
        <div class="stack">
          <div class="row-between"><span class="text-muted">${esc(s.customerName || "Client")}</span>
            <span class="num fw-6 text-loss">Reste ${esc(money(due))}</span></div>
          <div class="field">
            <label class="label" for="cAmt">Montant reçu</label>
            <input class="input" id="cAmt" inputmode="decimal" autocomplete="off" value="${esc(String(due))}" />
            <span class="hint">Un montant partiel est accepté : la dette diminue d'autant.</span>
          </div>
        </div>`,
      actions: [
        { label: "Annuler", variant: "secondary" },
        {
          label: "Valider", variant: "primary",
          onClick: async (api) => {
            const n = Number(String(api.body.querySelector("#cAmt").value).replace(/\s/g, "").replace(",", "."));
            if (!isFinite(n) || n <= 0) { ui.toast("Entrez un montant supérieur à zéro.", "error"); return false; }
            if (n > due + 0.001) { ui.toast(`Le montant dépasse ce qui reste à payer (${money(due)}).`, "error"); return false; }
            const r = await ui.writeOrQueue(store.collectPayment(s, n));
            if (r && !r.queued) { s.paid = r.paid; s.status = r.status; }
            else { s.paid = Math.round((s.paid + n) * 100) / 100; s.status = s.paid >= s.total ? "paid" : "credit"; }
            ui.toast(r?.queued ? "Enregistré hors ligne." : s.status === "paid" ? "Dette soldée." : "Paiement enregistré.", "success");
            ctx.emit("data-changed", { source: "sales" });
            paint();
          }
        }
      ]
    });
  }

  /* ============================================================
     Annuler une vente
     ============================================================ */
  async function cancel(s) {
    if (!ctx.canWrite) { ui.toast("Abonnement expiré : renouvelez pour annuler une vente.", "error"); return; }
    const ok = await ui.confirmDialog({
      title: "Annuler cette vente ?",
      message: `Les produits retournent en stock et les totaux sont corrigés${s.status === "credit" ? ", et la dette du client est effacée" : ""}. Cette action est définitive.`,
      confirmLabel: "Annuler la vente", danger: true
    });
    if (!ok) return;
    try {
      const r = await ui.writeOrQueue(store.cancelSale(s));
      s.status = "cancelled";
      ui.toast(r?.queued ? "Annulation enregistrée hors ligne." : "Vente annulée.", "success");
      ctx.emit("data-changed", { source: "sales" });
      paint();
    } catch (e) { ui.toast(e.message, "error"); }
  }

  /* ============================================================
     Événements
     ============================================================ */
  const stopDelegate = ui.delegate(container, {
    open: (el) => openDetail(el.dataset.id),
    more: () => loadMore(false),
    retry: () => loadFirst()
  });

  $("#svSearch").addEventListener("input", ui.debounce((e) => { term = e.target.value; paint(); }, 180));

  $("#svFilter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    container.querySelectorAll("#svFilter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paint();
  });

  // Une vente vient d'être faite ailleurs (fenêtre de vente) : on recharge la 1re page.
  const offChange = ctx.on("data-changed", (d) => { if (d?.source !== "sales") loadFirst(); });
  const offSub = ctx.on("sub", () => paint());

  await loadFirst();

  return () => { alive = false; stopDelegate(); offChange(); offSub(); };
}
