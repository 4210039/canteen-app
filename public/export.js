/* ═══════════════════════════════════════════════════════════
   export.js – Universal Export Feature
   Formats: CSV, XLSX, JSON, XML, PDF, Word (.docx)

   Libraries:
   - XLSX  (SheetJS)  — already loaded for import
   - jsPDF            — loaded via CDN in index.html
   - docx             — loaded via CDN in index.html
   JSON + XML use zero libraries (native browser APIs only).

   Design rules:
   - Non-blocking: never mutates STATE, only reads it
   - Filename always includes section + ISO date
   - Modal reuses all .import-* CSS classes; no new styles needed
   - escHtml() is global from import.js; not redefined here
═══════════════════════════════════════════════════════════ */

// ── Section config ────────────────────────────────────────
const EXPORT_CONFIG = {
  menu: {
    title:    '📋 Export – Jídelníček',
    filename: 'jidelnicek',
    describe: 'Exportuje aktuální týdenní jídelníček (den, jídlo, pokrm).',
    headers:  ['Den', 'Datum', 'Jídlo', 'Pokrm'],
    build:    buildMenuRows,
    pdfTitle: 'Týdenní jídelníček',
    docTitle: 'Jídelníček MŠ Harmonie',
  },
  attendance: {
    title:    '👦 Export – Docházka',
    filename: 'dochazka',
    describe: 'Exportuje docházku ze všech uložených týdnů.',
    headers:  ['Týden', 'Den', 'Jídlo', 'Počet dětí'],
    build:    buildAttendanceRows,
    pdfTitle: 'Docházka dětí',
    docTitle: 'Docházka dětí – MŠ Harmonie',
  },
  offers: {
    title:    '🏷️ Export – Nákupní seznam',
    filename: 'nakupni-seznam',
    describe: 'Exportuje aktuální nákupní seznam (položky, množství, ceny).',
    headers:  ['Surovina', 'Skupina potravin', 'Množství', 'Jednotka', 'Cena (Kč)', 'Dodavatel', 'Akce'],
    build:    buildOffersRows,
    pdfTitle: 'Nákupní seznam',
    docTitle: 'Nákupní seznam – MŠ Harmonie',
  },
  warehouse: {
    title:    '📦 Export – Sklad',
    filename: 'sklad',
    describe: 'Exportuje celou historii pohybů skladu (příjmy a výdeje).',
    headers:  ['Typ', 'Surovina', 'Skupina potravin', 'Množství', 'Jednotka', 'Gramy', 'Cena (Kč)', 'Dodavatel', 'Akce', 'Týden', 'Zdroj', 'Datum'],
    build:    buildWarehouseRows,
    pdfTitle: 'Skladová evidence',
    docTitle: 'Skladová evidence – MŠ Harmonie',
  },
  finance: {
    title:    '📊 Export – Finance',
    filename: 'finance',
    describe: 'Exportuje týdenní přehled nákladů.',
    headers:  ['Týden', 'Celkem (Kč)', 'Akčních položek', 'Příjmů celkem'],
    build:    buildFinanceRows,
    pdfTitle: 'Finanční přehled',
    docTitle: 'Finanční přehled – MŠ Harmonie',
  },
  norms: {
    title:    '⚖️ Export – Normy',
    filename: 'normy',
    describe: 'Exportuje referenční tabulku výživových norem (Vyhl. č. 107/2005 Sb.).',
    headers:  ['Skupina potravin', 'Kód', 'Dospělý g/den (100%)', 'MŠ 3–6 let g/den (60%)', 'Min. tolerance', 'Max. tolerance'],
    build:    buildNormsRows,
    pdfTitle: 'Výživové normy – Spotřební koš',
    docTitle: 'Výživové normy – Vyhl. č. 107/2005 Sb.',
  },
};

// ── State ─────────────────────────────────────────────────
let _exportSection = null;
let _exportFilter  = 'all'; // warehouse only: 'all' | 'in' | 'out'

// ── Open / Close ──────────────────────────────────────────
function openExport(section) {
  _exportSection = section;
  _exportFilter  = 'all';

  const cfg = EXPORT_CONFIG[section];
  if (!cfg) { console.error('Unknown export section:', section); return; }

  document.getElementById('exportTitle').textContent       = cfg.title;
  document.getElementById('exportDescription').textContent = cfg.describe;

  const filterRow = document.getElementById('exportFilterRow');
  if (filterRow) filterRow.style.display = section === 'warehouse' ? '' : 'none';

  const filterSel = document.getElementById('exportWarehouseFilter');
  if (filterSel) filterSel.value = 'all';

  refreshExportPreview();
  document.getElementById('exportOverlay').classList.remove('hidden');
}

function closeExport() {
  document.getElementById('exportOverlay').classList.add('hidden');
}

function closeExportOnBackdrop(e) {
  if (e.target === document.getElementById('exportOverlay')) closeExport();
}

// ── Preview ───────────────────────────────────────────────
function refreshExportPreview() {
  const cfg = EXPORT_CONFIG[_exportSection];
  if (!cfg) return;

  const rows   = cfg.build(_exportFilter);
  const countEl = document.getElementById('exportRowCount');
  const tableEl = document.getElementById('exportPreviewTable');

  countEl.textContent = rows.length ? `${rows.length} řádků dat` : 'Žádná data k exportu';

  const maxRows = Math.min(rows.length, 5);
  let html = '<tr>' + cfg.headers.map(h => `<th>${escHtml(h)}</th>`).join('') + '</tr>';
  for (let i = 0; i < maxRows; i++) {
    html += '<tr>' + (rows[i] || []).map(c =>
      `<td>${escHtml(String(c ?? ''))}</td>`).join('') + '</tr>';
  }
  if (rows.length > maxRows) {
    html += `<tr><td colspan="${cfg.headers.length}"
      style="text-align:center;color:var(--ink-light);font-size:.78rem">
      … a dalších ${rows.length - maxRows} řádků</td></tr>`;
  }
  tableEl.innerHTML = html;

  const empty = rows.length === 0;
  ['btnExportCsv','btnExportXlsx','btnExportJson',
   'btnExportXml','btnExportPdf','btnExportDocx'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = empty;
  });
}

// ── Row builders ──────────────────────────────────────────

function buildMenuRows() {
  if (!STATE.currentMenu?.days?.length) return [];
  const rows = [];
  for (const day of STATE.currentMenu.days) {
    for (const meal of (day.meals || [])) {
      rows.push([day.name, day.date || '', meal.label, meal.dish]);
    }
  }
  return rows;
}

function buildAttendanceRows() {
  const data = (typeof attendanceData !== 'undefined' && Object.keys(attendanceData).length)
    ? attendanceData
    : JSON.parse(localStorage.getItem('canteen_attendance') || '{}');

  const DAYS_LABELS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
  const MEAL_LABELS = { presnidavka: 'Přesnídávka', obed: 'Oběd', svacina: 'Svačina' };
  const rows = [];

  for (const week of Object.keys(data).sort()) {
    const weekData = data[week] || {};
    for (let d = 0; d < 5; d++) {
      const dayData = weekData[d] || {};
      for (const [mealKey, mealLabel] of Object.entries(MEAL_LABELS)) {
        const count = dayData[mealKey];
        if (count !== undefined && count !== null) {
          rows.push([week, DAYS_LABELS[d] || `Den ${d + 1}`, mealLabel, count]);
        }
      }
    }
  }
  return rows;
}

function buildOffersRows() {
  return (STATE.cart || [])
    .filter(i => !i._skip)
    .map(i => [i.name, i.foodGroup || '', i.qty, i.unit,
               i.price || 0, i.store || '', i.promo ? 'Ano' : 'Ne']);
}

function buildWarehouseRows(filter) {
  const ledger   = STATE.ledger || [];
  const filtered = filter === 'all' ? ledger : ledger.filter(e => e.type === filter);
  return [...filtered]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(e => [
      e.type === 'in' ? 'Příjem' : 'Výdej',
      e.name, e.foodGroup || '', e.qty, e.unit, e.grams || 0,
      e.price || 0, e.store || '', e.promo ? 'Ano' : 'Ne',
      e.weekKey || '', e.source || '',
      e.date ? new Date(e.date).toLocaleDateString('cs-CZ') : '',
    ]);
}

function buildFinanceRows() {
  const weekMap = {};
  for (const e of (STATE.ledger || []).filter(e => e.type === 'in')) {
    if (!weekMap[e.weekKey]) weekMap[e.weekKey] = { total: 0, promoCount: 0, count: 0 };
    weekMap[e.weekKey].total      += e.price || 0;
    weekMap[e.weekKey].promoCount += e.promo ? 1 : 0;
    weekMap[e.weekKey].count      += 1;
  }
  return Object.entries(weekMap)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, d]) => [week, d.total.toFixed(2), d.promoCount, d.count]);
}

function buildNormsRows() {
  const N = window.NORMS;
  if (!N?.foodGroups) return [];
  const msAge = N.ageGroups?.ms_3_6 || { pct: 0.60 };
  return Object.entries(N.foodGroups).map(([key, g]) => [
    g.label, key, g.adultDay,
    Math.round(g.adultDay * msAge.pct),
    (g.min * 100) + ' %', (g.max * 100) + ' %',
  ]);
}

// ── CSV ───────────────────────────────────────────────────
function doExportCsv() {
  const cfg  = EXPORT_CONFIG[_exportSection];
  const rows = cfg.build(_exportFilter);
  if (!rows.length) { toast('Žádná data k exportu.', 'info'); return; }

  const BOM   = '\uFEFF';
  const lines = [cfg.headers, ...rows].map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );

  triggerDownload(
    new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }),
    `${cfg.filename}-${isoDate()}.csv`
  );
  toast(`Exportováno ${rows.length} řádků jako CSV.`, 'success');
  closeExport();
}

// ── XLSX ──────────────────────────────────────────────────
function doExportXlsx() {
  if (typeof XLSX === 'undefined') {
    toast('SheetJS není dostupný. Použijte CSV export.', 'error'); return;
  }
  const cfg    = EXPORT_CONFIG[_exportSection];
  const rows   = cfg.build(_exportFilter);
  if (!rows.length) { toast('Žádná data k exportu.', 'info'); return; }

  const wsData = [cfg.headers, ...rows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols']  = cfg.headers.map((h, ci) => ({
    wch: Math.min(40, wsData.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), h.length) + 2),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.filename.slice(0, 31));
  XLSX.writeFile(wb, `${cfg.filename}-${isoDate()}.xlsx`);
  toast(`Exportováno ${rows.length} řádků jako XLSX.`, 'success');
  closeExport();
}

// ── JSON ──────────────────────────────────────────────────
function doExportJson() {
  const cfg  = EXPORT_CONFIG[_exportSection];
  const rows = cfg.build(_exportFilter);
  if (!rows.length) { toast('Žádná data k exportu.', 'info'); return; }

  // Convert flat row arrays into keyed objects using headers as keys
  const objects = rows.map(row =>
    Object.fromEntries(cfg.headers.map((h, i) => [h, row[i] ?? '']))
  );

  const payload = {
    section:     _exportSection,
    exportedAt:  new Date().toISOString(),
    rowCount:    objects.length,
    data:        objects,
  };

  triggerDownload(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' }),
    `${cfg.filename}-${isoDate()}.json`
  );
  toast(`Exportováno ${rows.length} záznamů jako JSON.`, 'success');
  closeExport();
}

// ── XML ───────────────────────────────────────────────────
function doExportXml() {
  const cfg  = EXPORT_CONFIG[_exportSection];
  const rows = cfg.build(_exportFilter);
  if (!rows.length) { toast('Žádná data k exportu.', 'info'); return; }

  // Sanitize header → valid XML element name:
  // replace spaces/special chars with underscore, strip diacritics
  function toXmlTag(str) {
    return str
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^([0-9])/, '_$1');                       // can't start with digit
  }

  function xmlEscape(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const tags  = cfg.headers.map(toXmlTag);
  const rootTag = toXmlTag(_exportSection);
  const itemTag = 'zaznam';

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${rootTag} exportedAt="${xmlEscape(new Date().toISOString())}" rowCount="${rows.length}">`,
    ...rows.map(row =>
      `  <${itemTag}>` +
      tags.map((tag, i) => `<${tag}>${xmlEscape(row[i])}</${tag}>`).join('') +
      `</${itemTag}>`
    ),
    `</${rootTag}>`,
  ];

  triggerDownload(
    new Blob([lines.join('\n')], { type: 'application/xml;charset=utf-8;' }),
    `${cfg.filename}-${isoDate()}.xml`
  );
  toast(`Exportováno ${rows.length} záznamů jako XML.`, 'success');
  closeExport();
}

// ── PDF ───────────────────────────────────────────────────
function doExportPdf() {
  if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
    toast('jsPDF není dostupný. Zkontrolujte připojení k internetu a obnovte stránku.', 'error');
    return;
  }

  const cfg  = EXPORT_CONFIG[_exportSection];
  const rows = cfg.build(_exportFilter);
  if (!rows.length) { toast('Žádná data k exportu.', 'info'); return; }

  const { jsPDF: JsPDF } = window.jspdf || { jsPDF };
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(cfg.pdfTitle, 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`MŠ Harmonie · Exportováno: ${new Date().toLocaleDateString('cs-CZ')}`, 14, 22);
  doc.setTextColor(0);

  // Table via jsPDF-AutoTable (bundled with jsPDF UMD build)
  if (doc.autoTable) {
    doc.autoTable({
      head:       [cfg.headers],
      body:       rows.map(r => r.map(c => String(c ?? ''))),
      startY:     28,
      styles:     { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [46, 125, 50], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [232, 245, 233] },
      margin:     { left: 14, right: 14 },
    });
  } else {
    // Fallback: plain text table if autoTable not available
    let y = 32;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(cfg.headers.join('  |  '), 14, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    for (const row of rows) {
      if (y > 195) { doc.addPage(); y = 14; }
      doc.text(row.map(c => String(c ?? '').slice(0, 18)).join('  |  '), 14, y);
      y += 5;
    }
  }

  doc.save(`${cfg.filename}-${isoDate()}.pdf`);
  toast(`Exportováno jako PDF.`, 'success');
  closeExport();
}

// ── Word (.docx) ──────────────────────────────────────────
function doExportDocx() {
  if (typeof docx === 'undefined') {
    toast('Knihovna docx není dostupná. Zkontrolujte připojení k internetu a obnovte stránku.', 'error');
    return;
  }

  const cfg  = EXPORT_CONFIG[_exportSection];
  const rows = cfg.build(_exportFilter);
  if (!rows.length) { toast('Žádná data k exportu.', 'info'); return; }

  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell,
    TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  } = docx;

  // Header row (bold, green background)
  const headerCells = cfg.headers.map(h =>
    new TableCell({
      shading: { fill: '2E7D32' },
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 18 })],
      })],
    })
  );

  // Data rows
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map(cell =>
        new TableCell({
          shading: { fill: ri % 2 === 0 ? 'F1F8E9' : 'FFFFFF' },
          children: [new Paragraph({
            children: [new TextRun({ text: String(cell ?? ''), size: 16 })],
          })],
        })
      ),
    })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: headerCells }), ...dataRows],
  });

  const doc2 = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: cfg.docTitle,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({
            text: `MŠ Harmonie · Exportováno: ${new Date().toLocaleDateString('cs-CZ')} · ${rows.length} záznamů`,
            color: '666666',
            size: 16,
            italics: true,
          })],
          spacing: { after: 300 },
        }),
        table,
      ],
    }],
  });

  Packer.toBlob(doc2).then(blob => {
    triggerDownload(blob, `${cfg.filename}-${isoDate()}.docx`);
    toast(`Exportováno jako Word dokument (.docx).`, 'success');
    closeExport();
  }).catch(err => {
    toast('Chyba při vytváření Word dokumentu: ' + err.message, 'error');
  });
}

// ── Shared helpers ────────────────────────────────────────
function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Init ─────────────────────────────────────────────────
function initExport() {
  document.getElementById('exportOverlay')
    ?.addEventListener('click', closeExportOnBackdrop);

  document.getElementById('exportWarehouseFilter')
    ?.addEventListener('change', e => {
      _exportFilter = e.target.value;
      refreshExportPreview();
    });

  const bindings = {
    btnExportCsv:  doExportCsv,
    btnExportXlsx: doExportXlsx,
    btnExportJson: doExportJson,
    btnExportXml:  doExportXml,
    btnExportPdf:  doExportPdf,
    btnExportDocx: doExportDocx,
  };
  for (const [id, fn] of Object.entries(bindings)) {
    document.getElementById(id)?.addEventListener('click', fn);
  }
}
