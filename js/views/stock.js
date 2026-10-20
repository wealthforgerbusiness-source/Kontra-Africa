// js/views/stock.js — écran Stock
// Coût Firestore : 0 lecture (cache mémoire alimenté par le listener unique de app.js).
// Écritures : 1 document par action (ajout, modification, réapprovisionnement, archivage).

export async function mount(container, ctx) {
  const { store, ui } = ctx;
  const { esc, money, num, icon } = ui;

  let term = "";
  let filter = "all";                    // all | low | out

  container.innerHTML = shell();
  const $ = (s) => container.querySelector(s);

  /* ============================================================
     Rendu
     ============================================================ */
  function shell() {
    return `
      <div class="page-head">
        <div>
          <h2 class="page-title">Stock</h2>
          <p class="page-sub" id="stSub"></p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" type="button" data-action="add" id="stAdd">
            ${icon("plus", 18)} Ajouter un produit
          </button>
        </div>
      </div>

      <div class="grid grid-3 stagger" id="stKpis"></div>

      <div class="toolbar mt-5">
        <div class="input-group">
          ${icon("search", 18)}
          <input class="input" id="stSearch" type="search" placeholder="Rechercher un produit ou une référence"
                 aria-label="Rechercher un produit" autocomplete="off" maxlength="80" />
        </div>
        <div class="segmented" role="group" aria-label="Filtrer le stock" id="stFilter">
          <button type="button" data-filter="all" aria-pressed="true">Tous</button>
          <button type="button" data-filter="low" aria-pressed="false">Stock bas</button>
          <button type="button" data-filter="out" aria-pressed="false">Rupture</button>
        </div>
      </div>

      <div id="stList"></div>`;
  }

  function visible() {
    let list = store.searchProducts(term);
    if (filter === "low") list = list.filter((p) => p.isLow && p.qty > 0);
    if (filter === "out") list = list.filter((p) => p.qty <= 0);
    return list;
  }

  function paintKpis() {
    const all = store.getProducts();
    let cost = 0, retail = 0;
    for (const p of all) {
      if (p.qty > 0) { cost += p.qty * p.buyPrice; retail += p.qty * p.sellPrice; }
    }
    const low = all.filter((p) => p.isLow).length;
    $("#stKpis").innerHTML = `
      <div class="card kpi"><div class="kpi-label">Produits</div>
        <div class="kpi-value num">${esc(num(all.length))}</div>
        <div class="kpi-note">${low ? esc(num(low)) + " à réapprovisionner" : "Aucune alerte"}</div></div>
      <div class="card kpi"><div class="kpi-label">Valeur du stock (achat)</div>
        <div class="kpi-value num">${esc(money(cost))}</div>
        <div class="kpi-note">Ce que votre stock vous a coûté</div></div>
      <div class="card kpi is-profit"><div class="kpi-label">Valeur de vente</div>
        <div class="kpi-value num">${esc(money(retail))}</div>
        <div class="kpi-note">Gain potentiel : ${esc(money(retail - cost))}</div></div>`;
    $("#stSub").textContent = `${num(all.length)} produit${all.length > 1 ? "s" : ""} au catalogue`;
  }

  function stateBadge(p) {
    if (p.qty <= 0) return '<span class="badge badge-error">Rupture</span>';
    if (p.isLow) return '<span class="badge badge-warning">Stock bas</span>';
    return '<span class="badge badge-success">En stock</span>';
  }

  function paintList() {
    const host = $("#stList");
    const all = store.getProducts();

    if (!all.length) {
      host.innerHTML = `<div class="card"><div class="empty">${icon("box", 44)}
        <div class="empty-title">Votre stock est vide</div>
        <p>Ajoutez votre premier produit avec son prix d'achat et son prix de vente.</p>
        ${ctx.canWrite ? '<button class="btn btn-primary" type="button" data-action="add">Ajouter un produit</button>' : ""}
      </div></div>`;
      return;
    }

    const list = visible();
    if (!list.length) {
      host.innerHTML = `<div class="card"><div class="empty">${icon("search", 44)}
        <div class="empty-title">Aucun résultat</div>
        <p>Essayez un autre mot ou changez le filtre.</p></div></div>`;
      return;
    }

    const dis = ctx.canWrite ? "" : "disabled";
    host.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Produit</th><th class="right">Quantité</th><th class="right">Prix d'achat</th>
            <th class="right">Prix de vente</th><th class="right">Marge</th><th>État</th><th></th>
          </tr></thead>
          <tbody>
            ${list.map((p) => {
              const margin = p.sellPrice - p.buyPrice;
              return `<tr>
                <td class="cell-title"><div class="cell-main">${esc(p.name)}</div>
                  ${p.sku ? `<div class="cell-sub">Réf. ${esc(p.sku)}</div>` : ""}</td>
                <td class="num" data-label="Quantité"><span class="fw-6">${esc(num(p.qty, 2))}</span></td>
                <td class="num" data-label="Prix d'achat">${esc(money(p.buyPrice))}</td>
                <td class="num" data-label="Prix de vente">${esc(money(p.sellPrice))}</td>
                <td class="num ${margin < 0 ? "text-loss" : "text-profit"}" data-label="Marge">${esc(money(margin))}</td>
                <td data-label="État">${stateBadge(p)}</td>
                <td class="cell-actions">
                  <div class="row" style="justify-content:flex-end;gap:var(--space-2)">
                    <button class="btn btn-secondary btn-sm" type="button" data-action="restock" data-id="${esc(p.id)}" ${dis}>Réapprovisionner</button>
                    <button class="btn btn-ghost btn-icon btn-sm" type="button" data-action="edit" data-id="${esc(p.id)}" aria-label="Modifier ${esc(p.name)}" ${dis}>${icon("edit", 18)}</button>
                    <button class="btn btn-ghost btn-icon btn-sm" type="button" data-action="archive" data-id="${esc(p.id)}" aria-label="Archiver ${esc(p.name)}" ${dis}>${icon("trash", 18)}</button>
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function paintAll() {
    paintKpis();
    paintList();
    const add = $("#stAdd");
    if (add) add.disabled = !ctx.canWrite;
  }

  /* ============================================================
     Saisie : lecture et validation du formulaire
     ============================================================ */
  const parse = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));

  function productForm(p = {}) {
    const v = (x) => (x === undefined || x === null ? "" : esc(String(x)));
    return `
      <form class="form" id="pForm" novalidate>
        <div class="field">
          <label class="label" for="pName">Nom du produit</label>
          <input class="input" id="pName" maxlength="80" autocomplete="off" value="${v(p.name)}" placeholder="Ex. Riz 25 kg" required />
        </div>
        <div class="field">
          <label class="label" for="pSku">Référence <span class="text-muted fw-6" style="font-weight:400">(facultatif)</span></label>
          <input class="input" id="pSku" maxlength="40" autocomplete="off" value="${v(p.sku)}" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="pBuy">Prix d'achat</label>
            <input class="input" id="pBuy" inputmode="decimal" autocomplete="off" value="${v(p.buyPrice)}" placeholder="0" />
          </div>
          <div class="field">
            <label class="label" for="pSell">Prix de vente</label>
            <input class="input" id="pSell" inputmode="decimal" autocomplete="off" value="${v(p.sellPrice)}" placeholder="0" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="pQty">Quantité en stock</label>
            <input class="input" id="pQty" inputmode="decimal" autocomplete="off" value="${v(p.qty ?? 0)}" />
          </div>
          <div class="field">
            <label class="label" for="pAlert">Alerte à partir de</label>
            <input class="input" id="pAlert" inputmode="decimal" autocomplete="off" value="${v(p.alertAt ?? 5)}" />
            <span class="hint">Vous êtes prévenu sous ce seuil.</span>
          </div>
        </div>
        <p class="hint" id="pMargin" aria-live="polite"></p>
      </form>`;
  }

  function bindMargin(api) {
    const buy = api.body.querySelector("#pBuy"), sell = api.body.querySelector("#pSell"), out = api.body.querySelector("#pMargin");
    const update = () => {
      const b = parse(buy.value), s = parse(sell.value);
      if (!buy.value || !sell.value || !isFinite(b) || !isFinite(s)) { out.textContent = ""; return; }
      const m = s - b;
      out.textContent = m < 0
        ? `Attention : vous vendez à perte (${money(m)} par unité).`
        : `Marge par unité : ${money(m)}${b > 0 ? " (" + Math.round((m / b) * 100) + " %)" : ""}`;
      out.style.color = m < 0 ? "var(--color-error)" : "var(--color-success)";
    };
    buy.addEventListener("input", update); sell.addEventListener("input", update); update();
  }

  function readForm(api) {
    const g = (id) => api.body.querySelector(id).value;
    const data = {
      name: g("#pName").trim(), sku: g("#pSku").trim(),
      buyPrice: parse(g("#pBuy")), sellPrice: parse(g("#pSell")),
      qty: parse(g("#pQty") || "0"), alertAt: parse(g("#pAlert") || "0")
    };
    if (!data.name) throw new Error("Donnez un nom au produit.");
    if (!isFinite(data.buyPrice) || data.buyPrice < 0 || g("#pBuy").trim() === "") throw new Error("Prix d'achat invalide.");
    if (!isFinite(data.sellPrice) || data.sellPrice < 0 || g("#pSell").trim() === "") throw new Error("Prix de vente invalide.");
    if (!isFinite(data.qty) || data.qty < 0) throw new Error("Quantité invalide.");
    if (!isFinite(data.alertAt) || data.alertAt < 0) throw new Error("Seuil d'alerte invalide.");
    return data;
  }

  /* ============================================================
     Actions
     ============================================================ */
  function guard() {
    if (ctx.canWrite) return true;
    ui.toast("Abonnement expiré : renouvelez pour modifier le stock.", "error");
    return false;
  }

  function addProduct() {
    if (!guard()) return;
    ui.openModal({
      title: "Ajouter un produit",
      content: productForm(),
      actions: [
        { label: "Annuler", variant: "secondary" },
        {
          label: "Enregistrer", variant: "primary",
          onClick: async (api) => {
            let d;
            try { d = readForm(api); } catch (e) { ui.toast(e.message, "error"); return false; }
            if (store.getProducts().length >= 500) { ui.toast("Limite de 500 produits atteinte.", "error"); return false; }
            const r = await ui.writeOrQueue(store.addProduct(d));
            ui.toast(r?.queued ? "Enregistré hors ligne, envoi au retour du réseau." : "Produit ajouté.", "success");
          }
        }
      ]
    });
    setTimeout(() => { const m = document.querySelector(".modal-backdrop:last-child"); }, 0);
    bindLast();
  }

  function editProduct(id) {
    if (!guard()) return;
    const p = store.getProduct(id);
    if (!p) { ui.toast("Produit introuvable.", "error"); return; }
    ui.openModal({
      title: "Modifier le produit",
      content: productForm(p),
      actions: [
        { label: "Annuler", variant: "secondary" },
        {
          label: "Enregistrer", variant: "primary",
          onClick: async (api) => {
            let d;
            try { d = readForm(api); } catch (e) { ui.toast(e.message, "error"); return false; }
            const r = await ui.writeOrQueue(store.updateProduct(id, d));
            ui.toast(r?.queued ? "Modifié hors ligne, envoi au retour du réseau." : "Produit mis à jour.", "success");
          }
        }
      ]
    });
    bindLast();
  }

  function restock(id) {
    if (!guard()) return;
    const p = store.getProduct(id);
    if (!p) { ui.toast("Produit introuvable.", "error"); return; }
    ui.openModal({
      title: "Réapprovisionner",
      content: `
        <div class="stack">
          <div><div class="fw-6">${esc(p.name)}</div>
            <div class="text-sm text-muted">En stock actuellement : <span class="num fw-6">${esc(num(p.qty, 2))}</span></div></div>
          <div class="field">
            <label class="label" for="rQty">Quantité reçue</label>
            <input class="input" id="rQty" inputmode="decimal" autocomplete="off" placeholder="Ex. 20" />
          </div>
          <p class="hint" id="rAfter" aria-live="polite"></p>
        </div>`,
      actions: [
        { label: "Annuler", variant: "secondary" },
        {
          label: "Ajouter au stock", variant: "primary",
          onClick: async (api) => {
            const n = parse(api.body.querySelector("#rQty").value);
            if (!isFinite(n) || n <= 0) { ui.toast("Entrez une quantité supérieure à zéro.", "error"); return false; }
            const r = await ui.writeOrQueue(store.restock(id, n));
            ui.toast(r?.queued ? "Enregistré hors ligne." : `+${num(n, 2)} ajouté au stock.`, "success");
          }
        }
      ]
    });
    const last = [...document.querySelectorAll(".modal-backdrop")].pop();
    const input = last?.querySelector("#rQty"), after = last?.querySelector("#rAfter");
    input?.addEventListener("input", () => {
      const n = parse(input.value);
      after.textContent = isFinite(n) && n > 0 ? `Nouveau stock : ${num(p.qty + n, 2)}` : "";
    });
  }

  async function archive(id) {
    if (!guard()) return;
    const p = store.getProduct(id);
    if (!p) return;
    const ok = await ui.confirmDialog({
      title: "Archiver ce produit ?",
      message: `« ${p.name} » disparaîtra de votre stock. Vos ventes passées restent intactes.`,
      confirmLabel: "Archiver", danger: true
    });
    if (!ok) return;
    try {
      const r = await ui.writeOrQueue(store.archiveProduct(id));
      ui.toast(r?.queued ? "Archivé hors ligne." : "Produit archivé.", "success");
    } catch (e) { ui.toast(e.message, "error"); }
  }

  // Branche l'aperçu de marge sur la fenêtre qui vient de s'ouvrir
  function bindLast() {
    const last = [...document.querySelectorAll(".modal-backdrop")].pop();
    if (!last) return;
    bindMargin({ body: last.querySelector(".modal-body") });
  }

  /* ============================================================
     Événements
     ============================================================ */
  const stopDelegate = ui.delegate(container, {
    add: () => addProduct(),
    edit: (el) => editProduct(el.dataset.id),
    restock: (el) => restock(el.dataset.id),
    archive: (el) => archive(el.dataset.id)
  });

  const onSearch = ui.debounce((e) => { term = e.target.value; paintList(); }, 180);
  $("#stSearch").addEventListener("input", onSearch);

  $("#stFilter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    container.querySelectorAll("#stFilter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paintList();
  });

  const offProducts = ctx.on("products", paintAll);   // vente, réappro, autre appareil
  const offSub = ctx.on("sub", paintAll);             // abonnement expiré ou renouvelé

  paintAll();

  return () => { stopDelegate(); offProducts(); offSub(); };
}
