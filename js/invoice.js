export function openInvoice(sale, ctx) {
  const { ui } = ctx;
  const html = buildInvoiceHtml(sale, ctx);
  let blobUrl = null;

  const api = ui.openModal({
    title: `Facture ${sale.invoiceNo || ""}`.trim(),
    content: `
      <iframe id="invFrame" title="Aperçu de la facture"
              sandbox="allow-same-origin allow-modals"
              style="width:100%;height:min(62vh,560px);border:1px solid var(--color-border);border-radius:var(--radius-md);background:#fff"></iframe>
      <p class="hint" style="margin-top:var(--space-3)">
        Pour obtenir un PDF : touchez « Imprimer / PDF », puis choisissez « Enregistrer au format PDF ».
      </p>`,
    onClose: () => { if (blobUrl) URL.revokeObjectURL(blobUrl); },
    actions: [
      { label: "Fermer", variant: "secondary" },
      {
        label: "Ouvrir à part", variant: "secondary", closes: false,
        onClick: () => {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
          const w = window.open(blobUrl, "_blank", "noopener");
          if (!w) ui.toast("Autorisez les fenêtres pour ouvrir la facture à part.", "error");
          return false;
        }
      },
      {
        label: "Imprimer / PDF", variant: "primary", closes: false,
        onClick: () => {
          const frame = api.body.querySelector("#invFrame");
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          } catch {
            ui.toast("Impression impossible ici. Utilisez « Ouvrir à part ».", "error");
          }
          return false;
        }
      }
    ]
  });

  api.body.querySelector("#invFrame").srcdoc = html;
  return api;
}

/* ============================================================
   Construction du document
   ============================================================ */
export function buildInvoiceHtml(sale, ctx) {
  const { ui } = ctx;
  const { esc, money, num } = ui;
  const p = ctx.profile || {};
  const biz = p.businessName || "Mon commerce";
  const origin = location.origin;

  const items = Array.isArray(sale.items) ? sale.items : [];
  const total = Number(sale.total) || 0;
  const paid = Math.min(Number(sale.paid) || 0, total);
  const remaining = Math.max(Math.round((total - paid) * 100) / 100, 0);
  const cancelled = sale.status === "cancelled";
  const isCredit = sale.status === "credit";

  const date = (() => {
    const d = sale.createdAt?.toDate ? sale.createdAt.toDate() : sale.createdAt ? new Date(sale.createdAt) : new Date();
    return isNaN(d) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  })();

  const rows = items.map((i) => {
    const q = Number(i.qty) || 0, pr = Number(i.price) || 0;
    return `<tr>
      <td>${esc(i.name)}</td>
      <td class="r">${esc(num(q, 2))}</td>
      <td class="r">${esc(money(pr))}</td>
      <td class="r b">${esc(money(q * pr))}</td>
    </tr>`;
  }).join("");

  const status = cancelled
    ? '<span class="st st-x">Annulée</span>'
    : isCredit ? '<span class="st st-w">À crédit</span>'
    : '<span class="st st-ok">Payée</span>';

  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Facture ${esc(sale.invoiceNo || "")} — ${esc(biz)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 24px; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Inter, Arial, sans-serif; color: #1A1330; background: #fff; position: relative; }
  .sheet { max-width: 760px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 18px; border-bottom: 3px solid #5B3FE0; }
  .brand { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .brand img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; }
  .brand h1 { margin: 0; font-size: 20px; line-height: 1.2; overflow-wrap: anywhere; }
  .muted { color: #6B6478; font-size: 12.5px; }
  .doc { text-align: right; flex-shrink: 0; }
  .doc h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: .06em; text-transform: uppercase; color: #5B3FE0; }
  .doc div { font-size: 13px; }
  .st { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .st-ok { background: #E8F7F0; color: #1E9E6B; }
  .st-w { background: #FDF3E4; color: #C77B12; }
  .st-x { background: #FBEAE8; color: #D8402F; }
  .parties { display: flex; justify-content: space-between; gap: 20px; margin: 20px 0; }
  .parties h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6B6478; }
  .parties p { margin: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; padding: 9px 10px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #6B6478; background: #F4F2FA; }
  tbody td { padding: 10px; border-bottom: 1px solid #E9E7F2; vertical-align: top; overflow-wrap: anywhere; }
  .r { text-align: right; white-space: nowrap; }
  .b { font-weight: 600; }
  tr { page-break-inside: avoid; }
  .totals { margin: 16px 0 0 auto; width: min(100%, 320px); }
  .totals div { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
  .totals .grand { margin-top: 6px; padding-top: 10px; border-top: 2px solid #1A1330; font-size: 17px; font-weight: 700; }
  .totals .due { color: #D8402F; font-weight: 700; }
  .note { margin-top: 20px; padding: 10px 12px; background: #F4F2FA; border-radius: 6px; font-size: 13px; overflow-wrap: anywhere; }
  .foot { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E9E7F2; text-align: center; }
  ${cancelled ? `.wm { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 84px; font-weight: 800; letter-spacing: .1em; color: rgba(216,64,47,.14); transform: rotate(-18deg); pointer-events: none; }` : ""}
  @media (max-width: 520px) {
    body { padding: 14px; }
    .head, .parties { flex-direction: column; }
    .doc { text-align: left; }
    thead th, tbody td { padding: 8px 6px; font-size: 12.5px; }
  }
  @media print { body { padding: 0; } }
</style></head>
<body>
  ${cancelled ? '<div class="wm">ANNULÉE</div>' : ""}
  <div class="sheet">
    <div class="head">
      <div class="brand">
        <img src="${esc(origin)}/logo.webp" alt="" onerror="this.style.display='none'" />
        <div>
          <h1>${esc(biz)}</h1>
          ${p.address ? `<div class="muted">${esc(p.address)}</div>` : ""}
          ${p.phone ? `<div class="muted">Tél. ${esc(p.phone)}</div>` : ""}
        </div>
      </div>
      <div class="doc">
        <h2>Facture</h2>
        <div><strong>${esc(sale.invoiceNo || "")}</strong></div>
        <div class="muted">${esc(date)}</div>
        ${status}
      </div>
    </div>

    <div class="parties">
      <div>
        <h3>Facturé à</h3>
        <p><strong>${esc(sale.customerName || "Client comptoir")}</strong></p>
        ${sale.customerPhone ? `<p class="muted">${esc(sale.customerPhone)}</p>` : ""}
      </div>
    </div>

    <table>
      <thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">Prix unitaire</th><th class="r">Montant</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">Aucun article</td></tr>'}</tbody>
    </table>

    <div class="totals">
      <div class="grand"><span>Total</span><span>${esc(money(total))}</span></div>
      ${isCredit || (paid > 0 && paid < total) ? `
        <div><span>Déjà payé</span><span>${esc(money(paid))}</span></div>
        <div class="due"><span>Reste à payer</span><span>${esc(money(remaining))}</span></div>` : ""}
    </div>

    ${sale.note ? `<div class="note"><strong>Note :</strong> ${esc(sale.note)}</div>` : ""}

    <div class="foot muted">Merci pour votre confiance · ${esc(biz)}<br />Facture établie avec Kontra-Africa</div>
  </div>
</body></html>`;
}
