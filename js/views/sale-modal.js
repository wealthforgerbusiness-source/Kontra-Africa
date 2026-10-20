// js/views/sale-modal.js — fenêtre « Nouvelle vente »
// Coût Firestore : 0 lecture pour chercher des produits (cache mémoire).
// Les clients (max 200 lectures) ne sont chargés que si l'utilisateur choisit « À crédit »,
// une seule fois par ouverture. L'enregistrement = 1 batch atomique (vente + stock + totaux).

export function openSaleModal(ctx) {
  const { store, ui } = ctx;
  const { esc, money, num, icon } = ui;

  if (!ctx.canWrite) { ui.toast("Abonnement expiré : renouvelez pour enregistrer une vente.", "error"); return; }
  if (!store.getProducts().length) {
    ui.toast("Ajoutez d'abord un produit dans le stock.", "error");
    ctx.go("stock");
    return;
  }

  const cart = new Map();            // pid -> quantité
  let mode = "paid";                 // paid | credit
  let customers = null;              // chargés à la demande
  let loadingCustomers = false;
  let submitting = false;

  const parse = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));

  const api = ui.openModal({
    title: "Nouvelle vente",
    content: `
      <div class="stack" style="gap:var(--space-4)">
        <div class="field">
          <label class="label" for="svSearch">Ajouter un produit</label>
          <div class="input-group">
            ${icon("search", 18)}
            <input class="input" id="svSearch" type="search" autocomplete="off" maxlength="80"
                   placeholder="Nom ou référence" aria-label="Rechercher un produit à vendre" />
          </div>
        </div>
        <div id="svResults" class="card card-flush" style="max-height:220px;overflow-y:auto"></div>

        <div>
          <div class="label" style="margin-bottom:var(--space-2)">Panier</div>
          <div id="svCart"></div>
        </div>

        <div class="field">
          <span class="label">Paiement</span>
          <div class="segmented" role="group" aria-label="Mode de paiement" id="svMode">
            <button type="button" data-mode="paid" aria-pressed="true">Payée</button>
            <button type="button" data-mode="credit" aria-pressed="false">À crédit</button>
          </div>
        </div>

        <div id="svCredit" hidden class="stack" style="gap:var(--space-3)">
          <div class="field">
            <label class="label" for="svCust">Client</label>
            <select class="select" id="svCust"><option value="">Nouveau client</option></select>
          </div>
          <div id="svNewCust" class="field-row">
            <div class="field"><label class="label" for="svName">Nom</label>
              <input class="input" id="svName" maxlength="80" autocomplete="off" /></div>
            <div class="field"><label class="label" for="svPhone">Téléphone</label>
              <input class="input" id="svPhone" inputmode="tel" maxlength="24" autocomplete="off" placeholder="+243…" /></div>
          </div>
          <div class="field">
            <label class="label" for="svDeposit">Acompte versé <span class="text-muted" style="font-weight:400">(facultatif)</span></label>
            <input class="input" id="svDeposit" inputmode="decimal" autocomplete="off" placeholder="0" />
          </div>
        </div>

        <div id="svBuyer" class="field-row">
          <div class="field"><label class="label" for="svBName">Client <span class="text-muted" style="font-weight:400">(facultatif)</span></label>
            <input class="input" id="svBName" maxlength="80" autocomplete="off" /></div>
          <div class="field"><label class="label" for="svBPhone">Téléphone <span class="text-muted" style="font-weight:400">(facultatif)</span></label>
            <input class="input" id="svBPhone" inputmode="tel" maxlength="24" autocomplete="off" placeholder="Pour la facture WhatsApp" /></div>
        </div>

        <div class="field">
          <label class="label" for="svNote">Note <span class="text-muted" style="font-weight:400">(facultatif)</span></label>
          <input class="input" id="svNote" maxlength="300" autocomplete="off" />
        </div>

        <div id="svTotals" class="card" style="background:var(--color-surface-alt);box-shadow:none"></div>
      </div>`,
    actions: [
      { label: "Annuler", variant: "secondary" },
      { label: "Enregistrer la vente", variant: "primary", onClick: submit }
    ]
  });

  const $ = (s) => api.body.querySelector(s);

  /* ============================================================
     Recherche de produits
     ============================================================ */
  function paintResults() {
    const term = $("#svSearch").value;
    const list = store.searchProducts(term).filter((p) => p.qty > 0).slice(0, 8);
    const host = $("#svResults");
    if (!list.length) {
      host.innerHTML = `<div class="empty" style="padding:var(--space-5) var(--space-4)"><p>${
        term ? "Aucun produit disponible pour cette recherche." : "Aucun produit en stock."}</p></div>`;
      return;
    }
    host.innerHTML = `<div class="list">${list.map((p) => `
      <button type="button" class="list-item" data-add="${esc(p.id)}" style="width:100%;background:none;border:0;text-align:left;font:inherit;cursor:pointer">
        <div class="list-main">
          <div class="list-title">${esc(p.name)}</div>
          <div class="list-sub">En stock : ${esc(num(p.qty, 2))}</div>
        </div>
        <div class="list-value">${esc(money(p.sellPrice))}</div>
        ${icon("plus", 18)}
      </button>`).join("")}</div>`;
  }

  /* ============================================================
     Panier
     ============================================================ */
  function totals() {
    let total = 0, profit = 0;
    for (const [pid, qty] of cart) {
      const p = store.getProduct(pid);
      if (!p) continue;
      total += p.sellPrice * qty;
      profit += (p.sellPrice - p.buyPrice) * qty;
    }
    return { total: Math.round(total * 100) / 100, profit: Math.round(profit * 100) / 100 };
  }

  function paintCart() {
    const host = $("#svCart");
    if (!cart.size) {
      host.innerHTML = `<p class="text-sm text-muted">Aucun produit ajouté. Cherchez-en un ci-dessus.</p>`;
    } else {
      host.innerHTML = [...cart].map(([pid, qty]) => {
        const p = store.getProduct(pid);
        if (!p) return "";
        return `<div class="sale-line">
          <div>
            <div class="fw-6 text-sm">${esc(p.name)}</div>
            <div class="text-xs text-muted">${esc(money(p.sellPrice))} × ${esc(num(qty, 2))} = <span class="fw-6">${esc(money(p.sellPrice * qty))}</span></div>
          </div>
          <div class="row" style="gap:var(--space-2)">
            <div class="stepper">
              <button type="button" data-dec="${esc(pid)}" aria-label="Diminuer">−</button>
              <input data-qty="${esc(pid)}" inputmode="decimal" value="${esc(String(qty))}" aria-label="Quantité de ${esc(p.name)}" />
              <button type="button" data-inc="${esc(pid)}" aria-label="Augmenter">+</button>
            </div>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-del="${esc(pid)}" aria-label="Retirer ${esc(p.name)}">${icon("close", 18)}</button>
          </div>
        </div>`;
      }).join("");
    }
    paintTotals();
  }

  function paintTotals() {
    const { total, profit } = totals();
    let extra = "";
    if (mode === "credit" && total > 0) {
      const dep = Math.min(Math.max(parse($("#svDeposit").value) || 0, 0), total);
      extra = `<div class="row-between text-sm" style="margin-top:var(--space-2)"><span class="text-muted">Acompte</span><span class="num">${esc(money(dep))}</span></div>
               <div class="row-between text-sm"><span class="text-muted">Reste à payer</span><span class="num fw-6 text-loss">${esc(money(total - dep))}</span></div>`;
    }
    $("#svTotals").innerHTML = `
      <div class="row-between"><span class="fw-6">Total</span>
        <span class="num" style="font-family:var(--font-display);font-weight:700;font-size:var(--fs-lg)">${esc(money(total))}</span></div>
      <div class="row-between text-xs" style="margin-top:var(--space-1)"><span class="text-muted">Bénéfice estimé</span>
        <span class="num ${profit < 0 ? "text-loss" : "text-profit"}">${esc(money(profit))}</span></div>
      ${extra}`;
  }

  function setQty(pid, q) {
    const p = store.getProduct(pid);
    if (!p) { cart.delete(pid); return; }
    if (!isFinite(q) || q <= 0) { cart.delete(pid); return; }
    if (q > p.qty) { q = p.qty; ui.toast(`Stock disponible : ${num(p.qty, 2)}`, "info"); }
    cart.set(pid, Math.round(q * 1000) / 1000);
  }

  /* ============================================================
     Événements
     ============================================================ */
  $("#svSearch").addEventListener("input", ui.debounce(paintResults, 150));

  api.body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      const id = add.dataset.add;
      setQty(id, (cart.get(id) || 0) + 1);
      paintCart();
      return;
    }
    const inc = e.target.closest("[data-inc]");
    if (inc) { setQty(inc.dataset.inc, (cart.get(inc.dataset.inc) || 0) + 1); paintCart(); return; }
    const dec = e.target.closest("[data-dec]");
    if (dec) { setQty(dec.dataset.dec, (cart.get(dec.dataset.dec) || 0) - 1); paintCart(); return; }
    const del = e.target.closest("[data-del]");
    if (del) { cart.delete(del.dataset.del); paintCart(); return; }
    const m = e.target.closest("[data-mode]");
    if (m) setMode(m.dataset.mode);
  });

  api.body.addEventListener("change", (e) => {
    const q = e.target.closest("[data-qty]");
    if (q) { setQty(q.dataset.qty, parse(q.value)); paintCart(); }
  });

  $("#svDeposit").addEventListener("input", paintTotals);

  function setMode(next) {
    mode = next;
    api.body.querySelectorAll("#svMode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    $("#svCredit").hidden = mode !== "credit";
    $("#svBuyer").hidden = mode === "credit";
    if (mode === "credit") loadCustomers();
    paintTotals();
  }

  async function loadCustomers() {
    if (customers || loadingCustomers) return;
    loadingCustomers = true;
    try {
      customers = await store.listCustomers();
      const sel = $("#svCust");
      customers.forEach((c) => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.debt > 0 ? `${c.name} (doit ${money(c.debt)})` : c.name;
        sel.appendChild(o);
      });
    } catch {
      customers = [];            // on continue avec un nouveau client
    } finally { loadingCustomers = false; }
  }

  $("#svCust").addEventListener("change", (e) => {
    $("#svNewCust").hidden = e.target.value !== "";
  });

  /* ============================================================
     Enregistrement
     ============================================================ */
  async function submit() {
    if (submitting) return false;
    if (!cart.size) { ui.toast("Ajoutez au moins un produit.", "error"); return false; }

    const { total } = totals();
    const items = [...cart].map(([pid, qty]) => ({ pid, qty }));
    const snapshot = [...cart].map(([pid, qty]) => {
      const p = store.getProduct(pid);
      return { name: p.name, qty, price: p.sellPrice };
    });

    const input = { items, status: mode, note: $("#svNote").value.trim() };
    let name = "", phone = "";

    if (mode === "credit") {
      const custId = $("#svCust").value;
      if (custId) {
        const c = customers.find((x) => x.id === custId);
        input.customer = { id: custId, name: c?.name, phone: c?.phone };
        name = c?.name || ""; phone = c?.phone || "";
      } else {
        name = $("#svName").value.trim(); phone = $("#svPhone").value.trim();
        if (!name) { ui.toast("Indiquez le nom du client pour une vente à crédit.", "error"); return false; }
        input.customer = { name, phone };
      }
      const dep = parse($("#svDeposit").value || "0");
      if (!isFinite(dep) || dep < 0) { ui.toast("Acompte invalide.", "error"); return false; }
      if (dep >= total) { ui.toast("L'acompte couvre déjà le total : choisissez « Payée ».", "error"); return false; }
      input.paid = dep;
    } else {
      name = $("#svBName").value.trim(); phone = $("#svBPhone").value.trim();
      if (name || phone) input.customer = { name, phone };
    }

    submitting = true;
    try {
      const r = await ui.writeOrQueue(store.recordSale(input), 2500);
      ctx.emit("data-changed");
      if (r?.queued) {
        ui.toast("Vente enregistrée hors ligne. Elle sera envoyée au retour du réseau.", "success", 4500);
        return;
      }
      showSuccess({
        ...r, items: snapshot, status: mode, paid: input.paid ?? total,
        customerName: name, customerPhone: phone, createdAt: new Date()
      });
    } finally { submitting = false; }
  }

  /* ============================================================
     Confirmation : facture et WhatsApp
     ============================================================ */
  function showSuccess(sale) {
    const hasPhone = !!sale.customerPhone;
    ui.openModal({
      title: "Vente enregistrée",
      content: `
        <div class="stack" style="gap:var(--space-3)">
          <div class="row-between"><span class="text-muted text-sm">Facture</span><span class="fw-6">${esc(sale.invoiceNo)}</span></div>
          <div class="row-between"><span class="text-muted text-sm">Total</span><span class="num fw-6">${esc(money(sale.total))}</span></div>
          <div class="row-between"><span class="text-muted text-sm">Bénéfice</span><span class="num fw-6 ${sale.profit < 0 ? "text-loss" : "text-profit"}">${esc(money(sale.profit))}</span></div>
          ${sale.status === "credit" ? `<div class="banner is-warning" style="margin:0">Reste à encaisser : <strong>${esc(money(sale.total - sale.paid))}</strong> (${esc(sale.customerName)})</div>` : ""}
        </div>`,
      actions: [
        { label: "Terminer", variant: "secondary" },
        ...(hasPhone ? [{ label: "WhatsApp", variant: "secondary", closes: false, onClick: () => { whatsapp(sale); return false; } }] : []),
        { label: "Facture PDF", variant: "primary", closes: false, onClick: () => invoice(sale) }
      ]
    });
  }

  async function invoice(sale) {
    try {
      const m = await import("../invoice.js");
      m.openInvoice(sale, ctx);
    } catch (e) {
      console.error(e);
      ui.toast("La facture n'est pas disponible pour le moment.", "error");
    }
    return false;                    // la fenêtre de confirmation reste ouverte
  }

  function whatsapp(sale) {
    const biz = ctx.profile.businessName || "Kontra-Africa";
    const lines = sale.items.map((i) => `• ${i.name} × ${num(i.qty, 2)} : ${money(i.price * i.qty)}`);
    const msg = [
      `Bonjour ${sale.customerName || ""},`.trim(),
      `Voici votre facture ${sale.invoiceNo} — ${biz}`,
      ...lines,
      `Total : ${money(sale.total)}`,
      sale.status === "credit" ? `Reste à payer : ${money(sale.total - sale.paid)}` : "Payé. Merci !"
    ].join("\n");
    let digits = String(sale.customerPhone || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    // Numéro local sans indicatif pays : WhatsApp ne peut pas le deviner, l'utilisateur choisit le contact
    const target = digits.length >= 9 && !digits.startsWith("0") ? digits : "";
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  paintResults();
  paintCart();
  setMode("paid");
  setTimeout(() => $("#svSearch")?.focus({ preventScroll: true }), 350);
}
