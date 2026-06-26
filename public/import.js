/* ═══════════════════════════════════════════════════════════
   import.js – Universal Import Feature
   Supports: CSV, TXT, XLSX/XLS (via SheetJS), DOCX (via mammoth.js),
   PDF (via pdf.js), plain text paste, and a full-app JSON backup
   restore ('backup' section).
   DOCX/PDF text extraction happens entirely in the browser — the file
   never leaves the device. Scanned/image-only PDFs and legacy .doc
   files have no extractable text layer and fall back to manual paste.
═══════════════════════════════════════════════════════════ */

// ── Limits ──────────────────────────────────────────────────
// Guards against freezing the tab on a pathological file. CSV/XLSX
// rows are cheap; this is generous for a single-canteen use case.
const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const IMPORT_MAX_ROWS       = 20000;            // data rows, header excluded

// ── State ────────────────────────────────────────────────
let _importSection = null;   // 'menu' | 'attendance' | 'offers' | 'warehouse' | 'finance' | 'norms' | 'backup'
let _importRows    = [];     // array of arrays (header = row[0])
let _importIsText  = false;  // true when raw text (no column structure)
let _importRawText = '';
let _importErrors  = [];     // structured per-row errors: {row, field, reason}[] — shown in UI, not just console

// ── Section config ────────────────────────────────────────
const IMPORT_CONFIG = {
  menu: {
    title: '📋 Import – Jídelníček',
    mode: 'text',
    hint: 'Vložte text jídelníčku. Bude automaticky analyzován pomocí AI.',
  },
  attendance: {
    title: '👦 Import – Docházka',
    mode: 'csv',
    // NOTE: keys here must match MEALS_LIST in app.js (presnidavka/obed/svacina) —
    // attendanceData is keyed by these exact strings; a mismatch silently
    // writes data that never renders or counts toward totals.
    fields: [
      { key: 'date',        label: 'Datum',                  required: true  },
      { key: 'obed',        label: 'Oběd – počet dětí',       required: true  },
      { key: 'presnidavka', label: 'Přesnídávka – počet dětí',required: false },
      { key: 'svacina',     label: 'Svačina – počet dětí',    required: false },
    ],
    hint: 'Každý sloupec vašeho souboru přiřaďte k jednomu poli vlevo. ' +
      'Datum musí být ve formátu DD.MM.RRRR (např. 12.3.2026) nebo RRRR-MM-DD — ' +
      'řádky s víkendovým datem se přeskočí, docházka se eviduje jen Po–Pá. ' +
      'Přesnídávka a svačina jsou nepovinné, klidně je nechte „– nevybráno –", pokud je nesledujete.',
  },
  offers: {
    title: '🏷️ Import – Akce & Nákup',
    mode: 'csv',
    fields: [
      { key: 'name',  label: 'Název suroviny',  required: true  },
      { key: 'qty',   label: 'Množství',        required: true  },
      { key: 'unit',  label: 'Jednotka',        required: false },
      { key: 'price', label: 'Cena (Kč)',       required: false },
      { key: 'store', label: 'Dodavatel/obchod',required: false },
    ],
    hint: 'CSV sloupce: název, množství, jednotka, cena, dodavatel',
  },
  warehouse: {
    title: '📦 Import – Sklad',
    mode: 'csv',
    fields: [
      { key: 'type',  label: 'Typ (in/out)',    required: false },
      { key: 'name',  label: 'Název suroviny',  required: true  },
      { key: 'qty',   label: 'Množství',        required: true  },
      { key: 'unit',  label: 'Jednotka',        required: false },
      { key: 'price', label: 'Cena (Kč)',       required: false },
      { key: 'store', label: 'Dodavatel/obchod',required: false },
      { key: 'date',  label: 'Datum',           required: false },
    ],
    hint: 'CSV sloupce: typ, název, množství, jednotka, cena, dodavatel, datum',
  },
  finance: {
    title: '📊 Import – Finance (→ Sklad)',
    mode: 'csv',
    fields: [
      { key: 'name',  label: 'Název suroviny',  required: true  },
      { key: 'qty',   label: 'Množství',        required: true  },
      { key: 'unit',  label: 'Jednotka',        required: false },
      { key: 'price', label: 'Cena (Kč)',       required: false },
      { key: 'store', label: 'Dodavatel/obchod',required: false },
      { key: 'date',  label: 'Datum',           required: false },
    ],
    hint: 'Finanční záznamy budou přidány jako příjmy do Skladu. CSV sloupce: název, množství, jednotka, cena, dodavatel, datum',
  },
  norms: {
    title: '⚖️ Import – Normy',
    mode: 'text',
    hint: 'Vložte text norem nebo tabulky výživových hodnot. Data budou zobrazena pro ruční přepis.',
  },
  backup: {
    title: '💾 Obnovení ze zálohy',
    mode: 'backup',
    hint: 'Vyberte soubor zálohy (.json) vytvořený tlačítkem „Stáhnout úplnou zálohu" v Nastavení.',
  },
};

// ── Open / Close ─────────────────────────────────────────
function openImport(section) {
  _importSection = section;
  _importRows    = [];
  _importIsText  = false;
  _importRawText = '';
  _importErrors  = [];

  const cfg = IMPORT_CONFIG[section];
  document.getElementById('importTitle').textContent = cfg.title;
  document.getElementById('importOverlay').classList.remove('hidden');

  // Reset UI
  switchImportSrc('file');
  document.getElementById('importFileInfo').classList.add('hidden');
  document.getElementById('importFileInfo').innerHTML = '';
  document.getElementById('importMappingPane').classList.add('hidden');
  document.getElementById('importPreviewPane').classList.add('hidden');
  document.getElementById('importPasteArea').value = '';
  document.getElementById('importFileInput').value = '';
  document.getElementById('btnDoImport').disabled = true;
  renderImportErrors();

  const dropZone = document.getElementById('importDropZone');
  const pasteTab = document.querySelector('.import-src-tab[data-src="paste"]');

  if (cfg.mode === 'backup') {
    // Backup restore is file-only (JSON) — pasting a backup makes no sense
    pasteTab?.classList.add('hidden');
    dropZone.querySelector('.drop-hint').textContent = 'JSON (soubor zálohy)';
    document.getElementById('importFileInput').accept = '.json';
  } else {
    pasteTab?.classList.remove('hidden');
    document.getElementById('importFileInput').accept = '.csv,.txt,.xlsx,.xls,.docx,.pdf,.json';
    dropZone.querySelector('.drop-hint').textContent =
      'CSV · XLSX · XLS · TXT · DOCX · PDF';
  }

  // For text-mode sections, default to paste tab
  if (cfg.mode === 'text') {
    switchImportSrc('paste');
  }
}

function closeImport() {
  document.getElementById('importOverlay').classList.add('hidden');
}

function closeImportOnBackdrop(e) {
  if (e.target === document.getElementById('importOverlay')) closeImport();
}

function switchImportSrc(src) {
  document.querySelectorAll('.import-src-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.src === src));
  document.getElementById('importFilePane').classList.toggle('hidden', src !== 'file');
  document.getElementById('importPastePane').classList.toggle('hidden', src !== 'paste');
}

// ── Drag & Drop ───────────────────────────────────────────
function importDragOver(e) {
  e.preventDefault();
  document.getElementById('importDropZone').classList.add('drag-over');
}
function importDragLeave(e) {
  document.getElementById('importDropZone').classList.remove('drag-over');
}
function importDrop(e) {
  e.preventDefault();
  document.getElementById('importDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) importFileSelected(file);
}

// ── File parsing ──────────────────────────────────────────
async function importFileSelected(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const info = document.getElementById('importFileInfo');
  info.classList.remove('hidden');
  info.innerHTML = `<span class="muted">📄 ${escHtml(file.name)} · ${(file.size/1024).toFixed(1)} KB</span>`;

  if (file.size > IMPORT_MAX_FILE_BYTES) {
    info.innerHTML += `<br><span class="import-error">❌ Soubor je příliš velký
      (${(file.size/1024/1024).toFixed(1)} MB, limit je ${IMPORT_MAX_FILE_BYTES/1024/1024} MB).
      Rozdělte data do menších souborů.</span>`;
    return;
  }

  try {
    if (_importSection === 'backup') {
      if (ext !== 'json') {
        info.innerHTML += `<br><span class="import-error">❌ Záloha musí být soubor .json.</span>`;
        return;
      }
      await parseBackupFile(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      await parseExcelFile(file);
    } else if (ext === 'csv' || ext === 'txt') {
      await parseCsvFile(file);
    } else if (ext === 'docx') {
      await parseDocxFile(file, info);
    } else if (ext === 'pdf') {
      await parsePdfFile(file, info);
    } else if (ext === 'doc') {
      // Legacy binary .doc (pre-2007) has no reliable browser-side parser —
      // mammoth only reads the modern .docx (zip/XML) format.
      info.innerHTML += `<br><span class="import-warn">⚠️ Starý formát .doc není podporován.
        Uložte dokument ve Wordu jako .docx, nebo zkopírujte text a použijte záložku <strong>📋 Vložit text</strong>.</span>`;
      switchImportSrc('paste');
    } else {
      await parseCsvFile(file); // attempt as text
    }
  } catch (err) {
    info.innerHTML += `<br><span class="import-error">❌ Chyba čtení souboru: ${escHtml(err.message)}</span>`;
  }
}

async function parseCsvFile(file) {
  const text = await file.text();
  _importRawText = text;
  parseTextToRows(text);
}

async function parseExcelFile(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = data.filter(r => r.some(c => String(c).trim() !== ''));

  if (rows.length - 1 > IMPORT_MAX_ROWS) {
    toast(`Soubor má ${rows.length - 1} řádků dat, limit je ${IMPORT_MAX_ROWS}. Rozdělte import na menší části.`, 'error');
    return;
  }

  const cfg = IMPORT_CONFIG[_importSection];
  if (cfg.mode === 'text') {
    // Text-mode sections (menu, norms) have no cfg.fields / column mapping —
    // flatten the sheet into text and feed it through the same path as a
    // pasted/plain-text import, instead of the CSV column-mapping UI which
    // would crash here (cfg.fields.forEach on undefined).
    const text = rows.map(r => r.join('\t')).join('\n');
    _importRawText = text;
    parseTextToRows(text);
    return;
  }

  _importRows   = rows;
  _importIsText = false;
  afterParse();
}

// ── Word (.docx) text extraction via mammoth.js ───────────
// mammoth reads the .docx XML/zip structure directly in the browser and
// hands back plain text — no server round-trip, same pattern as XLSX.read.
async function parseDocxFile(file, info) {
  if (typeof mammoth === 'undefined') {
    info.innerHTML += `<br><span class="import-error">❌ Knihovna pro čtení .docx se nenahrála
      (zkontrolujte připojení k internetu a obnovte stránku). Zatím zkopírujte text a použijte
      záložku <strong>📋 Vložit text</strong>.</span>`;
    switchImportSrc('paste');
    return;
  }
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  const text = (result.value || '').trim();

  if (result.messages && result.messages.length) {
    // Non-fatal notices from mammoth (e.g. unsupported style) — surface
    // them quietly, they don't block the import.
    console.warn('mammoth:', result.messages);
  }
  if (!text) {
    info.innerHTML += `<br><span class="import-error">❌ Z dokumentu se nepodařilo získat žádný text
      (může jít o naskenovaný obrázek bez textové vrstvy).</span>`;
    return;
  }
  info.innerHTML += `<br><span class="import-ok">✅ Text z .docx extrahován (${text.length} znaků).</span>`;
  _importRawText = text;
  parseTextToRows(text);
}

// ── PDF text extraction via pdf.js ────────────────────────
// Walks every page, pulling out the positioned text items and joining
// them back into lines/pages of plain text. Scanned (image-only) PDFs
// have no text layer and will come back empty — that's a real limit of
// any browser-side extractor, not something a library upgrade fixes.
async function parsePdfFile(file, info) {
  if (typeof window.pdfjsLib === 'undefined') {
    info.innerHTML += `<br><span class="import-error">❌ Knihovna pro čtení PDF se ještě nenahrála
      nebo se nenahrála vůbec (zkontrolujte připojení k internetu a obnovte stránku). Zatím
      zkopírujte text a použijte záložku <strong>📋 Vložit text</strong>.</span>`;
    switchImportSrc('paste');
    return;
  }
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

  const pageTexts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text items into lines using their y-coordinate, since pdf.js
    // returns each text run separately with no inherent line breaks.
    let lastY = null;
    let line = '';
    const lines = [];
    content.items.forEach(item => {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += item.str;
      lastY = y;
    });
    if (line) lines.push(line);
    pageTexts.push(lines.join('\n'));
  }

  const text = pageTexts.join('\n\n').trim();
  if (!text) {
    info.innerHTML += `<br><span class="import-error">❌ Z PDF se nepodařilo získat žádný text
      (jde nejspíš o naskenovaný dokument bez textové vrstvy — zkuste OCR, nebo zadejte data ručně).</span>`;
    return;
  }
  info.innerHTML += `<br><span class="import-ok">✅ Text z PDF extrahován (${pdf.numPages}
    ${pdf.numPages === 1 ? 'strana' : 'stran'}, ${text.length} znaků).</span>`;
  _importRawText = text;
  parseTextToRows(text);
}

// ── Backup (full-app JSON restore) ────────────────────────
let _importBackupData = null; // parsed backup payload, validated, awaiting confirm

async function parseBackupFile(file) {
  const text = await file.text();
  const info = document.getElementById('importFileInfo');

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    info.innerHTML += `<br><span class="import-error">❌ Neplatný JSON soubor: ${escHtml(e.message)}</span>`;
    return;
  }

  const problems = validateBackupPayload(payload);
  if (problems.length) {
    _importErrors = problems.map(reason => ({ row: '-', field: '-', reason }));
    renderImportErrors();
    info.innerHTML += `<br><span class="import-error">❌ Soubor nevypadá jako platná záloha této appky.</span>`;
    document.getElementById('btnDoImport').disabled = true;
    return;
  }

  _importBackupData = payload;
  showBackupPreview(payload);
  document.getElementById('btnDoImport').disabled = false;
}

// Sanity-checks the shape without trusting it — a backup file is just
// JSON someone could hand-edit or grab from the wrong app entirely.
function validateBackupPayload(payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object') {
    problems.push('Soubor neobsahuje objekt na nejvyšší úrovni.');
    return problems;
  }
  if (payload.app !== 'canteen-smart-manager') {
    problems.push('Chybí nebo nesouhlasí identifikátor appky ("app" pole).');
  }
  if (typeof payload.schemaVersion !== 'number') {
    problems.push('Chybí číslo verze schématu ("schemaVersion").');
  }
  if (!payload.data || typeof payload.data !== 'object') {
    problems.push('Chybí datová sekce ("data").');
    return problems;
  }
  const d = payload.data;
  if (d.ledger !== undefined && !Array.isArray(d.ledger)) problems.push('"ledger" musí být pole.');
  if (d.cart !== undefined && !Array.isArray(d.cart)) problems.push('"cart" musí být pole.');
  if (d.attendance !== undefined && typeof d.attendance !== 'object') problems.push('"attendance" musí být objekt.');
  return problems;
}

function showBackupPreview(payload) {
  document.getElementById('importMappingPane').classList.add('hidden');
  document.getElementById('importPreviewPane').classList.remove('hidden');
  const d = payload.data || {};
  const counts = [
    ['Jídelníček',  d.currentMenu ? '1 týden' : '–'],
    ['Docházka',    d.attendance ? Object.keys(d.attendance).length + ' týdnů' : '–'],
    ['Sklad',       Array.isArray(d.ledger) ? d.ledger.length + ' záznamů' : '–'],
    ['Nákupní seznam', Array.isArray(d.cart) ? d.cart.length + ' položek' : '–'],
  ];
  document.getElementById('importPreviewCount').textContent =
    payload.exportedAt ? `vytvořeno ${new Date(payload.exportedAt).toLocaleString('cs-CZ')}` : '';
  document.getElementById('importPreviewTable').innerHTML =
    '<tr><th>Sekce</th><th>Obsahuje</th></tr>' +
    counts.map(([label, val]) => `<tr><td>${escHtml(label)}</td><td>${escHtml(val)}</td></tr>`).join('') +
    `<tr><td colspan="2"><span class="import-warn">⚠️ Obnovení ze zálohy <strong>přepíše</strong>
      aktuální data ve všech sekcích, které záloha obsahuje. Tuto akci nelze vrátit zpět.</span></td></tr>`;
}

// ── Paste parsing ─────────────────────────────────────────
function importParsePaste() {
  const text = document.getElementById('importPasteArea').value.trim();
  if (!text) return;
  _importRawText = text;
  parseTextToRows(text);
}

function parseTextToRows(text) {
  const cfg = IMPORT_CONFIG[_importSection];
  if (cfg.mode === 'text') {
    // Raw text import
    _importIsText = true;
    _importRawText = text;
    showTextPreview(text);
    document.getElementById('btnDoImport').disabled = false;
    return;
  }

  // Detect CSV vs plain rows
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length - 1 > IMPORT_MAX_ROWS) {
    toast(`Vstup má ${lines.length - 1} řádků dat, limit je ${IMPORT_MAX_ROWS}. Rozdělte import na menší části.`, 'error');
    return;
  }
  // Auto-detect separator
  const sep = detectSeparator(lines[0] || '');
  const rows = lines.map(l => splitCsvLine(l, sep));
  _importRows   = rows;
  _importIsText = false;
  afterParse();
}

function detectSeparator(line) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitCsvLine(line, sep) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function afterParse() {
  if (!_importRows.length) {
    toast('Soubor je prázdný nebo nelze přečíst.', 'error');
    return;
  }
  _importErrors = [];
  renderImportErrors();
  buildMappingUI();
  buildPreview();
  document.getElementById('importMappingPane').classList.remove('hidden');
  document.getElementById('importPreviewPane').classList.remove('hidden');
  document.getElementById('btnDoImport').disabled = false;
  document.getElementById('importRowCount').textContent =
    `${_importRows.length - 1} řádků dat`;
}

// ── Error panel ────────────────────────────────────────────
// Renders the structured _importErrors list into the modal so the user
// sees exactly which rows failed and why, instead of only a console.warn.
function renderImportErrors() {
  const panel = document.getElementById('importErrorPane');
  if (!panel) return; // backward-compatible if HTML hasn't been updated
  if (!_importErrors.length) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  const maxShown = 25;
  const shown = _importErrors.slice(0, maxShown);
  panel.innerHTML = `
    <div class="import-error-header">⚠️ ${_importErrors.length} ${_importErrors.length === 1 ? 'problém' : 'problémů'} při zpracování</div>
    <ul class="import-error-list">
      ${shown.map(e => `<li><strong>Řádek ${escHtml(String(e.row))}</strong>${e.field && e.field !== '-' ? ` · ${escHtml(e.field)}` : ''}: ${escHtml(e.reason)}</li>`).join('')}
    </ul>
    ${_importErrors.length > maxShown ? `<div class="muted" style="font-size:.78rem">… a dalších ${_importErrors.length - maxShown}</div>` : ''}
  `;
}

// ── Text preview ──────────────────────────────────────────
function showTextPreview(text) {
  document.getElementById('importMappingPane').classList.add('hidden');
  document.getElementById('importPreviewPane').classList.remove('hidden');
  document.getElementById('importPreviewCount').textContent = '';
  const table = document.getElementById('importPreviewTable');
  const preview = text.slice(0, 800) + (text.length > 800 ? '\n…' : '');
  table.innerHTML = `<tr><td style="white-space:pre-wrap;font-size:.85rem;padding:.5rem">${escHtml(preview)}</td></tr>`;
}

// ── Column mapping UI ─────────────────────────────────────
function buildMappingUI() {
  const cfg    = IMPORT_CONFIG[_importSection];
  const header = _importRows[0] || [];
  const dataRow = _importRows[1] || []; // first data row, used for the live example preview
  const grid   = document.getElementById('importMappingGrid');
  grid.innerHTML = '';

  const hintEl = document.getElementById('importMappingHint');
  if (hintEl) hintEl.textContent = cfg.hint || '';

  if (!Array.isArray(cfg.fields)) return; // text-mode/backup sections have no column mapping

  cfg.fields.forEach(field => {
    const div = document.createElement('div');
    div.className = 'import-map-row';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.className = field.required ? 'required' : '';

    const sel = document.createElement('select');
    sel.id = `mapField_${field.key}`;
    sel.innerHTML = `<option value="">– nevybráno –</option>`;
    header.forEach((col, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = col || `Sloupec ${i + 1}`;
      // Auto-match by name similarity
      if (autoMatch(field.key, col)) opt.selected = true;
      sel.appendChild(opt);
    });

    // Live example: shows the actual value that will be used for this
    // field from the first data row, so a person can confirm "yes, that
    // dropdown really points at the right column" without guessing from
    // header text alone (which is often ambiguous or missing).
    const example = document.createElement('span');
    example.className = 'import-map-example muted';
    const updateExample = () => {
      const idx = sel.value;
      example.textContent = idx === '' ? '' : `→ např. „${dataRow[idx] ?? ''}"`;
    };
    sel.addEventListener('change', updateExample);
    updateExample();

    div.appendChild(label);
    div.appendChild(sel);
    div.appendChild(example);
    grid.appendChild(div);
  });
}

const AUTO_MATCH_MAP = {
  name:     ['název', 'name', 'surovina', 'item', 'produkt', 'zboži', 'zboži'],
  qty:      ['množství', 'qty', 'quantity', 'počet', 'amount', 'mnozstvi'],
  unit:     ['jednotka', 'unit', 'jednotky', 'mj'],
  price:    ['cena', 'price', 'částka', 'kč', 'cost'],
  store:    ['dodavatel', 'store', 'obchod', 'supplier', 'prodejna'],
  date:     ['datum', 'date', 'den', 'day'],
  type:     ['typ', 'type', 'směr', 'in/out'],
  obed:        ['oběd', 'obed', 'lunch', 'počet_oběd'],
  presnidavka: ['přesnídávka', 'presnidavka', 'snídaně', 'snidane', 'breakfast'],
  svacina:     ['svačina', 'svacina', 'odpolední', 'odpoledni', 'snack'],
};

function autoMatch(fieldKey, colName) {
  const col = (colName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const synonyms = (AUTO_MATCH_MAP[fieldKey] || []).map(s =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  return synonyms.some(s => col.includes(s) || s.includes(col));
}

// ── Preview table ─────────────────────────────────────────
function buildPreview() {
  const table  = document.getElementById('importPreviewTable');
  const count  = document.getElementById('importPreviewCount');
  const maxRows = Math.min(_importRows.length, 6);
  count.textContent = `(${_importRows.length} řádků, zobrazuji ${maxRows})`;

  let html = '';
  for (let i = 0; i < maxRows; i++) {
    const tag = i === 0 ? 'th' : 'td';
    html += '<tr>' + (_importRows[i] || []).map(c =>
      `<${tag}>${escHtml(String(c))}</${tag}>`).join('') + '</tr>';
  }
  table.innerHTML = html;
}

// ── Import execution ──────────────────────────────────────
function doImport() {
  const cfg = IMPORT_CONFIG[_importSection];
  if (cfg.mode === 'backup') {
    doBackupRestore();
    return;
  }
  if (cfg.mode === 'text') {
    doTextImport();
    return;
  }
  doCsvImport();
}

function doBackupRestore() {
  if (!_importBackupData) { toast('Nejprve vyberte platný soubor zálohy.', 'error'); return; }
  if (!confirm('Obnovit data ze zálohy? Aktuální data v sekcích, které záloha obsahuje, budou přepsána. Tuto akci nelze vrátit zpět.')) {
    return;
  }

  const d = _importBackupData.data || {};
  const restored = [];

  if (d.currentMenu !== undefined) {
    STATE.currentMenu = d.currentMenu;
    STATE.ingredients = Array.isArray(d.ingredients) ? d.ingredients : (STATE.ingredients || []);
    saveMenu();
    restored.push('jídelníček');
  }
  if (Array.isArray(d.ledger)) {
    STATE.ledger = d.ledger;
    saveLedger();
    restored.push(`sklad (${d.ledger.length})`);
  }
  if (Array.isArray(d.cart)) {
    STATE.cart = d.cart;
    saveCart();
    restored.push(`nákupní seznam (${d.cart.length})`);
  }
  if (d.attendance && typeof d.attendance === 'object') {
    attendanceData = d.attendance;
    saveAttendance();
    restored.push(`docházka (${Object.keys(d.attendance).length} týdnů)`);
  }

  closeImport();
  if (typeof renderAll === 'function') renderAll();
  if (typeof renderAttendanceGrid === 'function') renderAttendanceGrid();
  toast(`Obnoveno ze zálohy: ${restored.join(', ') || 'žádná sekce nerozpoznána'}.`, restored.length ? 'success' : 'warning');
}

function doTextImport() {
  const text = _importRawText;
  if (!text) return;

  switch (_importSection) {
    case 'menu':
      // Re-use groq parse flow
      if (typeof groqParseMenu === 'function') {
        closeImport();
        toast('Analyzuji jídelníček…', 'info');
        groqParseMenu(text.slice(0, 6000)).then(parsed => {
          STATE.currentMenu = { fetchedAt: new Date().toISOString(), raw: text, days: parsed };
          STATE.ingredients = extractIngredients(parsed);
          saveMenu();
          renderMenu();
          renderIngredients();
          toast('Jídelníček importován!', 'success');
        }).catch(err => toast('Chyba analýzy: ' + err.message, 'error'));
      } else {
        toast('Funkce analýzy jídelníčku není dostupná.', 'error');
      }
      break;

    case 'norms':
      closeImport();
      // Show imported text in a info toast + copy to clipboard
      navigator.clipboard.writeText(text).catch(() => {});
      toast('Text norem zkopírován. Použijte jej pro ruční zadání hodnot.', 'info');
      break;

    default:
      closeImport();
      toast('Text přijat.', 'success');
  }
}

function doCsvImport() {
  const cfg    = IMPORT_CONFIG[_importSection];
  const header = _importRows[0] || [];
  const data   = _importRows.slice(1).filter(r => r.some(c => String(c).trim()));

  // Build column index map from user selection
  const colMap = {};
  cfg.fields.forEach(field => {
    const sel = document.getElementById(`mapField_${field.key}`);
    if (sel && sel.value !== '') colMap[field.key] = parseInt(sel.value, 10);
  });

  // Required fields must be mapped before we even look at rows — otherwise
  // every row fails with the same unhelpful "missing X" error.
  const missingRequired = cfg.fields.filter(f => f.required && colMap[f.key] === undefined);
  if (missingRequired.length) {
    toast(`Namapujte povinné pole: ${missingRequired.map(f => f.label).join(', ')}.`, 'error');
    return;
  }

  function val(row, key) { return colMap[key] !== undefined ? String(row[colMap[key]] || '').trim() : ''; }

  let imported = 0;
  const errors = [];

  switch (_importSection) {
    case 'attendance':
      imported = importAttendance(data, val, errors);
      break;

    case 'offers':
      imported = importOffers(data, val, errors);
      break;

    case 'warehouse':
    case 'finance':
      imported = importWarehouse(data, val, errors);
      break;
  }

  _importErrors = errors;
  renderImportErrors();

  if (errors.length && imported === 0) {
    // Nothing usable came through — keep the modal open so the user can
    // see exactly what's wrong and fix the mapping or the source file.
    toast(`Import se nezdařil: ${errors.length} ${errors.length === 1 ? 'chyba' : 'chyb'}, 0 záznamů přijato.`, 'error');
    return;
  }

  if (errors.length) {
    // Partial success — keep the modal open too, so the error panel
    // (already rendered above) stays visible instead of vanishing with
    // the rest of the modal. The user closes it manually once reviewed.
    toast(`Import: ${imported} přijato, ${errors.length} chyb. Podrobnosti níže.`, 'warning');
    console.warn('Import errors:', errors);
    return;
  }

  closeImport();
  toast(`Importováno ${imported} záznamů!`, 'success');
}

// ── Section-specific importers ────────────────────────────

function importAttendance(data, val, errors) {
  // attendanceData is keyed as { [isoWeekStr]: { [dayIndex 0-4]: { presnidavka, obed, svacina } } } —
  // see MEALS_LIST / renderAttendanceGrid in app.js. Using any other shape or
  // key names means the import silently never appears anywhere in the UI.
  if (typeof attendanceData === 'undefined') {
    errors.push({ row: '-', field: '-', reason: 'Modul docházky není načten.' });
    return 0;
  }

  const bulkRows = []; // for cloud sync, built alongside the local merge
  let count = 0;

  data.forEach((row, i) => {
    const rowNum = i + 2; // +1 header, +1 to make it 1-based for the user
    const dateRaw = val(row, 'date');
    if (!dateRaw) { errors.push({ row: rowNum, field: 'Datum', reason: 'chybí datum' }); return; }

    const normalized = normalizeDateKey(dateRaw);
    if (normalized === null) { errors.push({ row: rowNum, field: 'Datum', reason: `nelze rozpoznat datum "${dateRaw}"` }); return; }
    const date = new Date(normalized);

    const dayIndex = (date.getDay() + 6) % 7; // Mon=0..Sun=6
    if (dayIndex > 4) { errors.push({ row: rowNum, field: 'Datum', reason: 'datum spadá na víkend, docházka se neeviduje' }); return; }

    const weekStr = typeof getISOWeekString === 'function' ? getISOWeekString(date) : null;
    if (!weekStr) { errors.push({ row: rowNum, field: 'Datum', reason: 'nelze určit týden' }); return; }

    const obed = parseInt(val(row, 'obed'), 10);
    if (val(row, 'obed') !== '' && isNaN(obed)) {
      errors.push({ row: rowNum, field: 'Oběd', reason: `neplatné číslo "${val(row, 'obed')}"` }); return;
    }

    if (!attendanceData[weekStr]) attendanceData[weekStr] = {};
    if (!attendanceData[weekStr][dayIndex]) attendanceData[weekStr][dayIndex] = {};
    const cell = attendanceData[weekStr][dayIndex];

    if (val(row, 'presnidavka') !== '') cell.presnidavka = parseInt(val(row, 'presnidavka'), 10) || 0;
    if (val(row, 'obed')        !== '') cell.obed        = obed || 0;
    if (val(row, 'svacina')     !== '') cell.svacina     = parseInt(val(row, 'svacina'), 10) || 0;

    // DB schema is one row per (org, week, day, meal) — emit a row for
    // each meal actually present on this line, not just "obed".
    ['presnidavka', 'obed', 'svacina'].forEach(meal => {
      if (cell[meal] === undefined) return;
      bulkRows.push({
        org_id:      window.SYNC?.ORG_ID,
        week_key:    weekStr,
        day_index:   dayIndex,
        meal,
        age_group:   'ms_3_6',
        child_count: cell[meal],
      });
    });
    count++;
  });

  if (count) {
    saveAttendance();
    if (typeof renderAttendanceGrid === 'function') renderAttendanceGrid();
  }

  // Cloud sync — best-effort, mirrors the pattern used for ledger imports.
  if (bulkRows.length && typeof dbPut === 'function' && window.AUTH?.isLoggedIn()) {
    dbPut('/api/db/attendance/bulk', { rows: bulkRows });
  }

  return count;
}

function importOffers(data, val, errors) {
  if (typeof STATE === 'undefined') {
    errors.push({ row: '-', field: '-', reason: 'Stav appky není načten.' });
    return 0;
  }
  const cart = STATE.cart || (STATE.cart = []);

  // Duplicate guard: same name+store+qty+unit already in the cart (from a
  // previous import or manual entry) is almost certainly a re-import of the
  // same file, not an intentional second copy of the line item.
  const existingKey = e => `${(e.name||'').toLowerCase().trim()}|${(e.store||'').toLowerCase().trim()}|${e.qty}|${e.unit}`;
  const seen = new Set(cart.map(existingKey));

  let count = 0;
  let dupes = 0;

  data.forEach((row, i) => {
    const rowNum = i + 2;
    const name = val(row, 'name');
    if (!name) { errors.push({ row: rowNum, field: 'Název', reason: 'chybí název suroviny' }); return; }

    const qtyRaw = val(row, 'qty');
    const qty = parseFloat(qtyRaw);
    if (qtyRaw && isNaN(qty)) { errors.push({ row: rowNum, field: 'Množství', reason: `neplatné číslo "${qtyRaw}"` }); return; }

    const item = {
      id:    Date.now() + Math.random(),
      name,
      qty:   qty || 1,
      unit:  val(row, 'unit')  || 'ks',
      price: parseFloat(val(row, 'price')) || 0,
      store: val(row, 'store') || 'Import',
      promo: false,
      source: 'import',
    };

    const key = existingKey(item);
    if (seen.has(key)) { dupes++; return; }
    seen.add(key);

    cart.push(item);
    count++;
  });

  if (count) {
    saveCart();
    if (typeof renderShoppingList === 'function') renderShoppingList();
  }
  if (dupes) {
    errors.push({ row: '-', field: '-', reason: `${dupes} ${dupes === 1 ? 'řádek byl přeskočen' : 'řádků bylo přeskočeno'} jako duplicita (stejný název+obchod+množství už v seznamu)` });
  }
  return count;
}

function importWarehouse(data, val, errors) {
  if (typeof STATE === 'undefined') {
    errors.push({ row: '-', field: '-', reason: 'Stav appky není načten.' });
    return 0;
  }
  const ledger = STATE.ledger || (STATE.ledger = []);

  // Duplicate guard: same type+name+store+qty+unit+date already in the
  // ledger is almost certainly a re-import of the same export file.
  const existingKey = e => `${e.type}|${(e.name||'').toLowerCase().trim()}|${(e.store||'').toLowerCase().trim()}|${e.qty}|${e.unit}|${(e.date||'').slice(0,10)}`;
  const seen = new Set(ledger.map(existingKey));

  const newEntries = [];
  let dupes = 0;

  data.forEach((row, i) => {
    const rowNum = i + 2;
    const name = val(row, 'name');
    if (!name) { errors.push({ row: rowNum, field: 'Název', reason: 'chybí název suroviny' }); return; }

    const qtyRaw = val(row, 'qty');
    const qty = parseFloat(qtyRaw);
    if (qtyRaw && isNaN(qty)) { errors.push({ row: rowNum, field: 'Množství', reason: `neplatné číslo "${qtyRaw}"` }); return; }

    const dateRaw = val(row, 'date');
    let date;
    if (!dateRaw) {
      date = new Date();
    } else {
      const normalized = normalizeDateKey(dateRaw);
      if (normalized === null) { errors.push({ row: rowNum, field: 'Datum', reason: `nelze rozpoznat datum "${dateRaw}"` }); return; }
      date = new Date(normalized);
    }

    const type  = (val(row, 'type') || 'in').toLowerCase().includes('out') ? 'out' : 'in';
    const unit  = val(row, 'unit')  || 'ks';
    const price = parseFloat(val(row, 'price')) || 0;
    const store = val(row, 'store') || 'Import';
    const isoDate = date.toISOString();

    const entry = {
      id:        Date.now() + Math.random(),
      type,
      name,
      foodGroup: null,
      qty:       qty || 1,
      unit,
      grams:     typeof toGrams === 'function' ? toGrams(qty || 1, unit) : (qty || 1) * 100,
      price,
      store,
      promo:     false,
      date:      isoDate,
      weekKey:   typeof getWeekKey === 'function' ? getWeekKey(date) : '',
      source:    'import',
      _synced:   false,
    };

    const key = existingKey(entry);
    if (seen.has(key)) { dupes++; return; }
    seen.add(key);

    ledger.push(entry);
    newEntries.push(entry);
  });

  if (newEntries.length) {
    saveLedger();
    if (typeof renderWarehouse === 'function') renderWarehouse();
    if (typeof renderFinance === 'function') renderFinance();
  }
  if (dupes) {
    errors.push({ row: '-', field: '-', reason: `${dupes} ${dupes === 1 ? 'řádek byl přeskočen' : 'řádků bylo přeskočeno'} jako duplicita (stejná surovina+obchod+množství+datum už ve skladu)` });
  }

  // Persist new entries to DB. Only the entries created by *this* import
  // call are sent — not "everything currently unsynced" — and each is
  // marked _synced on success so a future import/sync pass won't resend it.
  if (newEntries.length && typeof dbPost === 'function' && window.AUTH?.isLoggedIn()) {
    const orgId = window.SYNC?.ORG_ID;
    const toRow = e => ({ org_id: orgId, name: e.name, food_group: e.foodGroup, qty: e.qty, unit: e.unit, grams: e.grams, price: e.price, store: e.store, promo: e.promo, week_key: e.weekKey, source: e.source });
    const inEntries  = newEntries.filter(e => e.type === 'in');
    const outEntries = newEntries.filter(e => e.type === 'out');

    if (inEntries.length) {
      dbPost('/api/db/ledger/bulk-in', { entries: inEntries.map(toRow) }).then(result => {
        if (result) { inEntries.forEach(e => e._synced = true); saveLedger(); }
      });
    }
    if (outEntries.length) {
      dbPost('/api/db/ledger/bulk-out', { entries: outEntries.map(toRow) }).then(result => {
        if (result) { outEntries.forEach(e => e._synced = true); saveLedger(); }
      });
    }
  }

  return newEntries.length;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Try to parse various date formats into YYYY-MM-DD.
 * Returns null for genuinely unparseable input — callers must check for
 * this explicitly. Only a *missing* value (empty string/undefined)
 * defaults to today; garbage input ("xx.yy.zzzz") must not silently
 * become "today" or bad data gets attributed to the wrong day.
 */
function normalizeDateKey(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // DD.MM.YYYY or D.M.YYYY (Czech)
  const dm = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  // DD/MM/YYYY
  const ds = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ds) return `${ds[3]}-${ds[2].padStart(2, '0')}-${ds[1].padStart(2, '0')}`;
  // Excel serial number
  const num = parseInt(raw, 10);
  if (!isNaN(num) && num > 40000 && num < 60000 && /^\d+$/.test(String(raw).trim())) {
    const d = new Date((num - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  // Fallback — generic Date parsing, but DO NOT default to today on failure
  const d = new Date(raw);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
