const encoder = new TextEncoder();

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MIME = 'application/pdf';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  let total = 0;
  parts.forEach((p) => {
    total += p.length;
  });
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
}

function buildZip(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  });

  const centralBytes = concat(centrals);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBytes.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concat(locals.concat([centralBytes, end]));
}

function xmlEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetName(value) {
  const clean = String(value || 'Feuille').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31);
  return clean || 'Feuille';
}

function textCell(ref, value, style) {
  return '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
}

function numberCell(ref, value, style) {
  return '<c r="' + ref + '" s="' + style + '"><v>' + String(value) + '</v></c>';
}

function buildSheetXml(spec) {
  const columns = spec.columns;
  const cols = columns
    .map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (Number(c.width) || 14) + '" customWidth="1"/>')
    .join('');

  const rows = [];
  rows.push(
    '<row r="1" ht="22" customHeight="1">' +
      columns.map((c, i) => textCell(columnLetter(i) + '1', c.header, 1)).join('') +
      '</row>'
  );

  const writeRow = (values, rowNumber, bold) => {
    const cells = [];
    columns.forEach((c, i) => {
      const value = values[i];
      const ref = columnLetter(i) + rowNumber;
      if (value === undefined || value === null || value === '') return;
      if (c.number && Number.isFinite(Number(value))) cells.push(numberCell(ref, Number(value), bold ? 4 : 2));
      else cells.push(textCell(ref, value, bold ? 3 : 0));
    });
    rows.push('<row r="' + rowNumber + '">' + cells.join('') + '</row>');
  };

  let rowNumber = 2;
  spec.rows.forEach((values) => {
    writeRow(values, rowNumber, false);
    rowNumber += 1;
  });
  if (spec.totalRow) writeRow(spec.totalRow, rowNumber, true);

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' + cols + '</cols>' +
    '<sheetData>' + rows.join('') + '</sheetData>' +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF0B6B4F"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="3" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

export function buildXlsx(spec) {
  const name = sheetName(spec.sheetName);
  const files = [
    {
      name: '[Content_Types].xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>'
      )
    },
    {
      name: '_rels/.rels',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'
      )
    },
    {
      name: 'xl/workbook.xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="' + xmlEscape(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>'
      )
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'
      )
    },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(buildSheetXml(spec)) }
  ];
  return buildZip(files);
}

const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const CP1252 = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f
};

function toWinAnsi(text) {
  const bytes = [];
  Array.from(String(text === undefined || text === null ? '' : text)).forEach((ch) => {
    const cp = ch.codePointAt(0);
    if (cp === 0x202f || cp === 0x00a0 || cp === 0x09 || cp === 0x0a || cp === 0x0d) bytes.push(0x20);
    else if (cp < 0x20) return;
    else if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (CP1252[cp]) bytes.push(CP1252[cp]);
    else bytes.push(0x3f);
  });
  return bytes;
}

function charWidth(byte) {
  if (byte >= 32 && byte <= 126) return WIDTHS[byte - 32];
  if (byte >= 0xc0 && byte <= 0xc5) return 667;
  if (byte >= 0xc8 && byte <= 0xcb) return 667;
  if (byte >= 0xcc && byte <= 0xcf) return 278;
  if (byte >= 0xd2 && byte <= 0xd6) return 778;
  if (byte >= 0xd9 && byte <= 0xdc) return 722;
  if (byte >= 0xe0 && byte <= 0xe5) return 556;
  if (byte >= 0xe8 && byte <= 0xeb) return 556;
  if (byte >= 0xec && byte <= 0xef) return 278;
  if (byte >= 0xf2 && byte <= 0xf6) return 556;
  if (byte >= 0xf9 && byte <= 0xfc) return 556;
  if (byte === 0xe7) return 500;
  if (byte === 0xc7) return 722;
  if (byte === 0x92 || byte === 0x91) return 222;
  if (byte === 0x93 || byte === 0x94) return 333;
  if (byte === 0x9c) return 889;
  if (byte === 0x85) return 1000;
  return 556;
}

function bytesWidth(bytes, size, bold) {
  let total = 0;
  bytes.forEach((b) => {
    total += charWidth(b);
  });
  return (total * size * (bold ? 1.07 : 1)) / 1000;
}

function fitText(text, size, bold, maxWidth) {
  const bytes = toWinAnsi(text);
  if (bytesWidth(bytes, size, bold) <= maxWidth) return bytes;
  const dots = [0x2e, 0x2e, 0x2e];
  const out = bytes.slice();
  while (out.length && bytesWidth(out.concat(dots), size, bold) > maxWidth) out.pop();
  while (out.length && out[out.length - 1] === 0x20) out.pop();
  return out.concat(dots);
}

function pdfString(bytes) {
  let out = '(';
  bytes.forEach((b) => {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  });
  return out + ')';
}

function num(n) {
  return (Math.round(n * 100) / 100).toString();
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value === undefined || value === null ? '' : value);
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n).replace(/[\u202f\u00a0]/g, ' ');
}

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const HEADER_H = 24;
const ROW_H = 19;
const FOOTER_H = 30;
const PAD = 6;
const NAVY = '0.059 0.09 0.165';
const GREEN = '0.043 0.42 0.31';
const GREY = '0.4 0.45 0.52';
const ZEBRA = '0.945 0.965 0.957';

export function buildPdf(spec) {
  const columns = spec.columns;
  const available = PAGE_W - MARGIN * 2;
  const weight = columns.reduce((sum, c) => sum + (Number(c.width) || 14), 0);
  const widths = columns.map((c) => ((Number(c.width) || 14) / weight) * available);
  const lefts = [];
  let acc = MARGIN;
  widths.forEach((w) => {
    lefts.push(acc);
    acc += w;
  });

  const pages = [];
  let ops = null;
  let y = 0;

  const text = (bytes, x, baseline, size, bold, color) => {
    ops.push(color + ' rg BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + num(x) + ' ' + num(baseline) + ' Td ' + pdfString(bytes) + ' Tj ET');
  };

  const rect = (x, bottom, w, h, color) => {
    ops.push(color + ' rg ' + num(x) + ' ' + num(bottom) + ' ' + num(w) + ' ' + num(h) + ' re f');
  };

  const cell = (value, index, baseline, bold, color) => {
    const col = columns[index];
    const raw = col.number && value !== '' && value !== null && value !== undefined ? formatNumber(value) : value;
    const max = widths[index] - PAD * 2;
    const bytes = fitText(raw, 9, bold, max);
    const w = bytesWidth(bytes, 9, bold);
    const x = col.number ? lefts[index] + widths[index] - PAD - w : lefts[index] + PAD;
    text(bytes, x, baseline, 9, bold, color);
  };

  const header = () => {
    rect(MARGIN, y - HEADER_H, available, HEADER_H, GREEN);
    columns.forEach((c, i) => {
      const max = widths[i] - PAD * 2;
      const bytes = fitText(c.header, 9, true, max);
      const w = bytesWidth(bytes, 9, true);
      const x = c.number ? lefts[i] + widths[i] - PAD - w : lefts[i] + PAD;
      text(bytes, x, y - 16, 9, true, '1 1 1');
    });
    y -= HEADER_H;
  };

  const newPage = (first) => {
    ops = [];
    pages.push(ops);
    y = PAGE_H - MARGIN;
    if (first) {
      text(toWinAnsi(spec.title || ''), MARGIN, y - 18, 18, true, GREEN);
      y -= 28;
      if (spec.subtitle) {
        text(fitText(spec.subtitle, 10, false, available), MARGIN, y - 10, 10, false, GREY);
        y -= 24;
      } else y -= 6;
    }
    header();
  };

  newPage(true);
  const bottomLimit = MARGIN + FOOTER_H;

  spec.rows.forEach((values, rowIndex) => {
    if (y - ROW_H < bottomLimit) newPage(false);
    if (rowIndex % 2 === 1) rect(MARGIN, y - ROW_H, available, ROW_H, ZEBRA);
    columns.forEach((_c, i) => cell(values[i], i, y - 13, false, NAVY));
    y -= ROW_H;
  });

  if (spec.totalRow) {
    if (y - ROW_H - 4 < bottomLimit) newPage(false);
    rect(MARGIN, y - 1.5, available, 1.5, GREEN);
    columns.forEach((_c, i) => cell(spec.totalRow[i], i, y - 15, true, NAVY));
    y -= ROW_H + 4;
  }

  if (!spec.rows.length) {
    text(toWinAnsi('Aucune donnée pour cette période.'), MARGIN + PAD, y - 18, 10, false, GREY);
  }

  const total = pages.length;
  pages.forEach((pageOps, index) => {
    ops = pageOps;
    const label = toWinAnsi('Kontra Africa  -  Page ' + (index + 1) + ' / ' + total);
    text(label, MARGIN, MARGIN - 8, 8, false, GREY);
    const stamp = toWinAnsi(spec.footer || '');
    text(stamp, PAGE_W - MARGIN - bytesWidth(stamp, 8, false), MARGIN - 8, 8, false, GREY);
  });

  const objects = [];
  const pageIds = pages.map((_p, i) => 5 + i * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((pageOps, i) => {
    const contentId = 6 + i * 2;
    const stream = pageOps.join('\n');
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentId + ' 0 R >>'
    );
    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  });

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += i + 1 + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach((o) => {
    out += String(o).padStart(10, '0') + ' 00000 n \n';
  });
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export function fileSafe(value) {
  return String(value || 'export')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function downloadBlob(bytes, name, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
