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
  attendanceRoster: {
    title: '👦 Import – Docházka (měsíční přehled)',
    mode: 'roster',
    hint: 'Nahrajte měsíční přehled docházky (.xlsx export ze školního systému) — ' +
      'soubor s jedním řádkem na dítě a sloupci Dopoledne/Odpoledne pro každý den. ' +
      'Počty dětí na den se přečtou přímo z řádku souhrnů v souboru, takže žádné ' +
      'mapování sloupců není potřeba. Oběd se počítá stejně jako Dopoledne.',
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
  _rosterParsed  = null;

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
  } else if (cfg.mode === 'roster') {
    // Roster is a fixed Excel layout, file-only — a pasted/typed version
    // of a 64-column merged-cell grid isn't something anyone would do,
    // and the parser only understands the real .xlsx structure anyway.
    pasteTab?.classList.add('hidden');
    dropZone.querySelector('.drop-hint').textContent = 'XLSX (měsíční přehled docházky) — možno vybrat více souborů najednou (všechny třídy)';
    document.getElementById('importFileInput').accept = '.xlsx,.xls';
    document.getElementById('importFileInput').multiple = true;
  } else {
    pasteTab?.classList.remove('hidden');
    document.getElementById('importFileInput').multiple = false;
    document.getElementById('importFileInput').accept = '.csv,.txt,.xlsx,.xls,.docx,.pdf,.json';
    dropZone.querySelector('.drop-hint').textContent =
      'CSV · XLSX · XLS · TXT · DOCX · PDF';
  }

  // For text-mode sections, default to paste tab
  if (cfg.mode === 'text') {
    switchImportSrc('paste');
  }

  // roster/backup have no column-mapping UI (buildMappingUI never runs
  // for them), so the hint has nowhere to land unless it's shown here.
  if (cfg.mode === 'roster' || cfg.mode === 'backup') {
    const hintEl = document.getElementById('importMappingHint');
    if (hintEl) {
      hintEl.textContent = cfg.hint || '';
      document.getElementById('importMappingPane').classList.remove('hidden');
      document.getElementById('importMappingGrid').innerHTML = '';
    }
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
  if (e.dataTransfer.files.length) importFilesSelected(e.dataTransfer.files);
}

// ── File parsing ──────────────────────────────────────────
// Entry point for both single and multi-file selection/drop.
async function importFilesSelected(files) {
  if (!files || !files.length) return;
  // For roster mode, allow multiple files and merge them.
  if (IMPORT_CONFIG[_importSection]?.mode === 'roster') {
    await importRosterFiles(Array.from(files));
    return;
  }
  // All other modes: single file only (use first).
  importFileSelected(files[0]);
}

async function importRosterFiles(files) {
  const info = document.getElementById('importFileInfo');
  info.classList.remove('hidden');
  info.innerHTML = '';
  document.getElementById('btnDoImport').disabled = true;
  _rosterParsed = null;

  const parsed = [];
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      info.innerHTML += `<span class="import-error">❌ ${escHtml(file.name)}: musí být .xlsx nebo .xls.</span><br>`;
      continue;
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      info.innerHTML += `<span class="import-error">❌ ${escHtml(file.name)}: soubor je příliš velký.</span><br>`;
      continue;
    }
    try {
      const result = await parseRosterFileSingle(file);
      parsed.push(result);
      info.innerHTML += `<span class="import-ok">✅ ${escHtml(file.name)} — ${escHtml(result.className || '?')}, ${result.days.length} dnů</span><br>`;
    } catch (err) {
      info.innerHTML += `<span class="import-error">❌ ${escHtml(file.name)}: ${escHtml(err.message)}</span><br>`;
    }
  }

  if (!parsed.length) return;

  // Merge: sum counts per date across all parsed files.
  const merged = mergeRosterResults(parsed);
  _rosterParsed = merged;
  renderRosterPreview(info);
}

// Merge multiple parsed rosters by summing counts per day (same days guaranteed).
function mergeRosterResults(results) {
  // Use first file as base for metadata (year, month, warnings).
  const base = results[0];
  const classNames = results.map(r => r.className).filter(Boolean);

  // Build a map from day number → merged counts.
  const dayMap = new Map();
  for (const result of results) {
    for (const d of result.days) {
      if (!dayMap.has(d.day)) {
        // Clone the day entry from first file that has it.
        dayMap.set(d.day, { ...d, presnidavka: 0, obed: 0, svacina: 0 });
      }
      const entry = dayMap.get(d.day);
      entry.presnidavka += d.presnidavka;
      entry.obed        += d.obed;
      entry.svacina     += d.svacina;
    }
  }

  const days = [...dayMap.values()].sort((a, b) => a.day - b.day);
  const dpCount = results.reduce((s, r) => s + r.dpCount, 0);
  const blankWeekdayCount = results.reduce((s, r) => s + r.blankWeekdayCount, 0);
  const totalChildren = results.reduce((s, r) => s + r.totalChildren, 0);
  const warnings = results.flatMap(r => r.warnings);

  return {
    year: base.year,
    month: base.month,
    className: classNames.join(', '),
    classBreakdown: results.map(r => ({ name: r.className || '?', children: r.totalChildren, days: r.days })),
    days,
    dpCount,
    blankWeekdayCount,
    totalChildren,
    warnings,
  };
}

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
    } else if (IMPORT_CONFIG[_importSection]?.mode === 'roster') {
      // Single-file roster path (fallback, normally handled by importRosterFiles).
      if (ext !== 'xlsx' && ext !== 'xls') {
        info.innerHTML += `<br><span class="import-error">❌ Měsíční přehled docházky musí být soubor .xlsx nebo .xls (export ze školního systému).</span>`;
        return;
      }
      const r = await parseRosterFile(file, info);
      _rosterParsed = r;
      renderRosterPreview(info);
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

// ── Monthly attendance roster (.xlsx export) ───────────────
// This is a fixed, known layout produced by the school's own attendance
// system — NOT an arbitrary user file, so it gets its own parser instead
// of the generic column-mapping UI used for everything else in
// IMPORT_CONFIG. Shape: one row per child, two columns per calendar day
// (Dopoledne/Odpoledne), values are presence status codes (P, OP, POP,
// DP, PO!, O, Ne) or blank for non-school days.
//
// Rather than re-deriving daily headcounts from per-child status codes
// (which requires deciding what every code — including ambiguous ones
// like DP — means for meal-counting purposes), this reads the sheet's
// own precomputed daily totals row directly ("16/12" = 16 present
// Dopoledne / 12 present Odpoledne). That row is generated by the
// school's own system, so whatever rule they use for DP/edge cases is
// already baked in consistently — confirmed by cross-checking several
// days containing DP against this row: every one matched only when DP
// was counted as present, so that ambiguity is resolved by the data
// itself, not by a guess made here.
const CZ_MONTHS = {
  'leden': 1, 'únor': 2, 'březen': 3, 'duben': 4, 'květen': 5, 'červen': 6,
  'červenec': 7, 'srpen': 8, 'září': 9, 'říjen': 10, 'listopad': 11, 'prosinec': 12,
};

let _rosterParsed = null; // { year, month, className, days: [{day, date, weekKey, dayIndex, presnidavka, obed, svacina}], dpCount, blankWeekdayCount, totalChildren }

async function showImportedAttendanceWeek(weekKey) {
  const targetWeek = String(weekKey || '').trim();
  if (!targetWeek) return;

  // Preferred path: app.js owns the attendance dropdown/grid and exposes a
  // dedicated import handoff. This updates the year dropdown, rebuilds the
  // week dropdown when needed, selects the imported week, fetches that week
  // back from Supabase, renders the grid, and opens the Docházka tab.
  try {
    if (typeof window.focusAttendanceWeekFromImport === 'function') {
      await window.focusAttendanceWeekFromImport(targetWeek);
      return;
    }
  } catch (err) {
    console.warn('Imported attendance was saved, but automatic week selection failed:', err);
  }

  // Defensive fallback in case app.js is loaded in an older version.
  try {
    if (typeof switchTab === 'function') switchTab('attendance');
    const targetYear = parseInt(targetWeek.split('-W')[0], 10);
    const yearSelect = document.getElementById('attYearPicker');
    const weekSelect = document.getElementById('attWeekPicker');

    if (typeof populateAttYearSelect === 'function' && !isNaN(targetYear)) {
      populateAttYearSelect(targetYear);
    } else if (yearSelect && !isNaN(targetYear)) {
      yearSelect.value = String(targetYear);
    }

    if (typeof populateAttWeekSelect === 'function' && !isNaN(targetYear)) {
      populateAttWeekSelect(targetYear, targetWeek);
    } else if (weekSelect) {
      weekSelect.value = targetWeek;
    }
    if (weekSelect) weekSelect.value = targetWeek;

    if (typeof loadAttendanceWeekFromCloud === 'function') {
      await loadAttendanceWeekFromCloud(targetWeek);
    }
    if (typeof renderAttendanceGrid === 'function') renderAttendanceGrid();
    document.getElementById('attendanceGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.warn('Imported attendance was saved, but attendance grid refresh failed:', err);
  }
}

function firstWeekWithAttendance(rows, getWeek, getCounts) {
  const weeks = new Set();
  const weeksWithCounts = new Set();

  rows.forEach(row => {
    const week = getWeek(row);
    if (!week) return;
    weeks.add(week);

    const counts = (getCounts(row) || [])
      .map(v => parseInt(v, 10))
      .filter(v => !isNaN(v));
    if (counts.some(v => v > 0)) weeksWithCounts.add(week);
  });

  const candidates = weeksWithCounts.size ? weeksWithCounts : weeks;
  return [...candidates].sort()[0] || '';
}

async function parseRosterFile(file, info) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  // Raw, unfiltered grid — unlike parseExcelFile, blank rows must NOT be
  // dropped here: row positions are found by searching for known labels
  // ("Jméno studenta", a run of 1..N day numbers), and dropping blank
  // rows would shift everything below them unpredictably.
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Forward-fill a row so merged-cell pairs (the value sits only in the
  // first cell of each Dopoledne/Odpoledne pair) read correctly — SheetJS
  // returns '' for the second cell of a merge, same as openpyxl returns
  // None; both leave the value only on the first cell of the pair.
  function fillRow(row) {
    const out = [];
    let last = '';
    for (const v of row) {
      const s = String(v).trim();
      if (s !== '') last = v;
      out.push(last);
    }
    return out;
  }

  // 1. Find the "Měsíc: <name> <year>" cell — gives us year + month
  //    needed to turn day numbers into real calendar dates.
  let year = null, month = null, className = null;
  for (const row of grid) {
    for (const cell of row) {
      const s = String(cell || '');
      const mMonth = s.match(/Měsíc:\s*(\S+)\s+(\d{4})/i);
      if (mMonth) {
        const name = mMonth[1].toLowerCase();
        month = CZ_MONTHS[name] || null;
        year = parseInt(mMonth[2], 10);
      }
      const mClass = s.match(/Třída:\s*(.+)/i);
      if (mClass) className = mClass[1].trim();
    }
  }
  if (!month || !year) {
    throw new Error('Nelze rozpoznat měsíc a rok ze souboru (buňka „Měsíc: …“ nenalezena nebo má neočekávaný formát). Zkontrolujte, že jde o standardní export měsíčního přehledu docházky.');
  }

  // 2. Find the day-number header row: the first row containing a long
  //    ascending run 1,2,3...N starting in some column — this is more
  //    robust than a hardcoded row index, since other rows (legend,
  //    titles) don't have this shape.
  let dayRowIdx = -1, dayRow = null;
  for (let r = 0; r < grid.length; r++) {
    const filled = fillRow(grid[r]);
    let run = 0, prev = 0;
    for (const v of filled) {
      if (typeof v === 'number' && v === prev + 1) { run++; prev = v; }
      else if (v === 1) { run = 1; prev = 1; }
    }
    if (run >= 20) { dayRowIdx = r; dayRow = filled; break; } // a month always has ≥28 days
  }
  if (dayRowIdx === -1) {
    throw new Error('Nelze najít řádek s čísly dnů (1, 2, 3, …) v souboru. Zkontrolujte, že soubor odpovídá standardnímu měsíčnímu exportu.');
  }

  // 3. The "Dopoledne / Odpoledne" totals row is always exactly one row
  //    below the day-number row in every export this was checked
  //    against — found by label rather than a hardcoded offset, with the
  //    +1 fallback only used if the label search comes up empty.
  let totalsRowIdx = -1;
  for (let r = dayRowIdx; r < Math.min(dayRowIdx + 4, grid.length); r++) {
    if (grid[r].some(c => String(c).includes('Dopoledne') && String(c).includes('Odpoledne'))) {
      totalsRowIdx = r;
      break;
    }
  }
  if (totalsRowIdx === -1) totalsRowIdx = dayRowIdx + 1; // fallback to known relative position
  const totalsRow = fillRow(grid[totalsRowIdx]);

  // 4. Find the day-of-week header row (Po/Út/St/Čt/Pá/So/Ne) — used only
  //    to sanity-check that we're reading the right columns, and to
  //    correctly skip weekend pairs without relying on date math alone.
  let dowRowIdx = -1;
  for (let r = dayRowIdx; r < Math.min(dayRowIdx + 6, grid.length); r++) {
    const vals = grid[r].map(c => String(c).trim());
    if (vals.includes('Po') && vals.includes('Út') && vals.includes('St')) { dowRowIdx = r; break; }
  }
  const dowRow = dowRowIdx !== -1 ? fillRow(grid[dowRowIdx]) : null;

  // 5. Find the student-name column (header cell "Jméno studenta") so we
  //    can count enrolled children for the preview, and find where the
  //    daily-grid columns actually start (first column after the name
  //    column that holds a day number ≥ 1).
  let nameCol = -1;
  for (let r = dayRowIdx; r < Math.min(dayRowIdx + 6, grid.length); r++) {
    const idx = grid[r].findIndex(c => String(c).trim() === 'Jméno studenta');
    if (idx !== -1) { nameCol = idx; break; }
  }

  let firstDayCol = -1;
  for (let c = 0; c < dayRow.length; c++) {
    if (dayRow[c] === 1) { firstDayCol = c; break; }
  }
  if (firstDayCol === -1) {
    throw new Error('Nelze najít sloupec prvního dne v měsíci.');
  }

  // 6. Count enrolled children (rows with a non-empty name in nameCol,
  //    stopping at the first blank row or the "Souhrny" section, which
  //    repeats the same names with monthly totals rather than daily
  //    detail and would double the count if included).
  let totalChildren = 0;
  if (nameCol !== -1) {
    for (let r = dowRowIdx + 2; r < grid.length; r++) {
      const name = String(grid[r][nameCol] || '').trim();
      if (!name) break;
      if (name === 'Souhrny') break;
      totalChildren++;
    }
  }

  // 7. Walk the day-number row in steps of 2 (D, O pair per day), pull
  //    the precomputed "presentD/presentO" value from totalsRow, and
  //    build a real calendar date for each day so it can be mapped to
  //    an ISO week later. Days with no totals cell, or a totals value
  //    that isn't the expected "n/n" shape, are skipped with a warning
  //    rather than guessed at.
  const days = [];
  const warnings = [];
  let dpCount = 0, blankWeekdayCount = 0;

  // Status-code scan across the actual children rows, for the DP /
  // blank-weekday counts shown in the preview (informational only —
  // these do NOT affect the counts taken from totalsRow above).
  const childRows = [];
  if (nameCol !== -1) {
    for (let r = dowRowIdx + 2; r < grid.length; r++) {
      const name = String(grid[r][nameCol] || '').trim();
      if (!name || name === 'Souhrny') break;
      childRows.push(r);
    }
  }

  for (let c = firstDayCol; c < dayRow.length; c += 2) {
    const dayNum = dayRow[c];
    if (typeof dayNum !== 'number') continue;

    const date = new Date(year, month - 1, dayNum);
    const dow = dowRow ? dowRow[c] : null;
    const isWeekday = dow ? ['Po','Út','St','Čt','Pá'].includes(dow) : (date.getDay() !== 0 && date.getDay() !== 6);

    const totalsCell = String(totalsRow[c] || '').trim();
    const m = totalsCell.match(/^(\d+)\/(\d+)$/);

    if (!isWeekday) continue; // weekends never have school; skip silently, not a data problem

    if (!m) {
      warnings.push(`Den ${dayNum}.: neočekávaný formát souhrnu ("${totalsCell}"), den byl vynechán.`);
      continue;
    }

    const presentD = parseInt(m[1], 10);
    const presentO = parseInt(m[2], 10);

    days.push({
      day: dayNum,
      date,
      weekKey: getISOWeekString(date),
      dayIndex: (date.getDay() + 6) % 7, // Mon=0..Sun=6
      presnidavka: presentD,
      obed: presentD, // per explicit instruction: Oběd counted same as Dopoledne
      svacina: presentO,
    });

    // Informational scan of this day's two columns across all child rows
    for (const r of childRows) {
      if (String(grid[r][c] || '').trim() === 'DP') dpCount++;
      if (String(grid[r][c+1] || '').trim() === 'DP') dpCount++;
      if (String(grid[r][c] || '').trim() === '') blankWeekdayCount++;
      if (String(grid[r][c+1] || '').trim() === '') blankWeekdayCount++;
    }
  }

  if (!days.length) {
    throw new Error('V souboru nebyl rozpoznán žádný pracovní den s daty docházky.');
  }

  return { year, month, className, days, dpCount, blankWeekdayCount, totalChildren, warnings };
}

// Pure single-file parse entry point used by multi-file merge.
async function parseRosterFileSingle(file) {
  return parseRosterFile(file);
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

// ── Monthly attendance roster preview ──────────────────────
// Mirrors showBackupPreview's pattern: render a summary into the existing
// preview pane rather than building new UI. The one addition is the DP
// toggle — see the long comment above parseRosterFile for why DP itself
// doesn't need a toggle for the headcount math (the sheet's own totals
// already resolve it); this toggle exists only so the person can SEE the
// DP count and decide if it's worth a closer look before saving 20+ days
// of attendance in one click.
const MONTH_NAMES_CZ = ['', 'Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];

function renderRosterPreview(info) {
  const r = _rosterParsed;
  document.getElementById('importPreviewPane').classList.remove('hidden');
  document.getElementById('importErrorPane').classList.toggle('hidden', !r.warnings.length);
  if (r.warnings.length) {
    document.getElementById('importErrorPane').innerHTML =
      `<div class="import-error-header">⚠️ ${r.warnings.length} ${r.warnings.length === 1 ? 'upozornění' : 'upozornění'}</div>` +
      `<ul class="import-error-list">` +
      r.warnings.map(w => `<li>${escHtml(w)}</li>`).join('') + '</ul>';
  }

  const isMulti = r.classBreakdown && r.classBreakdown.length > 1;
  document.getElementById('importPreviewCount').textContent =
    `${MONTH_NAMES_CZ[r.month]} ${r.year} · ${isMulti ? r.classBreakdown.length + ' třídy' : (r.className || '')} · celkem ${r.totalChildren} dětí`;

  // Per-class summary header (only shown when multiple classes merged)
  const classHeaderHtml = isMulti
    ? `<tr style="background:#f0f7f0"><td colspan="4" style="padding:.4rem .5rem;font-size:.82rem;font-weight:600;color:#2e7d32">
        🏫 Sloučené třídy: ${r.classBreakdown.map(c => escHtml(c.name) + ' (' + c.children + ' dětí)').join(' &nbsp;+&nbsp; ')}
        &nbsp;→ celkem ${r.totalChildren} dětí
      </td></tr>
      <tr><th>Den</th><th>Přesnídávka</th><th>Oběd</th><th>Svačina</th></tr>`
    : '<tr><th>Den</th><th>Přesnídávka</th><th>Oběd</th><th>Svačina</th></tr>';

  const rowsHtml = r.days.map(d => {
    const label = `${d.day}. ${MONTH_NAMES_CZ[r.month].toLowerCase()} (${['Po','Út','St','Čt','Pá'][d.dayIndex]})`;
    return `<tr><td>${escHtml(label)}</td><td>${d.presnidavka}</td><td>${d.obed}</td><td>${d.svacina}</td></tr>`;
  }).join('');

  const dpInfoHtml = (r.dpCount > 0 || r.blankWeekdayCount > 0)
    ? `<tr><td colspan="4" style="padding-top:.75rem">
        <div style="font-size:.82rem;color:#555;background:#f8f8f8;border-radius:6px;padding:.5rem .7rem;border-left:3px solid #aaa">
          ℹ️ Soubor obsahuje <strong>${r.dpCount}</strong> záznamů „DP – přítomnost mimo program“ — počítány jako přítomné.
          ${r.blankWeekdayCount ? `Dále <strong>${r.blankWeekdayCount}</strong> prázdných buněk v pracovních dnech (státní svátky / dny bez výuky) — počítány jako nepřítomné.` : ''}
        </div>
      </td></tr>`
    : '';

  document.getElementById('importPreviewTable').innerHTML =
    classHeaderHtml + rowsHtml +
    dpInfoHtml +
    `<tr><td colspan="4"><span class="import-warn">⚠️ Import <strong>přepíše</strong> docházku pro ${r.days.length}
      dnů uvedených výše ve všech zobrazeních (všichni uživatelé). Tuto akci nelze vrátit zpět.</span></td></tr>`;

  document.getElementById('btnDoImport').disabled = false;
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
  if (cfg.mode === 'roster') {
    doRosterImport();
    return;
  }
  doCsvImport();
}

async function doRosterImport() {
  if (!_rosterParsed) { toast('Nejprve vyberte platný soubor měsíčního přehledu.', 'error'); return; }
  const r = _rosterParsed;

  const bulkRows = [];
  r.days.forEach(d => {
    [['presnidavka', d.presnidavka], ['obed', d.obed], ['svacina', d.svacina]].forEach(([meal, count]) => {
      bulkRows.push({
        org_id: window.SYNC.ORG_ID,
        week_key: d.weekKey,
        day_index: d.dayIndex,
        meal,
        age_group: 'ms_3_6',
        child_count: count,
      });
    });
  });

  const btn = document.getElementById('btnDoImport');
  btn.disabled = true;
  toast('Ukládám docházku do databáze…', 'info');

  try {
    // Write to Supabase FIRST — the attendance grid only updates once this
    // succeeds, so a failed import never leaves the screen showing
    // something that wasn't actually saved.
    await dbPut('/api/db/attendance/bulk', { rows: bulkRows });

    // Re-fetch every affected week from the cloud rather than trusting
    // the parsed values directly, so what's on screen always reflects
    // what's actually now in the database.
    const weeks = [...new Set(r.days.map(d => d.weekKey))];
    await Promise.all(weeks.map(w => loadAttendanceWeekFromCloud(w)));

    // Close the modal FIRST so its overlay is out of the way before we
    // switch tabs and set the week — otherwise the modal teardown races
    // with the tab/dropdown update and the grid never becomes visible.
    closeImport();
    toast(`Docházka importována: ${r.days.length} dnů (${MONTH_NAMES_CZ[r.month]} ${r.year}).`, 'success');

    // Let the DOM finish painting (modal hidden, toast shown) before we
    // manipulate the attendance tab and dropdowns.
    await new Promise(resolve => requestAnimationFrame(resolve));
    await showImportedAttendanceWeek(firstWeekWithAttendance(
      r.days,
      d => d.weekKey,
      d => [d.presnidavka, d.obed, d.svacina]
    ));
  } catch (err) {
    btn.disabled = false;
    toast('Import se nepodařilo uložit do databáze: ' + err.message, 'error');
  }
}

async function doBackupRestore() {
  if (!_importBackupData) { toast('Nejprve vyberte platný soubor zálohy.', 'error'); return; }
  if (!confirm('Obnovit data ze zálohy do databáze? Aktuální data v sekcích, které záloha obsahuje, budou v databázi přepsána pro VŠECHNY uživatele. Tuto akci nelze vrátit zpět.')) {
    return;
  }

  const d = _importBackupData.data || {};
  const restored = [];
  const failed = [];
  const orgId = window.SYNC.ORG_ID;

  toast('Obnovuji ze zálohy do databáze…', 'info');

  // Menu: upsert is keyed on (org_id, week_key), so we need a week_key.
  // The backup's currentMenu doesn't carry one explicitly — derive it from
  // fetchedAt the same way fetchMenu() does for a freshly-fetched menu.
  if (d.currentMenu !== undefined && d.currentMenu !== null) {
    try {
      const weekKey = getWeekKey(new Date(d.currentMenu.fetchedAt || Date.now()));
      await dbPost('/api/db/menus', {
        org_id: orgId,
        week_key: weekKey,
        raw_text: d.currentMenu.raw || '',
        days_json: d.currentMenu.days || [],
        ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
      });
      restored.push('jídelníček');
    } catch (err) { failed.push('jídelníček: ' + err.message); }
  }

  // Ledger: replace entirely — delete every existing row for this org,
  // then re-insert the backup's rows split by type (the bulk endpoints
  // only accept one type at a time).
  if (Array.isArray(d.ledger)) {
    try {
      await Promise.all(STATE.ledger.map(item => dbDelete(`/api/db/ledger/${item.id}`).catch(() => {})));
      const toEntry = e => ({
        org_id: orgId, name: e.name, food_group: e.foodGroup || null,
        qty: e.qty, unit: e.unit, grams: e.grams, price: e.price || 0,
        store: e.store || '', promo: !!e.promo, week_key: e.weekKey || getWeekKey(),
        source: e.source || 'manual',
      });
      const inRows = d.ledger.filter(e => e.type === 'in').map(toEntry);
      const outRows = d.ledger.filter(e => e.type === 'out').map(toEntry);
      if (inRows.length) await dbPost('/api/db/ledger/bulk-in', { entries: inRows });
      if (outRows.length) await dbPost('/api/db/ledger/bulk-out', { entries: outRows });
      restored.push(`sklad (${d.ledger.length})`);
    } catch (err) { failed.push('sklad: ' + err.message); }
  }

  // Attendance: write every (day, meal) cell from every week in the backup.
  if (d.attendance && typeof d.attendance === 'object') {
    try {
      const rows = [];
      Object.entries(d.attendance).forEach(([week, days]) => {
        Object.entries(days || {}).forEach(([day, meals]) => {
          Object.entries(meals || {}).forEach(([meal, count]) => {
            rows.push({ org_id: orgId, week_key: week, day_index: parseInt(day, 10), meal, age_group: 'ms_3_6', child_count: count });
          });
        });
      });
      if (rows.length) await dbPut('/api/db/attendance/bulk', { rows });
      restored.push(`docházka (${Object.keys(d.attendance).length} týdnů)`);
    } catch (err) { failed.push('docházka: ' + err.message); }
  }

  // Cart is session-only working state (never persisted to Supabase),
  // so restoring it just means putting it back into memory for this tab.
  if (Array.isArray(d.cart)) {
    STATE.cart = d.cart;
    restored.push(`nákupní seznam (${d.cart.length})`);
  }

  // Re-fetch everything from the cloud so the screen reflects exactly
  // what's now in the database, not what we think we just wrote.
  await refreshAllFromCloud();

  closeImport();
  if (typeof renderAll === 'function') renderAll();
  if (typeof renderAttendanceGrid === 'function') renderAttendanceGrid();

  if (failed.length) {
    toast(`Obnoveno: ${restored.join(', ') || '–'}. Nepodařilo se: ${failed.join('; ')}`, 'error');
  } else {
    toast(`Obnoveno ze zálohy do databáze: ${restored.join(', ') || 'žádná sekce nerozpoznána'}.`, restored.length ? 'success' : 'warning');
  }
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
        groqParseMenu(text.slice(0, 6000)).then(async parsed => {
          const fetchedAt = new Date().toISOString();
          const ingredients = extractIngredients(parsed);
          try {
            await dbPost('/api/db/menus', {
              org_id: window.SYNC.ORG_ID,
              week_key: getWeekKey(new Date(fetchedAt)),
              raw_text: text,
              days_json: parsed,
              ingredients,
            });
            STATE.currentMenu = { fetchedAt, raw: text, days: parsed };
            STATE.ingredients = ingredients;
            renderMenu();
            renderIngredients();
            toast('Jídelníček importován!', 'success');
          } catch (err) {
            toast('Jídelníček se nepodařilo uložit do databáze: ' + err.message, 'error');
          }
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

async function doCsvImport() {
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
  let attendanceFirstWeek = null; // set only for attendance CSV imports
  const errors = [];

  try {
    switch (_importSection) {
      case 'attendance': {
        // importAttendance returns {count, firstWeek} so WE can close the
        // modal before navigating — if it navigated internally the overlay
        // would still be open and fight the tab/dropdown switch.
        const result = await importAttendance(data, val, errors);
        imported = result.count;
        attendanceFirstWeek = result.firstWeek;
        break;
      }

      case 'offers':
        imported = importOffers(data, val, errors);
        break;

      case 'warehouse':
      case 'finance':
        imported = await importWarehouse(data, val, errors);
        break;
    }
  } catch (err) {
    toast('Import se nepodařilo uložit do databáze: ' + err.message, 'error');
    return;
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
    // the rest of the modal. The user closes it manually once revealed.
    toast(`Import: ${imported} přijato, ${errors.length} chyb. Podrobnosti níže.`, 'warning');
    console.warn('Import errors:', errors);
    return;
  }

  // Close the modal overlay BEFORE switching tabs/dropdowns so the
  // modal teardown doesn't race with the attendance grid becoming visible.
  closeImport();
  toast(`Importováno ${imported} záznamů!`, 'success');

  if (attendanceFirstWeek) {
    // Let the DOM finish painting (modal hidden, toast visible) before
    // manipulating the attendance tab and week dropdowns.
    await new Promise(resolve => requestAnimationFrame(resolve));
    await showImportedAttendanceWeek(attendanceFirstWeek);
  }
}

// ── Section-specific importers ────────────────────────────

async function importAttendance(data, val, errors) {
  // attendanceData is keyed as { [isoWeekStr]: { [dayIndex 0-4]: { presnidavka, obed, svacina } } } —
  // see MEALS_LIST / renderAttendanceGrid in app.js. Using any other shape or
  // key names means the import silently never appears anywhere in the UI.
  if (typeof attendanceData === 'undefined') {
    errors.push({ row: '-', field: '-', reason: 'Modul docházky není načten.' });
    return 0;
  }

  const bulkRows = [];
  const affectedWeeks = new Set();
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

    const cell = {};
    if (val(row, 'presnidavka') !== '') cell.presnidavka = parseInt(val(row, 'presnidavka'), 10) || 0;
    if (val(row, 'obed')        !== '') cell.obed        = obed || 0;
    if (val(row, 'svacina')     !== '') cell.svacina     = parseInt(val(row, 'svacina'), 10) || 0;

    // DB schema is one row per (org, week, day, meal) — emit a row for
    // each meal actually present on this line, not just "obed".
    Object.entries(cell).forEach(([meal, value]) => {
      bulkRows.push({
        org_id:      window.SYNC.ORG_ID,
        week_key:    weekStr,
        day_index:   dayIndex,
        meal,
        age_group:   'ms_3_6',
        child_count: value,
      });
    });
    affectedWeeks.add(weekStr);
    count++;
  });

  if (bulkRows.length) {
    // Write to Supabase FIRST — attendanceData/the grid only update once
    // this succeeds, so a failed import never shows data that isn't saved.
    await dbPut('/api/db/attendance/bulk', { rows: bulkRows });
    const weeks = [...affectedWeeks];
    await Promise.all(weeks.map(w => loadAttendanceWeekFromCloud(w)));
    // Return the target week so the caller (doCsvImport) can close the
    // modal overlay FIRST and then navigate — if we navigate here the
    // modal is still open and fights the tab/dropdown switch.
    return { count, firstWeek: firstWeekWithAttendance(
      bulkRows,
      row => row.week_key,
      row => [row.child_count]
    ) };
  }

  return { count, firstWeek: null };
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
    if (typeof renderShoppingList === 'function') renderShoppingList();
  }
  if (dupes) {
    errors.push({ row: '-', field: '-', reason: `${dupes} ${dupes === 1 ? 'řádek byl přeskočen' : 'řádků bylo přeskočeno'} jako duplicita (stejný název+obchod+množství už v seznamu)` });
  }
  return count;
}

async function importWarehouse(data, val, errors) {
  if (typeof STATE === 'undefined') {
    errors.push({ row: '-', field: '-', reason: 'Stav appky není načten.' });
    return 0;
  }
  const ledger = STATE.ledger || [];

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
      type, name,
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
    };

    const key = existingKey(entry);
    if (seen.has(key)) { dupes++; return; }
    seen.add(key);

    newEntries.push(entry);
  });

  if (dupes) {
    errors.push({ row: '-', field: '-', reason: `${dupes} ${dupes === 1 ? 'řádek byl přeskočen' : 'řádků bylo přeskočeno'} jako duplicita (stejná surovina+obchod+množství+datum už ve skladu)` });
  }

  if (newEntries.length) {
    // Write to Supabase FIRST — the warehouse view only updates once this
    // succeeds, so a failed import never shows data that isn't really saved.
    const orgId = window.SYNC.ORG_ID;
    const toRow = e => ({ org_id: orgId, name: e.name, food_group: e.foodGroup, qty: e.qty, unit: e.unit, grams: e.grams, price: e.price, store: e.store, promo: e.promo, week_key: e.weekKey, source: e.source });
    const inEntries  = newEntries.filter(e => e.type === 'in');
    const outEntries = newEntries.filter(e => e.type === 'out');

    if (inEntries.length)  await dbPost('/api/db/ledger/bulk-in',  { entries: inEntries.map(toRow) });
    if (outEntries.length) await dbPost('/api/db/ledger/bulk-out', { entries: outEntries.map(toRow) });

    await loadLedgerFromCloud();
    if (typeof renderWarehouse === 'function') renderWarehouse();
    if (typeof renderFinance === 'function') renderFinance();
    if (typeof renderStockBalance === 'function') renderStockBalance();
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
