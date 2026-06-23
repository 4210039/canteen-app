/* ═══════════════════════════════════════════════════════════
   import.js – Universal Import Feature
   Supports: CSV, TXT, XLSX/XLS (via SheetJS), plain text paste
   Word & PDF: user must copy/paste text content manually
═══════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────
let _importSection = null;   // 'menu' | 'attendance' | 'offers' | 'warehouse' | 'finance' | 'norms'
let _importRows    = [];     // array of arrays (header = row[0])
let _importIsText  = false;  // true when raw text (no column structure)
let _importRawText = '';

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
    fields: [
      { key: 'date',     label: 'Datum',            required: true  },
      { key: 'snidane',  label: 'Snídaně (počet)',  required: false },
      { key: 'svacina1', label: 'Svačina dop. (počet)', required: false },
      { key: 'obed',     label: 'Oběd (počet)',     required: true  },
      { key: 'svacina2', label: 'Svačina odp. (počet)', required: false },
    ],
    hint: 'CSV sloupce: datum, snídaně, svačina_dop, oběd, svačina_odp',
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
};

// ── Open / Close ─────────────────────────────────────────
function openImport(section) {
  _importSection = section;
  _importRows    = [];
  _importIsText  = false;
  _importRawText = '';

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

  // For text-mode sections, default to paste tab
  if (cfg.mode === 'text') {
    switchImportSrc('paste');
    document.getElementById('importDropZone').querySelector('.drop-hint').textContent =
      'CSV · TXT · (для Word & PDF вставте текст)';
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
  info.innerHTML = `<span class="muted">📄 ${file.name} · ${(file.size/1024).toFixed(1)} KB</span>`;

  try {
    if (ext === 'xlsx' || ext === 'xls') {
      await parseExcelFile(file);
    } else if (ext === 'csv' || ext === 'txt') {
      await parseCsvFile(file);
    } else if (ext === 'docx' || ext === 'doc' || ext === 'pdf') {
      info.innerHTML += `<br><span class="import-warn">⚠️ Formát ${ext.toUpperCase()} není přímo podporován. 
        Zkopírujte text z dokumentu a použijte záložku <strong>📋 Vložit text</strong>.</span>`;
      switchImportSrc('paste');
    } else {
      await parseCsvFile(file); // attempt as text
    }
  } catch (err) {
    info.innerHTML += `<br><span class="import-error">❌ Chyba čtení souboru: ${err.message}</span>`;
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
  _importRows   = data.filter(r => r.some(c => String(c).trim() !== ''));
  _importIsText = false;
  afterParse();
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
  buildMappingUI();
  buildPreview();
  document.getElementById('importMappingPane').classList.remove('hidden');
  document.getElementById('importPreviewPane').classList.remove('hidden');
  document.getElementById('btnDoImport').disabled = false;
  document.getElementById('importRowCount').textContent =
    `${_importRows.length - 1} řádků dat`;
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
  const grid   = document.getElementById('importMappingGrid');
  grid.innerHTML = '';

  cfg.fields.forEach(field => {
    const div = document.createElement('div');
    div.className = 'import-map-row';

    const label = document.createElement('label');
    label.textContent = field.label + (field.required ? ' *' : '');
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

    div.appendChild(label);
    div.appendChild(sel);
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
  obed:     ['oběd', 'obed', 'lunch', 'počet_oběd'],
  snidane:  ['snídaně', 'snidane', 'breakfast'],
  svacina1: ['svačina_dop', 'svacina1', 'dopoledni'],
  svacina2: ['svačina_odp', 'svacina2', 'odpoledni'],
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
  if (cfg.mode === 'text') {
    doTextImport();
    return;
  }
  doCsvImport();
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

  function val(row, key) { return colMap[key] !== undefined ? String(row[colMap[key]] || '').trim() : ''; }

  let imported = 0;
  const errors = [];

  switch (_importSection) {
    case 'attendance':
      importAttendance(data, val, errors);
      imported = data.length - errors.length;
      break;

    case 'offers':
      imported = importOffers(data, val, errors);
      break;

    case 'warehouse':
    case 'finance':
      imported = importWarehouse(data, val, errors);
      break;
  }

  closeImport();
  if (errors.length) {
    toast(`Import: ${imported} přijato, ${errors.length} chyb.`, 'warning');
    console.warn('Import errors:', errors);
  } else {
    toast(`Importováno ${imported} záznamů!`, 'success');
  }
}

// ── Section-specific importers ────────────────────────────

function importAttendance(data, val, errors) {
  const attKey = typeof getWeekKey === 'function' ? getWeekKey() : '';
  // Merge into in-memory attendanceData (attendance module's state)
  const stored = (typeof attendanceData !== 'undefined' ? attendanceData : {});

  data.forEach((row, i) => {
    const dateRaw = val(row, 'date');
    if (!dateRaw) { errors.push({ row: i, reason: 'missing date' }); return; }

    const day = normalizeDateKey(dateRaw);
    const entry = {
      snidane:  parseInt(val(row, 'snidane') || '0', 10)  || 0,
      svacina1: parseInt(val(row, 'svacina1') || '0', 10) || 0,
      obed:     parseInt(val(row, 'obed') || '0', 10)     || 0,
      svacina2: parseInt(val(row, 'svacina2') || '0', 10) || 0,
    };
    stored[day] = entry;
  });

  // Refresh attendance grid if visible
  if (typeof renderAttendanceGrid === 'function') renderAttendanceGrid();
}

function importOffers(data, val, errors) {
  let count = 0;
  const cart = (typeof STATE !== 'undefined' ? (STATE.cart || []) : []);

  data.forEach((row, i) => {
    const name = val(row, 'name');
    if (!name) { errors.push({ row: i, reason: 'missing name' }); return; }

    cart.push({
      id:    Date.now() + Math.random(),
      name,
      qty:   parseFloat(val(row, 'qty'))   || 1,
      unit:  val(row, 'unit')  || 'ks',
      price: parseFloat(val(row, 'price')) || 0,
      store: val(row, 'store') || 'Import',
      promo: false,
      source: 'import',
    });
    count++;
  });

  if (typeof STATE !== 'undefined') STATE.cart = cart;
  if (typeof renderCart === 'function') renderCart();
  if (typeof renderShoppingPanel === 'function') renderShoppingPanel();
  return count;
}

function importWarehouse(data, val, errors) {
  let count = 0;
  // Use STATE.ledger if available
  const ledger = (typeof STATE !== 'undefined' && STATE.ledger) || [];

  data.forEach((row, i) => {
    const name = val(row, 'name');
    if (!name) { errors.push({ row: i, reason: 'missing name' }); return; }

    const type  = (val(row, 'type') || 'in').toLowerCase().includes('out') ? 'out' : 'in';
    const qty   = parseFloat(val(row, 'qty'))   || 1;
    const unit  = val(row, 'unit')  || 'ks';
    const price = parseFloat(val(row, 'price')) || 0;
    const store = val(row, 'store') || 'Import';
    const dateRaw = val(row, 'date');
    const date  = dateRaw ? new Date(normalizeDateKey(dateRaw)).toISOString()
                           : new Date().toISOString();

    ledger.push({
      id:        Date.now() + Math.random(),
      type,
      name,
      foodGroup: null,
      qty,
      unit,
      grams:     typeof toGrams === 'function' ? toGrams(qty, unit) : qty * 100,
      price,
      store,
      promo:     false,
      date,
      weekKey:   typeof getWeekKey === 'function' ? getWeekKey(new Date(date)) : '',
      source:    'import',
    });
    count++;
  });

  if (typeof STATE !== 'undefined') STATE.ledger = ledger;
  // Persist new ledger entries to DB
  const newEntries = ledger.filter(e => !e._synced);
  if (newEntries.length && typeof dbPost === 'function' && window.AUTH?.isLoggedIn()) {
    const orgId = window.SYNC?.ORG_ID;
    const inRows  = newEntries.filter(e => e.type === 'in').map(e => ({ org_id: orgId, name: e.name, food_group: e.foodGroup, qty: e.qty, unit: e.unit, grams: e.grams, price: e.price, store: e.store, promo: e.promo, week_key: e.weekKey, source: e.source }));
    const outRows = newEntries.filter(e => e.type === 'out').map(e => ({ org_id: orgId, name: e.name, food_group: e.foodGroup, qty: e.qty, unit: e.unit, grams: e.grams, price: e.price, store: e.store, promo: e.promo, week_key: e.weekKey, source: e.source }));
    if (inRows.length)  dbPost('/api/db/ledger/bulk-in',  { entries: inRows });
    if (outRows.length) dbPost('/api/db/ledger/bulk-out', { entries: outRows });
  }
  if (typeof renderWarehouse === 'function') renderWarehouse();
  if (typeof renderFinance === 'function') renderFinance();
  return count;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Try to parse various date formats into YYYY-MM-DD
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
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = new Date((num - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  // Fallback
  const d = new Date(raw);
  return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
