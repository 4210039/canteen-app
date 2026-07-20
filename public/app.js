/* ═══════════════════════════════════════════════════════════
   Canteen Smart Manager – app.js
   Supabase is the ONLY source of truth. There is no local
   persistence anywhere in this app: every read fetches fresh
   from the database and every write goes to the database
   before the UI updates. If the database is unreachable, the
   action fails loudly — there is no offline fallback.
   API calls go through the local Express proxy (/api/*)

   DATA MODEL (ledger-based warehouse):
   ledger: [{
     id, type: 'in' | 'out',
     name, foodGroup,        // foodGroup = key from NORMS.foodGroups, or null
     qty, unit,               // qty in the item's natural unit
     grams,                   // qty normalized to grams (best-effort) for norm math
     price,                   // total Kč for this line (0 for 'out' consumption entries)
     store,                   // supplier/store name, or 'Spotřeba' for consumption
     promo,                   // boolean
     date,                     // ISO timestamp
     weekKey,                  // ISO week the entry belongs to
     source: 'shopping'|'manual'|'consumption'
   }]
═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
// In-memory ONLY. This is a cache of what's currently in Supabase,
// rebuilt from scratch every time refreshAllFromCloud() runs (login,
// tab/page open, and after every mutating action). Nothing here is
// ever written to disk in the browser.
const STATE = {
  currentMenu: null,        // { fetchedAt, raw, days: [{name, meals:[]}] }
  ingredients: [],          // string[]
  ledger: [],                // unified income/outcome transactions (see model above)
  cart: [],                  // current shopping list draft, built from norms calc (session-only, not persisted to DB)
  products: [],              // product catalogue cache [{id,name,brand,category_l1,category_l2,food_group,default_unit,default_store}]
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Approximate unit → grams conversion for norm math (best effort)
const UNIT_TO_GRAMS = { kg: 1000, g: 1, l: 1000, ml: 1, ks: 100, bal: 250 };
function toGrams(qty, unit) {
  return Math.round((parseFloat(qty) || 0) * (UNIT_TO_GRAMS[unit] || 100));
}

// ── Cloud-only data loading ──────────────────────────────────
// Maps a raw inventory_ledger row from Supabase into the shape the
// rest of the app expects (camelCase, `date` instead of `created_at`).
function ledgerRowFromDb(r) {
  return {
    id: r.id, type: r.type, name: r.name, foodGroup: r.food_group,
    qty: r.qty, unit: r.unit, grams: r.grams, price: r.price,
    store: r.store, promo: r.promo, date: r.created_at, weekKey: r.week_key,
    source: r.source,
  };
}

// Fetch the full inventory ledger for the current org from Supabase
// and replace STATE.ledger with it. Throws on failure — callers decide
// how to surface that (there is no local fallback to fall back to).
async function loadLedgerFromCloud() {
  const orgId = window.SYNC.ORG_ID;
  const res = await authedFetch(`/api/db/ledger/${orgId}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Sklad: HTTP ${res.status}`);
  const rows = await res.json();
  STATE.ledger = rows.map(ledgerRowFromDb);
  // Re-render live-checked rules (ryby/luštěniny frequency) now that ledger is fresh
  renderFreqRules();
}

// Fetch the most recent saved menu for the current org from Supabase
// and use it as the current menu, if one exists.
async function loadCurrentMenuFromCloud() {
  const orgId = window.SYNC.ORG_ID;
  const res = await authedFetch(`/api/db/menus/${orgId}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Jídelníček: HTTP ${res.status}`);
  const rows = await res.json();
  if (rows.length) {
    const newest = rows[0]; // already ordered newest-first by the server
    STATE.currentMenu = { fetchedAt: newest.fetched_at, raw: newest.raw_text || '', days: newest.days_json || [] };
    STATE.ingredients = Array.isArray(newest.ingredients) && newest.ingredients.length
      ? newest.ingredients
      : extractIngredients(newest.days_json || []);
  } else {
    STATE.currentMenu = null;
    STATE.ingredients = [];
  }
}

// Fetch attendance for the currently-selected week from Supabase into
// attendanceData[weekStr]. Other weeks already in attendanceData (e.g.
// loaded earlier this session) are left alone.
async function loadAttendanceWeekFromCloud(weekStr) {
  const orgId = window.SYNC.ORG_ID;
  const res = await authedFetch(`/api/db/attendance/${orgId}/${weekStr}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Docházka: HTTP ${res.status}`);
  const rows = await res.json();
  const weekData = {};
  for (const r of rows) {
    if (!weekData[r.day_index]) weekData[r.day_index] = {};
    weekData[r.day_index][r.meal] = r.child_count;
  }
  attendanceData[weekStr] = weekData;
}

// Refreshes every cloud-backed section in one go. Called after login
// and whenever a tab/page is (re)opened, per "always re-fetch" — this
// is the only thing standing in for the old loadAll()/loadAttendance().
async function loadProductsFromCloud() {
  const orgId = window.SYNC?.ORG_ID;
  if (!orgId) return;
  const res = await authedFetch(`/api/db/products/${orgId}`);
  if (!res.ok) throw new Error(`products HTTP ${res.status}`);
  STATE.products = await res.json();
}

async function refreshAllFromCloud() {
  setStatus('busy', 'Synchronizuji s databází…');
  try {
    await Promise.all([
      loadLedgerFromCloud(),
      loadCurrentMenuFromCloud(),
      loadAttendanceWeekFromCloud(getCurrentAttWeek()),
      loadProductsFromCloud(),
    ]);
    setStatus('ok', 'Synchronizováno');
    return true;
  } catch (err) {
    setStatus('error', 'Chyba synchronizace');
    toast('Nepodařilo se načíst data z databáze: ' + err.message, 'error');
    return false;
  }
}

// ── Week key (YYYY-WNN) ────────────────────────────────────
function getWeekKey(d = new Date()) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
function weekKeyLabel(wk) {
  const [year, w] = wk.split('-W');
  return `Týden ${w} / ${year}`;
}

// ── Status indicator ───────────────────────────────────────
function setStatus(state, label) {
  const dot = document.getElementById('statusDot');
  const lbl = document.getElementById('statusLabel');
  dot.className = 'status-dot ' + (state || '');
  lbl.textContent = label;
}

// ── Toast ──────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 3500);
}

// ── Tab navigation ─────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      // Lazy-load tab-specific data
      if (btn.dataset.tab === 'audit') loadAuditLog();
      if (btn.dataset.tab === 'nakup') loadNakupWeekShortcuts();
    });
  });
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
  if (name === 'nakup') loadNakupWeekShortcuts();
}

// ══════════════════════════════════════════════════════════
// MENU TAB
// ══════════════════════════════════════════════════════════

async function fetchMenu() {
  setStatus('busy', 'Načítám jídelníček…');
  const btn = document.getElementById('btnFetchMenu');
  btn.disabled = true;

  try {
    const res = await fetch('/api/fetch-menu');
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const { html, fetchedAt } = await res.json();

    // Extract visible text from HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // Remove scripts/styles
    doc.querySelectorAll('script,style,noscript').forEach(el => el.remove());
    const text = doc.body ? doc.body.innerText || doc.body.textContent : html;
    const trimmed = text.replace(/\s{3,}/g, '\n\n').trim().slice(0, 6000);

    // Ask Groq to parse
    setStatus('busy', 'Analyzuji jídelníček…');
    const parsed = await groqParseMenu(trimmed);
    const ingredients = extractIngredients(parsed);

    // Write to Supabase FIRST — it's the only place this data lives.
    // If this fails, nothing changes on screen.
    setStatus('busy', 'Ukládám do databáze…');
    const weekKey = getWeekKey(new Date(fetchedAt));
    await dbPost('/api/db/menus', {
      org_id: window.SYNC.ORG_ID,
      week_key: weekKey,
      raw_text: trimmed,
      days_json: parsed,
      ingredients,
    });

    STATE.currentMenu = { fetchedAt, raw: trimmed, days: parsed };
    STATE.ingredients = ingredients;

    renderMenu();
    renderIngredients();
    renderFreqRules();
    setStatus('ok', 'Jídelníček načten');
    toast('Jídelníček úspěšně načten!', 'success');

    document.getElementById('lastCheck').textContent =
      'Poslední kontrola: ' + new Date(fetchedAt).toLocaleString('cs-CZ');
  } catch (err) {
    setStatus('error', 'Chyba');
    toast('Chyba při načítání: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

async function groqParseMenu(menuText) {
  const body = {
    model: 'llama-3.3-70b-versatile',
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: 'Jsi asistent pro školní jídelnu. Vracíš POUZE čisté JSON bez markdown bloků, bez vysvětlení.'
      },
      {
        role: 'user',
        content: `Analyzuj tento text jídelníčku školní jídelny a extrahuj strukturovaná data.
Vrať POUZE JSON v tomto formátu (bez markdown, bez vysvětlení):
{
  "week": "popis týdne nebo datum",
  "days": [
    {
      "name": "Pondělí",
      "date": "DD.MM.",
      "meals": [
        {"label": "Přesnídávka", "dish": "název jídla"},
        {"label": "Oběd", "dish": "název jídla"},
        {"label": "Svačina", "dish": "název jídla"}
      ]
    }
  ]
}

Text jídelníčku:
${menuText}`
      }
    ]
  };

  const res = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const text = data.choices?.[0]?.message?.content || '{}';
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed.days || [];
  } catch {
    return [{ name: 'Nezpracováno', date: '', meals: [{ label: 'Info', dish: menuText.slice(0, 300) }] }];
  }
}

function extractIngredients(days) {
  // Ask Claude to list raw ingredients from all dishes
  // We'll do this lazily – store dish names and extract on demand
  const dishes = [];
  for (const day of days) {
    for (const meal of (day.meals || [])) {
      if (meal.dish) dishes.push(meal.dish);
    }
  }
  return dishes;
}

function renderMenu() {
  const container = document.getElementById('menuContent');
  if (!STATE.currentMenu || !STATE.currentMenu.days?.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📅</span><p>Jídelníček se nepodařilo načíst. Zkuste to znovu.</p></div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'week-grid';

  for (const day of STATE.currentMenu.days) {
    const card = document.createElement('div');
    card.className = 'day-card';
    const meals = (day.meals || []).map(m =>
      `<div class="meal-label">${escHtml(m.label)}</div><div class="meal">${escHtml(m.dish)}</div>`
    ).join('');
    card.innerHTML = `<div class="day-name">${escHtml(day.name)} ${escHtml(day.date || '')}</div>${meals}`;
    grid.appendChild(card);
  }
  container.innerHTML = '';
  container.appendChild(grid);
}

function renderIngredients() {
  const panel = document.getElementById('ingredientsPanel');
  const list  = document.getElementById('ingredientsList');
  if (!STATE.ingredients?.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  list.innerHTML = STATE.ingredients.map(ing =>
    `<span class="chip">🥕 ${escHtml(ing)}</span>`
  ).join('');
}

// ══════════════════════════════════════════════════════════
// SHOPPING LIST — built from norm calculation (Docházka → Přepočítat)
// ══════════════════════════════════════════════════════════

const STORES = [
  { id: 'kupi',     name: 'Kupi.cz',  label: 'Akce',      search: 'https://www.kupi.cz/sleva/{q}',   type: 'search' },
  { id: 'kupi_all', name: 'Kupi.cz',  label: 'Hledat vše', search: 'https://www.kupi.cz/hledej?f={q}', type: 'search' },
  { id: 'lidl',     name: 'Lidl',     label: 'Leták',  search: 'https://www.kupi.cz/letaky/lidl',     type: 'browse' },
  { id: 'kaufland', name: 'Kaufland', label: 'Leták',  search: 'https://www.kupi.cz/letaky/kaufland', type: 'browse' },
  { id: 'albert',   name: 'Albert',   label: 'Leták',  search: 'https://www.kupi.cz/letaky/albert',   type: 'browse' },
  { id: 'globus',   name: 'Globus',   label: 'Leták',  search: 'https://www.kupi.cz/letaky/globus',   type: 'browse' },
  { id: 'billa',    name: 'Billa',    label: 'Leták',  search: 'https://www.kupi.cz/letaky/billa',    type: 'browse' },
  { id: 'tesco',    name: 'Tesco',    label: 'Leták',  search: 'https://www.kupi.cz/letaky/tesco',    type: 'browse' },
];

/* ── Inline SVG logos — brand-faithful, no external deps ─── */
const STORE_LOGOS = {

  /* Kupi.cz — orange wordmark, shopping tag icon */
  kupi: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="12" fill="#FF6A00"/>
    <polygon points="22,14 38,14 46,22 46,38 30,50 14,38 14,22" fill="#FF8C38" opacity="0.5"/>
    <circle cx="30" cy="20" r="3.5" fill="none" stroke="#fff" stroke-width="2"/>
    <path d="M21,24 h18 l-3,14 H24 Z" fill="#fff"/>
    <text x="30" y="43" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="7.5" font-weight="900" fill="#FF6A00" letter-spacing="0.5">KUPI.CZ</text>
  </svg>`,

  kupi_all: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="12" fill="#FF6A00"/>
    <polygon points="22,14 38,14 46,22 46,38 30,50 14,38 14,22" fill="#FF8C38" opacity="0.5"/>
    <circle cx="30" cy="20" r="3.5" fill="none" stroke="#fff" stroke-width="2"/>
    <path d="M21,24 h18 l-3,14 H24 Z" fill="#fff"/>
    <text x="30" y="43" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="7.5" font-weight="900" fill="#FF6A00" letter-spacing="0.5">KUPI.CZ</text>
  </svg>`,

  /* Lidl — blue square, yellow circle ring, red inner disc, white italic wordmark */
  lidl: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="10" fill="#0050AA"/>
    <circle cx="30" cy="29" r="21" fill="#FFD700"/>
    <circle cx="30" cy="29" r="16" fill="#E30613"/>
    <text x="30" y="34" text-anchor="middle"
      font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="900"
      font-style="italic" fill="#fff" letter-spacing="1">Lidl</text>
  </svg>`,

  /* Kaufland — red background, white bold K with yellow horizontal bar */
  kaufland: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="10" fill="#ED1D24"/>
    <text x="30" y="38" text-anchor="middle"
      font-family="Arial Black,Arial,sans-serif" font-size="30" font-weight="900"
      fill="#fff" letter-spacing="-1">K</text>
    <rect x="12" y="42" width="36" height="4" rx="2" fill="#FFD700"/>
    <text x="30" y="55" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="6.5" font-weight="700"
      fill="#fff" letter-spacing="1.5">KAUFLAND</text>
  </svg>`,

  /* Albert — white background, red arch/wave swoosh, bold red Albert wordmark */
  albert: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="10" fill="#fff" stroke="#e8e8e8" stroke-width="1"/>
    <path d="M8,38 Q20,10 30,18 Q40,26 52,14" fill="none" stroke="#E2001A" stroke-width="5" stroke-linecap="round"/>
    <text x="30" y="52" text-anchor="middle"
      font-family="Arial Black,Arial,sans-serif" font-size="11" font-weight="900"
      fill="#E2001A" letter-spacing="-0.5">albert</text>
  </svg>`,

  /* Globus — blue background, clean white globe wireframe, yellow G accent */
  globus: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="10" fill="#003E87"/>
    <circle cx="30" cy="27" r="16" fill="none" stroke="#fff" stroke-width="2"/>
    <ellipse cx="30" cy="27" rx="8" ry="16" fill="none" stroke="#fff" stroke-width="1.5"/>
    <line x1="14" y1="21" x2="46" y2="21" stroke="#fff" stroke-width="1.2" opacity="0.7"/>
    <line x1="14" y1="27" x2="46" y2="27" stroke="#fff" stroke-width="1.5"/>
    <line x1="14" y1="33" x2="46" y2="33" stroke="#fff" stroke-width="1.2" opacity="0.7"/>
    <text x="30" y="53" text-anchor="middle"
      font-family="Arial Black,Arial,sans-serif" font-size="8" font-weight="900"
      fill="#FFD200" letter-spacing="2">GLOBUS</text>
  </svg>`,

  /* Billa — white background, bold yellow BILLA on red diagonal band (2019 style) */
  billa: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="10" fill="#fff" stroke="#e8e8e8" stroke-width="1"/>
    <clipPath id="bc"><rect width="60" height="60" rx="10"/></clipPath>
    <g clip-path="url(#bc)">
      <rect x="-10" y="16" width="90" height="28" transform="rotate(-8,30,30)" fill="#E30613"/>
    </g>
    <text x="30" y="35" text-anchor="middle"
      font-family="Arial Black,Arial,sans-serif" font-size="16" font-weight="900"
      fill="#FFD700" letter-spacing="1" transform="rotate(-8,30,30)">BILLA</text>
  </svg>`,

  /* Tesco — white background, blue wordmark, 3 brand stripes (red/blue/red) below */
  tesco: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="60" rx="10" fill="#fff" stroke="#e8e8e8" stroke-width="1"/>
    <text x="30" y="30" text-anchor="middle"
      font-family="Arial Black,Arial,sans-serif" font-size="14" font-weight="900"
      fill="#00539F" letter-spacing="-0.5">Tesco</text>
    <rect x="11" y="35" width="38" height="4" rx="2" fill="#E30613"/>
    <rect x="11" y="41" width="38" height="4" rx="2" fill="#00539F"/>
    <rect x="11" y="47" width="38" height="4" rx="2" fill="#E30613"/>
  </svg>`,
};

function storeSearchUrl(storeId, query) {
  const store = STORES.find(s => s.id === storeId);
  if (!store) return '#';
  return store.type === 'search' ? store.search.replace('{q}', encodeURIComponent(query)) : store.search;
}

/**
 * Akce tab: load store-search cards from last norm calculation (no buffer).
 */
function loadShoppingFromNorms() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) {
    toast('Nejprve v záložce Docházka zadejte docházku a klikněte „Přepočítat".', 'info');
    return;
  }
  renderOffers(calc);
  toast('Akce načteny z výpočtu surovin!', 'success');
}

/**
 * Nákup tab: show per-category reserve inputs then let user confirm.
 */
function loadNakupFromNorms() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) {
    toast('Nejprve v záložce Docházka zadejte docházku a klikněte „Přepočítat".', 'info');
    return;
  }

  const panel  = document.getElementById('nakupRezervaPanel');
  const grid   = document.getElementById('nakupRezervaGrid');
  const rows   = calc.results.filter(r => r.totalGrams > 0);

  document.getElementById('smartBuyToggle').checked = getSmartBuyMode();

  renderNakupGrid(rows);

  panel.classList.remove('hidden');
  document.getElementById('shoppingPanel').classList.add('hidden');
  toast('Sklad je zohledněn automaticky — upravte rezervu, pokud chcete koupit víc.', 'info');
}

const UNIT_OPTIONS = ['%', 'g', 'kg', 'l', 'ml', 'ks', 'bal'];

function renderNakupGrid(rows) {
  const grid = document.getElementById('nakupRezervaGrid');
  const stockByRowKey = computeStockByRowKey();
  const smartOn = getSmartBuyMode();
  const { rates: rateByRowKey } = computeConsumptionRatePerRowKey(28);
  const bufferDays = getYearEndTaperedBufferDays();

  grid.innerHTML = rows.map(r => {
    const inStockGrams = Math.max(0, stockByRowKey[r.rowKey] || 0);
    const inStockDisplay = inStockGrams >= 1000 ? `${(inStockGrams / 1000).toFixed(2)} kg` : `${Math.round(inStockGrams)} g`;

    let baseNeedGrams;
    let needLabel;
    if (smartOn) {
      const rate = rateByRowKey[r.rowKey] || (r.totalGrams / 7); // fallback: this week's norm spread over 7 days
      const target = rate * bufferDays;
      baseNeedGrams = Math.max(0, target - inStockGrams);
      needLabel = `cíl zásoby na ${bufferDays} dní: ${target >= 1000 ? (target/1000).toFixed(1)+' kg' : Math.round(target)+' g'}`;
    } else {
      baseNeedGrams = Math.max(0, r.totalGrams - inStockGrams);
      needLabel = `týdenní potřeba: ${r.totalGrams >= 1000 ? (r.totalGrams/1000).toFixed(2)+' kg' : r.totalGrams+' g'}`;
    }

    const toBuyDisplay = baseNeedGrams >= 1000 ? `${(baseNeedGrams / 1000).toFixed(2)} kg` : `${Math.round(baseNeedGrams)} g`;

    return `<div class="rezerva-row" data-rowkey="${escHtml(r.rowKey)}" data-base-grams="${baseNeedGrams}">
      <div class="rezerva-label">
        <span class="rezerva-name">${escHtml(r.label)}</span>
        <span class="muted rezerva-norm">${escHtml(needLabel)} · na skladě: ${inStockDisplay}</span>
      </div>
      <div class="rezerva-tobuy">Navrhujeme koupit: <strong>${toBuyDisplay}</strong></div>
      <label class="rezerva-input-wrap">
        <span class="muted" style="font-size:.72rem">rezerva navíc:</span>
        <input type="number" class="rezerva-val-input" data-key="${escHtml(r.rowKey)}" value="0" min="0" step="1" />
        <select class="rezerva-unit-select" data-key="${escHtml(r.rowKey)}">
          ${UNIT_OPTIONS.map(u => `<option value="${u}">${u}</option>`).join('')}
        </select>
      </label>
    </div>`;
  }).join('');
}

/**
 * Nákup tab: read per-category reserve inputs (% or absolute unit), build
 * cart from (need − stock) + reserve, render shopping list.
 */
function applyRezervaAndBuild() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) return;

  // Collect per-category buffer values + their chosen unit
  const buffers = {}; // rowKey -> { value, unit }
  document.querySelectorAll('.rezerva-val-input').forEach(input => {
    const key = input.dataset.key;
    const unitSelect = document.querySelector(`.rezerva-unit-select[data-key="${CSS.escape(key)}"]`);
    buffers[key] = { value: Math.max(0, parseFloat(input.value) || 0), unit: unitSelect?.value || '%' };
  });

  // base (stock-adjusted) grams per row, computed by renderNakupGrid and stashed in the DOM
  const baseGramsByRowKey = {};
  document.querySelectorAll('.rezerva-row').forEach(row => {
    baseGramsByRowKey[row.dataset.rowkey] = parseFloat(row.dataset.baseGrams) || 0;
  });

  STATE.cart = calc.results
    .filter(r => r.totalGrams > 0)
    .map(r => {
      const baseGrams = baseGramsByRowKey[r.rowKey] ?? r.totalGrams;
      const buf = buffers[r.rowKey] || { value: 0, unit: '%' };
      let grams;
      if (buf.unit === '%') {
        grams = baseGrams * (1 + buf.value / 100);
      } else {
        grams = baseGrams + toGrams(buf.value, buf.unit);
      }
      grams = Math.max(0, grams);
      return {
        id: 'fg_' + r.rowKey,
        foodGroup: r.key,
        name: r.label,
        qty: grams >= 1000 ? +(grams / 1000).toFixed(2) : +grams.toFixed(0),
        unit: grams >= 1000 ? 'kg' : 'g',
        neededGrams: baseGrams,
        bufferPct: buf.unit === '%' ? buf.value : null,
        bufferAbsolute: buf.unit !== '%' ? `${buf.value} ${buf.unit}` : null,
        price: 0,
        store: '',
        promo: false,
        source: 'shopping',
      };
    })
    .filter(item => item.qty > 0); // nothing to buy this round — fully covered by stock

  document.getElementById('nakupRezervaPanel').classList.add('hidden');
  renderShoppingList();
  if (!STATE.cart.length) {
    toast('Sklad pokrývá vše, co je potřeba — není co nakupovat. 🎉', 'success');
  } else {
    toast('Nákupní seznam vytvořen — sklad byl zohledněn!', 'success');
  }
  setStatus('ok', 'Nákupní seznam připraven');
}

function renderOffers(calc) {
  const container = document.getElementById('offersContent');
  const rows = calc?.results?.filter(r => r.totalGrams > 0) || [];
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🏷️</span><p>Nejprve v záložce <strong>Docházka</strong> zadejte docházku a klikněte „Přepočítat". Pak se zde tlačítkem „Načíst z výpočtu surovin" zobrazí karty pro hledání akcí.</p></div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'offers-grid';

  for (const r of rows) {
    const normDisplay = r.totalGrams >= 1000
      ? `${+(r.totalGrams / 1000).toFixed(2)} kg`
      : `${r.totalGrams} g`;
    const card = document.createElement('div');
    card.className = 'offer-card';
    const links = STORES.map(s => {
      const svg = STORE_LOGOS[s.id] || '';
      const badgeLabel = s.type === 'search' ? 'Akce' : 'Leták';
      const badgeClass = s.type === 'search' ? 'promo' : '';
      return `<a class="store-logo-link" href="${escHtml(storeSearchUrl(s.id, r.label))}" target="_blank" rel="noopener" title="${escHtml(s.name)} – ${escHtml(s.label)}">
        <span class="store-logo-img">${svg}</span>
        <span class="store-logo-name">${escHtml(s.name)}</span>
        <span class="store-badge ${badgeClass}">${badgeLabel}</span>
      </a>`;
    }).join('');
    card.innerHTML = `<div class="ingredient-name">🥕 ${escHtml(r.label)} <span class="muted">(potřeba: ${normDisplay})</span></div>
      <div class="store-logo-grid">${links}</div>`;
    grid.appendChild(card);
  }
  container.innerHTML = '';
  container.appendChild(grid);
}

function renderShoppingList() {
  const panel = document.getElementById('shoppingPanel');
  const list  = document.getElementById('shoppingList');
  if (!STATE.cart?.length) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  list.innerHTML = '<div class="shopping-list">' + STATE.cart.map((item, i) =>
    `<div class="shopping-item ${item.source === 'custom' ? 'custom-source' : ''}">
      <input type="checkbox" id="si-${i}" checked onchange="toggleCartItem(${i}, this.checked)" />
      <label class="si-name" for="si-${i}">${escHtml(item.name)} <span class="muted">(${item.qty} ${item.unit}${item.bufferPct > 0 ? ` · +${item.bufferPct}% rezervy` : ''}${item.bufferAbsolute ? ` · +${escHtml(item.bufferAbsolute)} rezervy` : ''})</span>
        ${item.source === 'custom' ? `<span class="source-badge">vlastní dodavatel</span>` : ''}
      </label>
      <div>
        <input type="number" class="price-input" value="${item.price}" min="0" step="1"
          style="width:70px;padding:.25rem .4rem;border:1px solid #ddd;border-radius:5px;font-size:.8rem"
          onchange="updateCartPrice(${i}, this.value)" placeholder="Kč" />
      </div>
      <span class="si-store">
        <input type="text" value="${escHtml(item.store || '')}" placeholder="obchod/dodavatel"
          style="font-size:.75rem;border:1px solid #ddd;border-radius:4px;padding:.25rem;width:110px"
          onchange="updateCartStore(${i}, this.value)" />
      </span>
      <label style="display:flex;align-items:center;gap:.2rem;font-size:.72rem;color:var(--ink-light)">
        <input type="checkbox" ${item.promo ? 'checked' : ''} onchange="updateCartPromo(${i}, this.checked)" /> akce
      </label>
    </div>`
  ).join('') + '</div>';
  updateCartTotal();
}

function toggleCartItem(i, checked) {
  STATE.cart[i]._skip = !checked;
  updateCartTotal();
}
function updateCartPrice(i, val) {
  STATE.cart[i].price = parseFloat(val) || 0;
  updateCartTotal();
}
function updateCartStore(i, val) {
  STATE.cart[i].store = val;
}
function updateCartPromo(i, checked) {
  STATE.cart[i].promo = checked;
}
function updateCartTotal() {
  const total = STATE.cart
    .filter(i => !i._skip)
    .reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  document.getElementById('cartTotal').textContent =
    total > 0 ? total.toFixed(0) + ' Kč' : '– Kč (zadejte ceny)';
}

// ── Custom supplier item ────────────────────────────────────
function initCustomItemForm() {
  const groupSelect = document.getElementById('custItemGroup');
  if (groupSelect) {
    groupSelect.innerHTML = `<option value="">— bez skupiny —</option>` +
      Object.entries(window.NORMS.foodGroups).map(([key, g]) =>
        `<option value="${key}">${escHtml(g.label)}</option>`).join('');
  }

  document.getElementById('btnAddCustomItem')?.addEventListener('click', () => {
    document.getElementById('customItemForm').classList.remove('hidden');
  });
  document.getElementById('btnCancelCustomItem')?.addEventListener('click', () => {
    document.getElementById('customItemForm').classList.add('hidden');
  });
  document.getElementById('btnSaveCustomItem')?.addEventListener('click', () => {
    const name  = document.getElementById('custItemName').value.trim();
    const group = document.getElementById('custItemGroup').value || null;
    const qty   = parseFloat(document.getElementById('custItemQty').value) || 1;
    const unit  = document.getElementById('custItemUnit').value;
    const price = parseFloat(document.getElementById('custItemPrice').value) || 0;
    const supplier = document.getElementById('custItemSupplier').value.trim() || 'Vlastní dodavatel';

    if (!name) { toast('Zadejte název suroviny.', 'error'); return; }

    STATE.cart.push({
      id: 'custom_' + Date.now(),
      foodGroup: group,
      name, qty, unit, price,
      store: supplier,
      promo: false,
      source: 'custom',
    });
      renderShoppingList();
    document.getElementById('customItemForm').classList.add('hidden');
    ['custItemName','custItemQty','custItemPrice','custItemSupplier'].forEach(id => document.getElementById(id).value = '');
    toast(`Položka „${name}" přidána do nákupního seznamu.`, 'success');
  });
}

// ══════════════════════════════════════════════════════════
// CONFIRM PURCHASE → WAREHOUSE (ledger income/IN entries)
// ══════════════════════════════════════════════════════════
async function confirmPurchase() {
  const items = STATE.cart.filter(i => !i._skip && i.name);
  if (!items.length) { toast('Nákupní seznam je prázdný.', 'info'); return; }

  const weekKey = getWeekKey();
  const btn = document.getElementById('btnConfirmPurchase');
  if (btn) btn.disabled = true;
  setStatus('busy', 'Ukládám nákup do databáze…');

  try {
    const dbEntries = items.map(item => ({
      org_id: window.SYNC.ORG_ID,
      name: item.name,
      food_group: item.foodGroup || null,
      qty: item.qty,
      unit: item.unit,
      grams: toGrams(item.qty, item.unit),
      price: item.price || 0,
      store: item.store || (item.source === 'custom' ? 'Vlastní dodavatel' : 'Neuvedeno'),
      promo: !!item.promo,
      week_key: weekKey,
      source: item.source === 'custom' ? 'manual' : 'shopping',
    }));
    // Write to Supabase FIRST — the ledger only changes on screen once this succeeds.
    await dbPost('/api/db/ledger/bulk-in', { entries: dbEntries });

    // Also create + confirm a shopping list record → fires shopping.confirm audit
    try {
      const list = await dbPost('/api/db/shopping-lists', {
        org_id: window.SYNC.ORG_ID,
        week_key: weekKey,
        items: items.map(i => ({
          food_group: i.foodGroup || null,
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          needed_grams: i.neededGrams || null,
          price: i.price || 0,
          store: i.store || '',
          promo: !!i.promo,
          source: i.source === 'custom' ? 'custom' : 'norms',
        })),
      });
      if (list?.id) {
        await dbPatch(`/api/db/shopping-lists/${list.id}/confirm`, {});
      }
    } catch (e) {
      // Shopping-list record is a secondary audit trail; the ledger write
      // above is what actually represents stock, so don't fail the whole
      // purchase confirmation over this — just let the person know.
      console.warn('shopping-list record failed:', e.message);
    }

    STATE.cart = [];
    await loadLedgerFromCloud();

    renderWarehouse();
    renderStockBalance();
    renderFinance();
    document.getElementById('shoppingPanel').classList.add('hidden');
    setStatus('ok', 'Nákup uložen');
    toast(`${items.length} položek přijato na sklad!`, 'success');
    switchTab('warehouse');
  } catch (err) {
    setStatus('error', 'Chyba ukládání');
    toast('Nákup se nepodařilo uložit do databáze: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════
// CONSUME WEEK → WAREHOUSE (ledger outcome/OUT entries)
// Deducts the calculated norm requirement for the selected week
// from stock, representing food that was cooked & served.
// ══════════════════════════════════════════════════════════
async function consumeWeek() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) {
    toast('Nejprve v záložce Docházka spočítejte suroviny pro daný týden („Přepočítat").', 'info');
    return;
  }

  const weekKey = calc.weekKey || getWeekKey();

  // Check if this week was already consumed to avoid double-deduction
  const alreadyConsumed = STATE.ledger.some(e => e.type === 'out' && e.weekKey === weekKey && e.source === 'consumption');
  if (alreadyConsumed) {
    if (!confirm(`Spotřeba pro týden ${weekKeyLabel(weekKey)} už byla jednou odepsána. Odepsat znovu?`)) return;
  }

  const dbOutEntries = calc.results
    .filter(r => r.totalGrams > 0)
    .map(r => ({
      org_id: window.SYNC.ORG_ID,
      name: r.label,
      food_group: r.key,
      qty: r.totalGrams >= 1000 ? +(r.totalGrams / 1000).toFixed(2) : r.totalGrams,
      unit: r.totalGrams >= 1000 ? 'kg' : 'g',
      grams: r.totalGrams,
      price: 0,
      store: 'Spotřeba (vařeno a vydáno)',
      promo: false,
      week_key: weekKey,
      source: 'consumption',
    }));

  if (!dbOutEntries.length) {
    toast('Výpočet neobsahuje žádné suroviny ke spotřebě.', 'info');
    return;
  }

  setStatus('busy', 'Ukládám spotřebu do databáze…');
  try {
    await dbPost('/api/db/ledger/bulk-out', { entries: dbOutEntries });
    await loadLedgerFromCloud();

    renderWarehouse();
    renderStockBalance();
    renderFinance();
    setStatus('ok', 'Spotřeba odepsána');
    toast(`Spotřeba týdne ${weekKeyLabel(weekKey)} odepsána ze skladu (${dbOutEntries.length} skupin potravin).`, 'success');
  } catch (err) {
    setStatus('error', 'Chyba ukládání');
    toast('Spotřebu se nepodařilo odepsat: ' + err.message, 'error');
  }
}

/**
 * Sklad tab: load norm calculation results directly as incoming stock receipts.
 * Mirrors confirmPurchase() but sources directly from LAST_CALC (no cart needed).
 */
async function warehouseFromNorms() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) {
    toast('Nejprve v záložce Docházka zadejte docházku a klikněte „Přepočítat".', 'info');
    return;
  }

  const rows = calc.results.filter(r => r.totalGrams > 0);
  if (!rows.length) { toast('Výpočet neobsahuje žádné suroviny.', 'info'); return; }

  if (!confirm(`Přidat ${rows.length} skupin surovin z výpočtu jako příjem na sklad?`)) return;

  const weekKey = calc.weekKey || getWeekKey();

  const dbEntries = rows.map(r => {
    const qty  = r.totalGrams >= 1000 ? +(r.totalGrams / 1000).toFixed(2) : r.totalGrams;
    const unit = r.totalGrams >= 1000 ? 'kg' : 'g';
    return {
      org_id: window.SYNC.ORG_ID,
      name: r.label,
      food_group: r.key,
      qty, unit,
      grams: r.totalGrams,
      price: 0,
      store: 'Z výpočtu surovin',
      promo: false,
      week_key: weekKey,
      source: 'shopping',
    };
  });

  setStatus('busy', 'Ukládám do databáze…');
  try {
    await dbPost('/api/db/ledger/bulk-in', { entries: dbEntries });
    await loadLedgerFromCloud();

    renderWarehouse();
    renderStockBalance();
    renderFinance();
    setStatus('ok', 'Uloženo');
    toast(`${rows.length} skupin surovin přijato na sklad z výpočtu!`, 'success');
  } catch (err) {
    setStatus('error', 'Chyba ukládání');
    toast('Nepodařilo se uložit do databáze: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// WAREHOUSE TAB — Stock balance + full ledger
// ══════════════════════════════════════════════════════════

/**
 * Compute current stock balance per ingredient name:
 * sum of IN grams minus sum of OUT grams.
 */
function computeStockBalance() {
  const byName = {};
  for (const e of STATE.ledger) {
    const key = e.name;
    if (!byName[key]) {
      byName[key] = { name: e.name, foodGroup: e.foodGroup, grams: 0, value: 0, lastUnit: e.unit };
    }
    const sign = e.type === 'in' ? 1 : -1;
    byName[key].grams += sign * (e.grams || toGrams(e.qty, e.unit));
    if (e.type === 'in') byName[key].value += (e.price || 0);
    byName[key].lastUnit = e.unit;
  }
  return Object.values(byName).sort((a, b) => b.grams - a.grams);
}

function renderStockBalance() {
  const container = document.getElementById('stockBalance');
  const balance = computeStockBalance();
  if (!balance.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📊</span><p>Sklad je prázdný.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="stock-grid">` + balance.map(b => {
    const displayQty = b.grams >= 1000 ? `${(b.grams/1000).toFixed(2)} kg` : `${b.grams} g`;
    const negative = b.grams < 0;
    return `
      <div class="stock-card ${negative ? 'negative' : ''}">
        <span class="sc-name">${escHtml(b.name)}</span>
        <span class="sc-qty">${negative ? '⚠️ ' : ''}${displayQty}</span>
        <span class="sc-meta">Hodnota nákupů: ${b.value.toFixed(0)} Kč</span>
      </div>`;
  }).join('') + `</div>`;
}

function renderWarehouse() {
  const container = document.getElementById('warehouseTable');
  if (!STATE.ledger?.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📦</span><p>Sklad je prázdný. Přidejte první položku nebo potvrďte nákupní seznam.</p></div>`;
    return;
  }

  const sorted = [...STATE.ledger].sort((a, b) => new Date(b.date) - new Date(a.date));
  container.innerHTML = `
    <div style="overflow-x:auto">
    <table class="wh-table">
      <thead>
        <tr>
          <th>Typ</th><th>Surovina</th><th>Množství</th><th>Cena</th><th>Obchod/Zdroj</th>
          <th>Akce</th><th>Týden</th><th>Datum</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(item => `
          <tr>
            <td><span class="ledger-badge ${item.type}">${item.type === 'in' ? '⬇ Příjem' : '⬆ Výdej'}</span></td>
            <td><strong>${escHtml(item.name)}</strong></td>
            <td>${item.qty} ${escHtml(item.unit)}</td>
            <td>${item.price > 0 ? item.price.toFixed(0) + ' Kč' : '–'}</td>
            <td>${escHtml(item.store || '–')}</td>
            <td><span class="${item.promo ? 'badge-promo' : 'badge-normal'}">${item.promo ? 'Akce' : 'Běžná'}</span></td>
            <td>${escHtml(item.weekKey || '–')}</td>
            <td>${new Date(item.date).toLocaleDateString('cs-CZ')}</td>
            <td><button class="btn-icon" onclick="deleteLedgerItem('${item.id}')" title="Smazat">🗑️</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>`;
}

async function deleteLedgerItem(id) {
  if (!confirm('Smazat tento záznam ze skladu?')) return;
  try {
    await dbDelete(`/api/db/ledger/${id}`);
    await loadLedgerFromCloud();
    renderWarehouse();
    renderStockBalance();
    renderFinance();
    toast('Záznam odstraněn.', 'info');
  } catch (err) {
    toast('Záznam se nepodařilo smazat: ' + err.message, 'error');
  }
}

// Add manual income item
function initWarehouseForm() {
  const groupSelect = document.getElementById('itemGroup');
  if (groupSelect) {
    groupSelect.innerHTML = `<option value="">— bez skupiny —</option>` +
      Object.entries(window.NORMS.foodGroups).map(([key, g]) =>
        `<option value="${key}">${escHtml(g.label)}</option>`).join('');
  }

  document.getElementById('btnAddItem').addEventListener('click', () => {
    document.getElementById('addItemForm').classList.remove('hidden');
  });
  document.getElementById('btnCancelItem').addEventListener('click', () => {
    document.getElementById('addItemForm').classList.add('hidden');
  });
  document.getElementById('btnSaveItem').addEventListener('click', async () => {
    const nameEl = document.getElementById('itemName');
    const name  = nameEl.value.trim();
    const foodGroup = document.getElementById('itemGroup').value || null;
    const qty   = parseFloat(document.getElementById('itemQty').value) || 1;
    const unit  = document.getElementById('itemUnit').value;
    const price = parseFloat(document.getElementById('itemPrice').value) || 0;
    const store = document.getElementById('itemStore').value;
    const promo = document.getElementById('itemPromo').value === 'true';
    const productId = nameEl._productId || null; // set by productComboApply

    if (!name) { toast('Zadejte název suroviny.', 'error'); return; }

    const weekKey = getWeekKey();
    const saveBtn = document.getElementById('btnSaveItem');
    saveBtn.disabled = true;
    try {
      await dbPost('/api/db/ledger/bulk-in', {
        entries: [{ org_id: window.SYNC.ORG_ID, name, food_group: foodGroup, qty, unit, grams: toGrams(qty, unit), price, store, promo, week_key: weekKey, source: 'manual', product_id: productId }]
      });
      await loadLedgerFromCloud();

      renderWarehouse();
      renderStockBalance();
      renderFinance();
      document.getElementById('addItemForm').classList.add('hidden');
      ['itemName','itemQty','itemPrice'].forEach(id => document.getElementById(id).value = '');
      nameEl._productId = null;
      toast('Položka přidána na sklad!', 'success');
    } catch (err) {
      toast('Položku se nepodařilo uložit: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.getElementById('btnConsumeWeek')?.addEventListener('click', consumeWeek);
  document.getElementById('btnWarehouseFromNorms')?.addEventListener('click', warehouseFromNorms);
}

// ══════════════════════════════════════════════════════════
// FINANCE TAB — fully derived from the ledger
// ══════════════════════════════════════════════════════════
function renderFinance() {
  const childCount = parseInt(document.getElementById('childCount')?.value) || 25;
  const now = new Date();
  const thisWeek = getWeekKey(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const incomeEntries = STATE.ledger.filter(e => e.type === 'in');

  const weekIncome  = incomeEntries.filter(e => e.weekKey === thisWeek);
  const monthIncome = incomeEntries.filter(e => new Date(e.date) >= monthStart && new Date(e.date) <= now);

  const weekTotal  = weekIncome.reduce((s, e) => s + (e.price || 0), 0);
  const monthTotal = monthIncome.reduce((s, e) => s + (e.price || 0), 0);
  const saved       = incomeEntries.filter(e => e.promo).reduce((s, e) => s + (e.price * 0.15), 0); // est. 15% saving

  // Current stock value = sum of IN price - proportional OUT (simplified: IN total minus consumption "cost" estimated at 0 since OUT entries carry no price)
  // We report stock value as money spent on items still in positive stock balance.
  const balance = computeStockBalance();
  const stockValue = balance.filter(b => b.grams > 0).reduce((s, b) => s + b.value, 0);

  document.getElementById('statWeek').textContent       = weekTotal.toFixed(0) + ' Kč';
  document.getElementById('statMonth').textContent      = monthTotal.toFixed(0) + ' Kč';
  document.getElementById('statSaved').textContent      = saved.toFixed(0) + ' Kč';
  document.getElementById('statStockValue').textContent = stockValue.toFixed(0) + ' Kč';
  document.getElementById('statWeekChild').textContent  = weekTotal > 0 ? (weekTotal / childCount).toFixed(0) + ' Kč / dítě' : '–';
  document.getElementById('statMonthChild').textContent = monthTotal > 0 ? (monthTotal / childCount / 4).toFixed(0) + ' Kč / dítě / týden' : '–';

  // Weekly history — group ledger income entries by weekKey
  const histContainer = document.getElementById('weeklyHistory');
  const weekMap = {};
  for (const e of incomeEntries) {
    if (!weekMap[e.weekKey]) weekMap[e.weekKey] = { weekKey: e.weekKey, total: 0, promoCount: 0 };
    weekMap[e.weekKey].total += e.price || 0;
    if (e.promo) weekMap[e.weekKey].promoCount++;
  }
  const sorted = Object.values(weekMap).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  if (!sorted.length) {
    histContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📊</span><p>Zatím žádné záznamy. Data se zobrazí po prvním potvrzeném nákupu.</p></div>`;
    return;
  }

  histContainer.innerHTML = sorted.map(w => {
    const perChild = childCount > 0 ? (w.total / childCount).toFixed(0) : '–';
    return `<div class="week-row">
      <span class="wr-label">${escHtml(weekKeyLabel(w.weekKey))}</span>
      <span class="wr-total"><strong>${w.total.toFixed(0)} Kč</strong></span>
      <span class="wr-child">${perChild} Kč / dítě</span>
      <span class="wr-saved">${w.promoCount} akčních položek</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// SETTINGS TAB
// ══════════════════════════════════════════════════════════
function initSettings() {
  document.getElementById('btnCheckHealth').addEventListener('click', async () => {
    const result = document.getElementById('healthResult');
    result.textContent = 'Kontroluji…';
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      result.textContent = data.apiKeySet
        ? '✅ Server OK · Groq API klíč nastaven'
        : '⚠️ Server OK · Groq API klíč chybí – přidejte GROQ_API_KEY do .env';
    } catch {
      result.textContent = '❌ Server není dostupný (spusťte node server.js)';
    }
  });

  // Nuclear delete button wired via onclick in HTML
}

// ══════════════════════════════════════════════════════════
// PRODUCT COMBOBOX
// ══════════════════════════════════════════════════════════

// Called on every keystroke in a product name input.
// listId = id of the <ul> dropdown to populate.
function productComboInput(input, listId) {
  const q = input.value.trim().toLowerCase();
  const list = document.getElementById(listId);
  if (!list) return;

  if (q.length < 1) { list.classList.add('hidden'); list.innerHTML = ''; return; }

  // Search: name, brand, category_l2 all tokenised
  const matches = STATE.products.filter(p => {
    const hay = `${p.name} ${p.brand || ''} ${p.category_l2}`.toLowerCase();
    return q.split(' ').every(tok => hay.includes(tok));
  }).slice(0, 12); // max 12 suggestions

  if (!matches.length) { list.classList.add('hidden'); list.innerHTML = ''; return; }

  list.innerHTML = matches.map((p, i) => `
    <li class="pcl-item" data-idx="${i}" tabindex="-1"
        onmousedown="productComboSelect(event,'${listId}')">
      <span class="pcl-name">${escHtml(p.name)}</span>
      <span class="pcl-meta">${escHtml(p.category_l2)} · ${escHtml(p.default_unit)}</span>
    </li>`).join('');

  // Stash matches on the list for selection
  list._matches = matches;
  list.classList.remove('hidden');
}

// Keyboard navigation: Arrow keys + Enter + Escape
function productComboKey(e, listId) {
  const list = document.getElementById(listId);
  if (!list || list.classList.contains('hidden')) return;
  const items = list.querySelectorAll('.pcl-item');
  const active = list.querySelector('.pcl-item.active');
  let idx = active ? parseInt(active.dataset.idx) : -1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(idx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(idx - 1, 0);
  } else if (e.key === 'Enter' && active) {
    e.preventDefault();
    productComboApply(listId, idx);
    return;
  } else if (e.key === 'Escape') {
    list.classList.add('hidden');
    return;
  } else { return; }

  items.forEach(li => li.classList.remove('active'));
  if (items[idx]) items[idx].classList.add('active');
}

// Mousedown selection (use mousedown not click to fire before blur)
function productComboSelect(e, listId) {
  e.preventDefault();
  const idx = parseInt(e.currentTarget.dataset.idx);
  productComboApply(listId, idx);
}

// Apply selected product to the form fields
function productComboApply(listId, idx) {
  const list = document.getElementById(listId);
  const p = list?._matches?.[idx];
  if (!p) return;
  list.classList.add('hidden');

  // --- Warehouse entry form ---
  if (listId === 'itemComboList') {
    document.getElementById('itemName').value = p.name;
    // Set food group select
    const grpSel = document.getElementById('itemGroup');
    if (grpSel) {
      // Find the option whose value matches p.food_group
      const opt = [...grpSel.options].find(o => o.value === p.food_group);
      if (opt) grpSel.value = p.food_group;
    }
    // Set unit
    const unitSel = document.getElementById('itemUnit');
    if (unitSel) {
      const opt = [...unitSel.options].find(o => o.value === p.default_unit);
      if (opt) unitSel.value = p.default_unit;
    }
    // Set store if known
    if (p.default_store) {
      const storeSel = document.getElementById('itemStore');
      if (storeSel) {
        const opt = [...storeSel.options].find(o => o.value === p.default_store);
        if (opt) storeSel.value = p.default_store;
      }
    }
    // Store product_id for ledger entry
    document.getElementById('itemName')._productId = p.id;
  }
}

// Close combo when clicking outside
document.addEventListener('click', e => {
  document.querySelectorAll('.product-combo-list').forEach(list => {
    if (!list.contains(e.target) && e.target.id !== 'itemName') {
      list.classList.add('hidden');
    }
  });
});

// ══════════════════════════════════════════════════════════
// DATA MANAGEMENT (Správa dat)
// ══════════════════════════════════════════════════════════

// ── Accordion ─────────────────────────────────────────────
function dmToggle(section) {
  const body  = document.getElementById(`dm-body-${section}`);
  const chev  = document.getElementById(`dm-chev-${section}`);
  const isOpen = !body.classList.contains('hidden');
  if (isOpen) {
    body.classList.add('hidden');
    chev.classList.remove('open');
  } else {
    body.classList.remove('hidden');
    chev.classList.add('open');
    dmLoad(section);
  }
}

// Lazy-load selects / lists when a section opens
async function dmLoad(section) {
  if (section === 'attendance') await dmLoadAttWeeks();
  if (section === 'menus')      await dmLoadMenuWeeks();
  if (section === 'shopping')   await dmLoadShoppingLists();
}

// ── Helpers ───────────────────────────────────────────────
function dmConfirm(msg) { return confirm(msg); }

function dmSetPreview(id, text, visible = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('hidden', !visible);
}

// Group week_keys by month (using Thursday = index 3)
function dmGroupWeeksByMonth(weeks) {
  const byMonth = new Map();
  for (const wk of weeks) {
    const thursday = getWeekDates(wk)[3];
    const y = thursday.getFullYear();
    const m = String(thursday.getMonth() + 1).padStart(2, '0');
    const key = `${y}-${m}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(wk);
  }
  return byMonth;
}

function dmMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${MONTH_NAMES_CZ[parseInt(m)]} ${y}`;
}

// ── Attendance ─────────────────────────────────────────────
async function dmLoadAttWeeks() {
  const orgId = window.SYNC?.ORG_ID;
  if (!orgId) return;
  let weeks = [];
  try {
    const res = await authedFetch(`/api/db/attendance/weeks/${orgId}`);
    if (res.ok) weeks = await res.json();
  } catch { return; }

  // Week select
  const weekSel = document.getElementById('dmAttWeek');
  if (weekSel) {
    weekSel.innerHTML = weeks.length
      ? weeks.map(wk => `<option value="${escHtml(wk)}">${escHtml(weekLabelCz(wk))}</option>`).join('')
      : '<option value="">— žádná data —</option>';
  }

  // Month select — group by month
  const byMonth = dmGroupWeeksByMonth(weeks);
  const monthSel = document.getElementById('dmAttMonth');
  if (monthSel) {
    monthSel.innerHTML = byMonth.size
      ? [...byMonth.entries()].map(([mk, wks]) =>
          `<option value="${escHtml(mk)}">${escHtml(dmMonthLabel(mk))} (${wks.length} týdnů)</option>`
        ).join('')
      : '<option value="">— žádná data —</option>';
  }
}

async function dmDeleteAttWeek() {
  const weekSel = document.getElementById('dmAttWeek');
  const wk = weekSel?.value;
  if (!wk) return toast('Žádný týden k smazání.', 'warning');
  if (!dmConfirm(`Smazat docházku pro ${weekLabelCz(wk)}?\nTato akce je nevratná.`)) return;
  const orgId = window.SYNC.ORG_ID;
  try {
    const res = await authedFetch(`/api/db/attendance/${orgId}/${wk}`, { method: 'DELETE' });
    const { count } = await res.json();
    toast(`Docházka smazána (${count} záznamů) — ${weekLabelCz(wk)}.`, 'info');
    attendanceData[wk] = {};
    renderAttendanceGrid?.();
    await dmLoadAttWeeks();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

async function dmDeleteAttMonth() {
  const monthSel = document.getElementById('dmAttMonth');
  const mk = monthSel?.value;
  if (!mk) return toast('Žádný měsíc k smazání.', 'warning');

  // Collect week_keys for this month
  const orgId = window.SYNC.ORG_ID;
  let weeks = [];
  try {
    const res = await authedFetch(`/api/db/attendance/weeks/${orgId}`);
    if (res.ok) weeks = await res.json();
  } catch { return; }
  const byMonth = dmGroupWeeksByMonth(weeks);
  const weekKeys = byMonth.get(mk) || [];
  if (!weekKeys.length) return toast('Žádná data pro tento měsíc.', 'warning');

  if (!dmConfirm(`Smazat docházku pro ${dmMonthLabel(mk)} (${weekKeys.length} týdnů)?\nTato akce je nevratná.`)) return;
  try {
    const res = await authedFetch(`/api/db/attendance/${orgId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_keys: weekKeys }),
    });
    const { count } = await res.json();
    weekKeys.forEach(wk => { attendanceData[wk] = {}; });
    toast(`Docházka za ${dmMonthLabel(mk)} smazána (${count} záznamů).`, 'info');
    renderAttendanceGrid?.();
    await dmLoadAttWeeks();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

async function dmDeleteAttAll() {
  if (!dmConfirm('Smazat VEŠKEROU docházku organizace?\nTato akce je nevratná a dotkne se všech uživatelů.')) return;
  const orgId = window.SYNC.ORG_ID;
  // Fetch all weeks then delete them all
  try {
    const res = await authedFetch(`/api/db/attendance/weeks/${orgId}`);
    const weeks = res.ok ? await res.json() : [];
    if (!weeks.length) return toast('Žádná docházka k smazání.', 'info');
    const delRes = await authedFetch(`/api/db/attendance/${orgId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_keys: weeks }),
    });
    const { count } = await delRes.json();
    attendanceData = {};
    toast(`Veškerá docházka smazána (${count} záznamů).`, 'info');
    renderAttendanceGrid?.();
    await dmLoadAttWeeks();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

// ── Menus ──────────────────────────────────────────────────
async function dmLoadMenuWeeks() {
  const orgId = window.SYNC?.ORG_ID;
  if (!orgId) return;
  let menus = [];
  try {
    const res = await authedFetch(`/api/db/menus/${orgId}`);
    if (res.ok) menus = await res.json();
  } catch { return; }

  const sel = document.getElementById('dmMenuWeek');
  if (!sel) return;
  sel.innerHTML = menus.length
    ? menus.map(m => `<option value="${escHtml(m.week_key)}">${escHtml(weekLabelCz(m.week_key))}</option>`).join('')
    : '<option value="">— žádné jídelníčky —</option>';
}

async function dmDeleteMenuWeek() {
  const wk = document.getElementById('dmMenuWeek')?.value;
  if (!wk) return toast('Žádný týden k smazání.', 'warning');
  if (!dmConfirm(`Smazat jídelníček pro ${weekLabelCz(wk)}?`)) return;
  const orgId = window.SYNC.ORG_ID;
  try {
    await authedFetch(`/api/db/menus/${orgId}/${wk}`, { method: 'DELETE' });
    toast(`Jídelníček smazán — ${weekLabelCz(wk)}.`, 'info');
    await dmLoadMenuWeeks();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

async function dmDeleteMenusAll() {
  if (!dmConfirm('Smazat VŠECHNY jídelníčky organizace? Tato akce je nevratná.')) return;
  const orgId = window.SYNC.ORG_ID;
  try {
    const res = await authedFetch(`/api/db/menus/${orgId}`, { method: 'DELETE' });
    const { count } = await res.json();
    toast(`Všechny jídelníčky smazány (${count}).`, 'info');
    await dmLoadMenuWeeks();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

// ── Shopping lists ─────────────────────────────────────────
async function dmLoadShoppingLists() {
  const orgId = window.SYNC?.ORG_ID;
  if (!orgId) return;
  let lists = [];
  try {
    const res = await authedFetch(`/api/db/shopping-lists/${orgId}`);
    if (res.ok) lists = await res.json();
  } catch { return; }

  const container = document.getElementById('dmShoppingList');
  if (!container) return;
  if (!lists.length) {
    container.innerHTML = '<p class="muted dm-hint">Žádné nákupní seznamy.</p>';
    return;
  }
  container.innerHTML = lists.map(l => {
    const date = l.created_at ? new Date(l.created_at).toLocaleDateString('cs-CZ') : '—';
    const badge = l.status === 'confirmed'
      ? '<span class="dm-ci-badge confirmed">potvrzeno</span>'
      : '<span class="dm-ci-badge">rozpracováno</span>';
    return `<label class="dm-check-item">
      <input type="checkbox" class="dm-sl-cb" value="${escHtml(l.id)}" />
      <span class="dm-ci-info">
        <strong>${escHtml(weekLabelCz(l.week_key))}</strong>
        <span class="muted"> · ${date}</span>
      </span>
      ${badge}
    </label>`;
  }).join('');
}

async function dmDeleteShoppingSelected() {
  const checked = [...document.querySelectorAll('.dm-sl-cb:checked')].map(cb => cb.value);
  if (!checked.length) return toast('Žádné seznamy nejsou označeny.', 'warning');
  if (!dmConfirm(`Smazat ${checked.length} nákupní seznam(y)? Tato akce je nevratná.`)) return;
  try {
    const res = await authedFetch('/api/db/shopping-lists', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: checked }),
    });
    const { count } = await res.json();
    toast(`Smazáno ${count} nákupních seznamů.`, 'info');
    await dmLoadShoppingLists();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

// ── Ledger (Sklad) ─────────────────────────────────────────
async function dmDeleteLedgerRange() {
  const from = document.getElementById('dmLedgerFrom')?.value;
  const to   = document.getElementById('dmLedgerTo')?.value;
  if (!from || !to) return toast('Zadejte obě data rozsahu.', 'warning');
  if (from > to) return toast('Datum "od" musí být před datem "do".', 'warning');
  if (!dmConfirm(`Smazat záznamy skladu od ${from} do ${to}? Tato akce je nevratná.`)) return;
  const orgId = window.SYNC.ORG_ID;
  try {
    const res = await authedFetch(`/api/db/ledger/${orgId}/range`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_from: from, date_to: to }),
    });
    const { count } = await res.json();
    toast(`Smazáno ${count} záznamů skladu.`, 'info');
    await refreshAllFromCloud();
    renderAll();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

async function dmDeleteLedgerAll() {
  if (!dmConfirm('Smazat CELOU historii pohybů skladu? Tato akce je nevratná.')) return;
  const orgId = window.SYNC.ORG_ID;
  try {
    const res = await authedFetch(`/api/db/ledger/${orgId}/all`, { method: 'DELETE' });
    const { count } = await res.json();
    toast(`Celý sklad smazán (${count} záznamů).`, 'info');
    await refreshAllFromCloud();
    renderAll();
  } catch (err) { toast('Chyba: ' + err.message, 'error'); }
}

// ── Nuclear ────────────────────────────────────────────────
let _dmDeleteAllRunning = false;
async function dmDeleteAll() {
  if (_dmDeleteAllRunning) return;

  const inputEl = document.getElementById('dmNuclearConfirm');
  // Normalize — strip any invisible/non-breaking spaces from copy-paste
  const input = (inputEl?.value || '').replace(/[\u00A0\u200B\s]+/g, ' ').trim();

  if (input !== 'SMAZAT') {
    toast('Pro potvrzení napište přesně: SMAZAT', 'warning');
    return;
  }
  if (!confirm('POSLEDNÍ VAROVÁNÍ: Smazat opravdu VŠECHNA data organizace?\nTato akce je nevratná.')) return;

  _dmDeleteAllRunning = true;
  const orgId = window.SYNC?.ORG_ID;
  try {
    // Reuse the same working endpoints that individual section buttons use
    const headers = { 'Content-Type': 'application/json' };

    // 1. Attendance — get all weeks then delete
    const weeksRes = await authedFetch(`/api/db/attendance/weeks/${orgId}`);
    if (weeksRes.ok) {
      const weeks = await weeksRes.json();
      if (weeks.length) {
        await authedFetch(`/api/db/attendance/${orgId}`, {
          method: 'DELETE', headers, body: JSON.stringify({ week_keys: weeks })
        });
      }
    }

    // 2. Menus
    await authedFetch(`/api/db/menus/${orgId}`, { method: 'DELETE' });

    // 3. Shopping lists — get all then delete
    const slRes = await authedFetch(`/api/db/shopping-lists/${orgId}`);
    if (slRes.ok) {
      const lists = await slRes.json();
      if (lists.length) {
        await authedFetch('/api/db/shopping-lists', {
          method: 'DELETE', headers, body: JSON.stringify({ ids: lists.map(l => l.id) })
        });
      }
    }

    // 4. Ledger — delete all
    await authedFetch(`/api/db/ledger/${orgId}/all`, { method: 'DELETE' });

    attendanceData = {};
    if (inputEl) inputEl.value = '';
    toast('Všechna data byla smazána.', 'success');
    try { await refreshAllFromCloud(); renderAll(); renderAttendanceGrid?.(); } catch(e) {}
  } catch (err) {
    toast('Chyba při mazání: ' + err.message, 'error');
  } finally {
    _dmDeleteAllRunning = false;
  }
}

// ══════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAll() {
  renderMenu();
  renderIngredients();
  renderFreqRules();
  renderOffers();
  renderWarehouse();
  renderStockBalance();
  renderFinance();
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// DB I/O — the ONLY persistence layer in this app. Every one of
// these throws on failure (network error, non-2xx, not logged in).
// Callers must await them and handle the error — there is no local
// fallback to quietly keep working from if Supabase is unreachable.
// ══════════════════════════════════════════════════════════

function authedFetch(path, options = {}) {
  if (!window.AUTH?.isLoggedIn()) {
    return Promise.reject(new Error('Nejste přihlášeni.'));
  }
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...window.AUTH.getAuthHeader(),
      ...(options.headers || {}),
    },
  });
}

async function dbPost(path, body) {
  const res = await authedFetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${path}: HTTP ${res.status}`);
  }
  return await res.json();
}

async function dbPut(path, body) {
  const res = await authedFetch(path, { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PUT ${path}: HTTP ${res.status}`);
  }
  return await res.json();
}

async function dbPatch(path, body) {
  const res = await authedFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PATCH ${path}: HTTP ${res.status}`);
  }
  return await res.json();
}

async function dbDelete(path) {
  const res = await authedFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `DELETE ${path}: HTTP ${res.status}`);
  }
  return await res.json();
}
// ══════════════════════════════════════════════════════════

const AUDIT_ACTION_LABELS = {
  'auth.login':       { label: 'Přihlášení',         css: 'auth-login' },
  'menu.fetch':       { label: 'Jídelníček načten',   css: 'default' },
  'attendance.save':  { label: 'Docházka uložena',    css: 'default' },
  'shopping.confirm': { label: 'Nákup potvrzen',      css: 'default' },
  'ledger.in':        { label: 'Příjem na sklad',     css: 'ledger-in' },
  'ledger.out':       { label: 'Spotřeba odepsána',   css: 'ledger-out' },
  'ledger.delete':    { label: 'Záznam smazán',       css: 'ledger-delete' },
  'role.change':      { label: 'Změna role',          css: 'role-change' },
};

async function loadAuditLog(actionFilter = '') {
  const container = document.getElementById('auditContent');
  if (!window.AUTH.isLoggedIn()) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🔒</span><p>Přihlaste se pro zobrazení audit logu.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="empty-state"><span class="empty-icon">⏳</span><p>Načítám záznamy…</p></div>`;

  try {
    const params = new URLSearchParams({ limit: 200 });
    if (actionFilter) params.set('action', actionFilter);

    const res = await fetch(`/api/db/audit?${params}`, {
      headers: window.AUTH.getAuthHeader(),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const rows = await res.json();

    if (!rows.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>Zatím žádné záznamy. Audit log se plní automaticky při každé akci.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto">
      <table class="audit-table">
        <thead>
          <tr>
            <th>Akce</th>
            <th>Popis</th>
            <th>Uživatel</th>
            <th>Role</th>
            <th>Datum a čas</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const meta = AUDIT_ACTION_LABELS[r.action] || { label: r.action, css: 'default' };
            const when = new Date(r.created_at).toLocaleString('cs-CZ', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit'
            });
            return `
              <tr>
                <td><span class="audit-action ${meta.css}">${escHtml(meta.label)}</span></td>
                <td class="audit-desc">${escHtml(r.description || r.action)}</td>
                <td class="audit-who">${escHtml(r.user_name || '–')}</td>
                <td><span class="badge-normal">${escHtml(r.user_role || '–')}</span></td>
                <td class="audit-when">${escHtml(when)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
      <p class="muted" style="margin-top:.5rem">Zobrazeno ${rows.length} záznamů · nejnovější nahoře</p>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p>Chyba načítání: ${escHtml(err.message)}</p></div>`;
  }
}

function initAuditTab() {
  document.getElementById('btnRefreshAudit')?.addEventListener('click', () => {
    const filter = document.getElementById('auditFilter').value;
    loadAuditLog(filter);
  });
  document.getElementById('auditFilter')?.addEventListener('change', (e) => {
    loadAuditLog(e.target.value);
  });
}

// ══════════════════════════════════════════════════════════
// SPRINT 3 — AUTH BOOTSTRAP
// Supabase is required. If it isn't configured, the app cannot run
// at all — there is no localStorage fallback anymore.
// ══════════════════════════════════════════════════════════

async function initAuthFlow() {
  const { dbConfigured } = await window.AUTH.init();

  if (!dbConfigured) {
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('signupForm')?.classList.add('hidden');
    const errEl = document.getElementById('dbNotConfiguredError');
    if (errEl) {
      errEl.textContent = 'Databáze (Supabase) není nakonfigurována na serveru. Aplikace nemůže pracovat bez databáze — nastavte SUPABASE_URL a SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY v .env a restartujte server.';
      errEl.classList.remove('hidden');
    }
    setStatus('error', 'Databáze není nakonfigurována');
    return;
  }

  if (window.AUTH.isLoggedIn()) {
    await showApp();
  } else {
    showLogin();
  }

  wireLoginForms();
}

function showLogin() {
  document.body.classList.remove('app-loading');
  document.getElementById('loginOverlay').classList.remove('hidden');
}

// Single source of truth for signing out, reachable from the header
// (every role, every tab) and from the old Settings-tab button — both
// just call this. A confirm() guard matters more now than it did when
// this was buried at the bottom of Settings: it's a one-click icon
// sitting in the header at all times, so a stray click shouldn't
// silently end the session.
async function doLogout() {
  if (!confirm('Opravdu se chcete odhlásit?')) return;
  await window.AUTH.signOut();
  document.getElementById('userBadge').classList.add('hidden');
  document.getElementById('membersCard').classList.add('hidden');
  showLogin();
}

// Runs after every successful login AND is the only entry point that
// loads real data — there is no synchronous render-on-boot anymore.
// Every section is fetched fresh from Supabase before anything renders,
// so two users on two PCs always see the same thing after this resolves.
async function showApp() {
  document.body.classList.remove('app-loading');
  document.getElementById('loginOverlay').classList.add('hidden');
  applyRoleGating();
  renderAccountInfo();

  const ok = await refreshAllFromCloud();
  renderAll();
  if (typeof renderAttendanceGrid === 'function') renderAttendanceGrid();
  if (STATE.currentMenu?.fetchedAt) {
    document.getElementById('lastCheck').textContent =
      'Poslední kontrola: ' + new Date(STATE.currentMenu.fetchedAt).toLocaleString('cs-CZ');
  }
  if (ok) setStatus('ok', 'Připraveno');
}

function applyRoleGating() {
  const profile = window.AUTH.getProfile();
  if (!profile) return;

  document.querySelectorAll('.tab').forEach(tab => {
    const tabName = tab.dataset.tab;
    if (window.AUTH.canSeeTab(tabName)) {
      tab.classList.remove('hidden');
    } else {
      tab.classList.add('hidden');
      // If the currently active tab just got hidden, fall back to Menu.
      if (tab.classList.contains('active')) switchTab('menu');
    }
  });
}

function renderAccountInfo() {
  const profile = window.AUTH.getProfile();
  if (!profile) return;

  const badge = document.getElementById('userBadge');
  badge.classList.remove('hidden');
  document.getElementById('userBadgeText').innerHTML =
    `${escHtml(profile.full_name || 'Uživatel')} <span class="role-pill">${escHtml(window.AUTH.roleLabel())}</span>`;

  const accountInfo = document.getElementById('accountInfo');
  accountInfo.innerHTML = `
    Přihlášen jako <strong>${escHtml(profile.full_name || '–')}</strong><br>
    Role: <strong>${escHtml(window.AUTH.roleLabel())}</strong>`;
  document.getElementById('btnLogout').classList.remove('hidden');

  if (profile.role === 'admin') {
    document.getElementById('membersCard').classList.remove('hidden');
    loadMembersList();
  }
}

async function loadMembersList() {
  const res = await fetch('/api/db/members', { headers: window.AUTH.getAuthHeader() });
  if (!res.ok) return;
  const members = await res.json();
  const myId = window.AUTH.getProfile().id;

  document.getElementById('membersList').innerHTML = members.map(m => `
    <div class="member-row">
      <span class="mr-name">${escHtml(m.full_name || '(bez jména)')}</span>
      ${m.id === myId ? '<span class="mr-you">(vy)</span>' : ''}
      <select onchange="updateMemberRole('${m.id}', this.value)" ${m.id === myId ? 'disabled' : ''}>
        <option value="kucharka" ${m.role === 'kucharka' ? 'selected' : ''}>Kuchařka</option>
        <option value="tester" ${m.role === 'tester' ? 'selected' : ''}>Tester</option>
        <option value="vedouci" ${m.role === 'vedouci' ? 'selected' : ''}>Vedoucí jídelny</option>
        <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select>
    </div>`).join('');
}

async function updateMemberRole(userId, role) {
  const res = await fetch(`/api/db/members/${userId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...window.AUTH.getAuthHeader() },
    body: JSON.stringify({ role }),
  });
  if (res.ok) toast('Role aktualizována.', 'success');
  else toast('Změna role se nezdařila.', 'error');
}

function wireLoginForms() {
  document.getElementById('linkShowSignup').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('signupForm').classList.remove('hidden');
  });
  document.getElementById('linkShowLogin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('signupForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
  });

  document.getElementById('btnLogin').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');
    try {
      await window.AUTH.signIn(email, password);
      await showApp();
      toast('Přihlášení úspěšné!', 'success');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('btnSignup').addEventListener('click', async () => {
    const fullName = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const errEl = document.getElementById('signupError');
    const okEl = document.getElementById('signupSuccess');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    try {
      const { needsEmailConfirm } = await window.AUTH.signUp(email, password, fullName);
      if (needsEmailConfirm) {
        okEl.textContent = 'Účet vytvořen! Zkontrolujte e-mail a potvrďte registraci, pak se přihlaste.';
        okEl.classList.remove('hidden');
      } else {
        await showApp();
        toast('Účet vytvořen a jste přihlášeni!', 'success');
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('btnLogout')?.addEventListener('click', doLogout);
  document.getElementById('btnLogoutHeader')?.addEventListener('click', doLogout);
}

// ══════════════════════════════════════════════════════════
// SAVED MENUS BROWSER
// Lets users browse all weekly menus stored in the database,
// filtered by year and month.  Works only when logged in (DB mode).
// ══════════════════════════════════════════════════════════

// All menus fetched from DB — populated by loadSavedMenus().
let _savedMenus = [];
let _selectedWeekKey = null;

/**
 * Convert a week_key (e.g. "2026-W03") back to a Date representing
 * the first calendar day of that week, using the same week-numbering
 * formula as getWeekKey():
 *   week = Math.ceil(((dayOfYear) + jan1.getDay() + 1) / 7)
 *
 * Solving for dayOfYear: first day of week W is at
 *   dayOfYear = (W-1)*7 - jan1.getDay()   (clamped to 0)
 */
function weekKeyToDate(wk) {
  const [yearStr, wStr] = wk.split('-W');
  const year = parseInt(yearStr, 10);
  const weekNum = parseInt(wStr, 10);
  const jan1 = new Date(year, 0, 1);
  const firstDayOffset = Math.max(0, (weekNum - 1) * 7 - jan1.getDay());
  return new Date(year, 0, 1 + firstDayOffset);
}

/** Human-readable label for a week range, e.g. "Týden 03 (12.1.–16.1.)" */
function weekKeyRangeLabel(wk) {
  const [, wStr] = wk.split('-W');
  const start = weekKeyToDate(wk);
  // School week ends on Friday (4 days after Sunday start, or 4 days later if start is already a weekday)
  const dayOfWeek = start.getDay(); // 0=Sun
  const monday = new Date(start);
  if (dayOfWeek !== 1) {
    // advance to next Monday
    monday.setDate(start.getDate() + ((8 - dayOfWeek) % 7 || 7));
  }
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = d => `${d.getDate()}.${d.getMonth() + 1}.`;
  return `Týden ${wStr} (${fmt(monday)}–${fmt(friday)})`;
}

async function loadSavedMenus() {
  const btn = document.getElementById('btnLoadSavedMenus');
  const filter = document.getElementById('savedMenusFilter');

  if (!window.AUTH?.isLoggedIn()) {
    toast('Pro procházení uložených jídelníčků se přihlaste.', 'info');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Načítám…';

  try {
    const orgId = window.SYNC?.ORG_ID;
    const res = await fetch(`/api/db/menus/${orgId}`, {
      headers: window.AUTH.getAuthHeader(),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    _savedMenus = await res.json();

    if (!_savedMenus.length) {
      toast('V databázi zatím nejsou uloženy žádné jídelníčky.', 'info');
      return;
    }

    filter.style.display = '';
    populateSavedMenusYearFilter();
    renderSavedMenusWeekList();
    toast(`Načteno ${_savedMenus.length} uložených jídelníčků.`, 'success');
  } catch (err) {
    toast('Chyba načítání: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Načíst z databáze';
  }
}

/** Populate year <select> with distinct years present in _savedMenus. */
function populateSavedMenusYearFilter() {
  const yearSelect = document.getElementById('menuFilterYear');
  const monthSelect = document.getElementById('menuFilterMonth');

  const years = [...new Set(_savedMenus.map(m => parseInt(m.week_key.split('-W')[0], 10)))].sort((a, b) => b - a);
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  // Pre-select the year/month of the newest menu
  const newest = _savedMenus[0];
  if (newest) {
    const d = weekKeyToDate(newest.week_key);
    yearSelect.value = d.getFullYear();
    monthSelect.value = d.getMonth() + 1;
  }

  yearSelect.onchange = () => {
    _selectedWeekKey = null;
    document.getElementById('savedMenuDetail').innerHTML = '';
    renderSavedMenusWeekList();
  };
  monthSelect.onchange = () => {
    _selectedWeekKey = null;
    document.getElementById('savedMenuDetail').innerHTML = '';
    renderSavedMenusWeekList();
  };
}

/** Show the week buttons for the currently selected year+month. */
function renderSavedMenusWeekList() {
  const year = parseInt(document.getElementById('menuFilterYear').value, 10);
  const month = parseInt(document.getElementById('menuFilterMonth').value, 10); // 1-based
  const listEl = document.getElementById('savedMenuWeekList');

  // Filter menus whose week starts in the selected year+month
  const filtered = _savedMenus.filter(m => {
    const d = weekKeyToDate(m.week_key);
    return d.getFullYear() === year && (d.getMonth() + 1) === month;
  });

  if (!filtered.length) {
    listEl.innerHTML = `<p class="muted" style="padding:.5rem 0">Žádné jídelníčky pro vybraný měsíc.</p>`;
    return;
  }

  // Sort chronologically (oldest first within the month)
  const sorted = [...filtered].sort((a, b) => a.week_key.localeCompare(b.week_key));

  listEl.innerHTML = sorted.map(m => {
    const isActive = m.week_key === _selectedWeekKey;
    return `<button class="saved-week-btn ${isActive ? 'active' : ''}" onclick="selectSavedMenuWeek('${m.week_key}')">
      <span class="swb-key">${escHtml(weekKeyRangeLabel(m.week_key))}</span>
      <span class="swb-date">📅 ${new Date(m.fetched_at).toLocaleDateString('cs-CZ')}</span>
    </button>`;
  }).join('');
}

/** Display the full menu for the given week_key from the cached _savedMenus. */
function selectSavedMenuWeek(weekKey) {
  _selectedWeekKey = weekKey;
  // Re-render list to update active state
  renderSavedMenusWeekList();

  const entry = _savedMenus.find(m => m.week_key === weekKey);
  const detail = document.getElementById('savedMenuDetail');

  if (!entry) {
    detail.innerHTML = '';
    return;
  }

  const days = Array.isArray(entry.days_json) ? entry.days_json : [];

  if (!days.length) {
    detail.innerHTML = `<p class="muted">Tento jídelníček nemá žádná data.</p>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'week-grid';

  for (const day of days) {
    const card = document.createElement('div');
    card.className = 'day-card';
    const meals = (day.meals || []).map(m =>
      `<div class="meal-label">${escHtml(m.label)}</div><div class="meal">${escHtml(m.dish)}</div>`
    ).join('');
    card.innerHTML = `<div class="day-name">${escHtml(day.name)} ${escHtml(day.date || '')}</div>${meals}`;
    grid.appendChild(card);
  }

  detail.innerHTML = `<div class="saved-detail-header">
    <div>
      <h3>📋 ${escHtml(weekKeyRangeLabel(weekKey))}</h3>
      <span class="muted">Uloženo: ${new Date(entry.fetched_at).toLocaleDateString('cs-CZ')}</span>
    </div>
    <button class="btn btn-primary btn-sm" onclick="useSavedMenuAsCurrent('${weekKey}')">✅ Použít jako aktuální jídelníček</button>
  </div>`;
  detail.appendChild(grid);
}

/**
 * Loads an archived week from _savedMenus into STATE.currentMenu — the
 * exact same place fetchMenu() (the "Automaticky stažen z ms-harmonie.cz"
 * button) writes to. Everything downstream (renderMenu, renderIngredients,
 * "Najít akce" → Offers, the lastCheck label) reads from that one place,
 * so once this runs, continuing the workflow with an old week works
 * identically to continuing with a freshly auto-fetched one — no special
 * "archive mode" to keep track of.
 */
async function useSavedMenuAsCurrent(weekKey) {
  const entry = _savedMenus.find(m => m.week_key === weekKey);
  if (!entry) return;

  const days = Array.isArray(entry.days_json) ? entry.days_json : [];
  if (!days.length) {
    toast('Tento jídelníček nemá žádná data k použití.', 'error');
    return;
  }

  if (STATE.currentMenu?.days?.length &&
      !confirm(`Nahradit aktuálně zobrazený jídelníček týdnem ${weekKeyRangeLabel(weekKey)}? Stávající zobrazený jídelníček bude přepsán (uložené záznamy v databázi zůstanou zachovány).`)) {
    return;
  }

  const ingredients = Array.isArray(entry.ingredients) && entry.ingredients.length
    ? entry.ingredients
    : extractIngredients(days);

  setStatus('busy', 'Ukládám…');
  try {
    // Re-upsert with a fresh fetched_at so this week becomes "newest" —
    // and therefore the one loadCurrentMenuFromCloud() picks up for
    // every user, not just an in-memory override on this one screen.
    await dbPost('/api/db/menus', {
      org_id: window.SYNC.ORG_ID,
      week_key: weekKey,
      raw_text: entry.raw_text || '',
      days_json: days,
      ingredients,
    });
    await loadCurrentMenuFromCloud();

    renderMenu();
    renderIngredients();
    renderFreqRules();
    setStatus('ok', 'Jídelníček načten z archivu');

    const lastCheck = document.getElementById('lastCheck');
    if (lastCheck) {
      lastCheck.textContent = 'Poslední kontrola: ' + new Date(STATE.currentMenu.fetchedAt).toLocaleString('cs-CZ') + ' (z archivu)';
    }

    toast(`Jídelníček ${weekKeyRangeLabel(weekKey)} je nyní aktivní jídelníček.`, 'success');

    // Scroll back up to the live menu view so the result of the action is
    // immediately visible, instead of leaving the person looking at the
    // archive panel wondering whether anything happened.
    document.getElementById('menuContent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('error', 'Chyba ukládání');
    toast('Nepodařilo se uložit: ' + err.message, 'error');
  }
}

function initSavedMenusBrowser() {
  document.getElementById('btnLoadSavedMenus').addEventListener('click', loadSavedMenus);
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWarehouseForm();
  initSettings();

  // Init modules — these only wire up DOM event listeners; none of them
  // load data. Data loading happens once, after login, inside showApp().
  initAttendance();
  initNorms();
  initCustomItemForm();
  initAuditTab();
  initSavedMenusBrowser();
  initExport();

  // Button bindings
  document.getElementById('btnFetchMenu').addEventListener('click', fetchMenu);
  document.getElementById('btnGoToOffers').addEventListener('click', () => switchTab('offers'));
  document.getElementById('btnGenOffers').addEventListener('click', loadShoppingFromNorms);
  document.getElementById('btnGenNakup').addEventListener('click', loadNakupFromNorms);
  document.getElementById('btnApplyRezerva').addEventListener('click', applyRezervaAndBuild);
  document.getElementById('smartBuyToggle')?.addEventListener('change', (e) => {
    setSmartBuyMode(e.target.checked);
    const calc = window.LAST_CALC;
    if (calc?.results?.length) renderNakupGrid(calc.results.filter(r => r.totalGrams > 0));
  });
  document.getElementById('btnConfirmPurchase').addEventListener('click', confirmPurchase);

  // Child count change → re-render finance
  document.getElementById('childCount').addEventListener('change', renderFinance);

  setStatus('', 'Přihlašování…');

  // This is the ONLY place data loading is kicked off. It checks auth,
  // and — once logged in — fetches everything from Supabase and renders.
  initAuthFlow();
});

// ══════════════════════════════════════════════════════════
// ATTENDANCE MODULE
// ══════════════════════════════════════════════════════════

const DAYS_CS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
const MEALS_LIST = [
  { key: 'presnidavka', label: 'Přesnídávka' },
  { key: 'obed',        label: 'Oběd' },
  { key: 'svacina',     label: 'Svačina' },
];

// Attendance state: { [weekKey]: { [dayIndex]: { presnidavka, obed, svacina } } }
// Populated ONLY by loadAttendanceWeekFromCloud() (per-week, on demand) —
// there is no local persistence for this anymore.
let attendanceData = {};

function getCurrentAttWeek() {
  const picker = document.getElementById('attWeekPicker');
  return picker ? picker.value : getISOWeekString();
}

// Builds the Czech week labels and populates the #attWeekPicker <select>.
// A native <input type="week"> has no way to force Czech day/month names —
// that label is rendered entirely by the browser/OS locale, with no
// override available even with lang="cs" on the page. A <select> with
// hand-built Czech <option> text sidesteps that completely while staying
// a normal dropdown (full keyboard/accessibility support, no custom
// widget to build), which is the actual ask here.
const MONTH_NAMES_CZ_GENITIVE = ['', 'ledna','února','března','dubna','května','června',
  'července','srpna','září','října','listopadu','prosince'];

function formatCzDate(d) {
  return `${d.getDate()}. ${MONTH_NAMES_CZ_GENITIVE[d.getMonth() + 1]}`;
}

function weekLabelCz(weekStr) {
  const [yearStr, wPart] = weekStr.split('-W');
  const dates = getWeekDates(weekStr); // Mon..Fri
  const mon = dates[0], fri = dates[4];
  return `Týden ${parseInt(wPart, 10)}, ${yearStr} (${formatCzDate(mon)} – ${formatCzDate(fri)})`;
}

// Number of ISO weeks in a given year (52 most years, 53 in years where
// Dec 28 falls in week 53 — e.g. 2026 has 53). Computed from the ISO
// definition directly rather than a lookup table, so it stays correct
// for any year without needing maintenance.
function isoWeeksInYear(year) {
  return getISOWeekString(new Date(year, 11, 28)).endsWith('W53') ? 53 : 52;
}

// Populates the year dropdown: 2020 through ten years from now, fixed
// per the requirement (not a rolling window) — so it always covers the
// same 2020–<current year>+10 span regardless of what "today" is.
function populateAttYearSelect(selectedYear) {
  const select = document.getElementById('attYearPicker');
  if (!select) return;
  const requestedYear = parseInt(selectedYear, 10) || new Date().getFullYear();
  const startYear = Math.min(2020, requestedYear);
  const endYear = Math.max(new Date().getFullYear() + 10, requestedYear);
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  select.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  select.value = String(requestedYear);
}

// Populates the week dropdown with every ISO week belonging to the given
// year (52 or 53 of them, via isoWeeksInYear) — a full year, not a
// rolling window, per the requirement. selectedWeek, if given and it
// actually belongs to `year`, is pre-selected; otherwise defaults to the
// current week if `year` is this year, or week 1 otherwise.
function populateAttWeekSelect(year, selectedWeek) {
  const select = document.getElementById('attWeekPicker');
  if (!select) return;

  const totalWeeks = isoWeeksInYear(year);
  const options = [];
  for (let w = 1; w <= totalWeeks; w++) {
    options.push(`${year}-W${String(w).padStart(2, '0')}`);
  }

  select.innerHTML = options.map(wk =>
    `<option value="${wk}">${escHtml(weekLabelCz(wk))}</option>`).join('');

  const belongsToYear = selectedWeek && selectedWeek.startsWith(`${year}-W`);
  if (belongsToYear) {
    select.value = selectedWeek;
  } else {
    const thisYearNow = new Date().getFullYear() === year;
    select.value = thisYearNow ? getISOWeekString() : `${year}-W01`;
  }
}

// Sets the week, keeps both dropdowns in sync, and triggers the same
// cloud-fetch-and-render flow the picker's change handler runs. In the
// normal case (user picks a week from the dropdown within the same year)
// both selects already match weekStr by the time this runs, so nothing
// gets regenerated — regeneration only happens when the target week
// belongs to a different year than what's currently shown (year switch,
// or something jumping to a week outside the current year programmatically).
async function setAttWeek(weekStr) {
  const normalizedWeek = String(weekStr || '').trim();
  if (!/^\d{4}-W\d{2}$/.test(normalizedWeek)) return;

  const yearSelect = document.getElementById('attYearPicker');
  const weekSelect = document.getElementById('attWeekPicker');
  const targetYear = parseInt(normalizedWeek.split('-W')[0], 10);

  if (yearSelect && !Array.from(yearSelect.options).some(opt => opt.value === String(targetYear))) {
    populateAttYearSelect(targetYear);
  }
  if (yearSelect && parseInt(yearSelect.value, 10) !== targetYear) {
    yearSelect.value = String(targetYear);
  }
  if (weekSelect) {
    const hasTargetOption = Array.from(weekSelect.options).some(opt => opt.value === normalizedWeek);
    if (!hasTargetOption || weekSelect.value !== normalizedWeek) {
      populateAttWeekSelect(targetYear, normalizedWeek);
    }
    // Explicitly assign the value even after rebuilding the dropdown. This
    // is the critical import handoff: after a file import, the UI must land
    // on the first week that actually contains imported attendance, not stay
    // on today's week and force the user to search in the dropdown.
    weekSelect.value = normalizedWeek;
  }

  setStatus('busy', 'Načítám docházku…');
  try {
    await loadAttendanceWeekFromCloud(normalizedWeek);
    setStatus('ok', 'Připraveno');
  } catch (err) {
    setStatus('error', 'Chyba načítání');
    toast('Nepodařilo se načíst docházku: ' + err.message, 'error');
  }
  renderAttendanceGrid();
}

async function focusAttendanceWeekFromImport(weekStr) {
  const normalizedWeek = String(weekStr || '').trim();
  if (!/^\d{4}-W\d{2}$/.test(normalizedWeek)) return;

  // Switch the tab first so the attendance panel is visible, then yield a
  // frame — this lets the browser paint the newly-active panel before we
  // touch the dropdowns and grid inside it. Without the yield, the year/week
  // selects may be in a hidden panel when we try to set their values, which
  // causes the assignment to silently no-op in some browsers.
  if (typeof switchTab === 'function') switchTab('attendance');
  await new Promise(resolve => requestAnimationFrame(resolve));

  await setAttWeek(normalizedWeek);
  document.getElementById('attendanceGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Explicit exports for import.js. Browser globals from function declarations
// are easy to break accidentally if this file is ever converted to a module;
// assigning them here makes the attendance-import handoff intentional.
window.setAttWeek = setAttWeek;
window.populateAttYearSelect = populateAttYearSelect;
window.populateAttWeekSelect = populateAttWeekSelect;
window.renderAttendanceGrid = renderAttendanceGrid;
window.focusAttendanceWeekFromImport = focusAttendanceWeekFromImport;

function getISOWeekString(d = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getWeekDates(isoWeekStr) {
  // Parse YYYY-Www
  const [year, wPart] = isoWeekStr.split('-W');
  const weekNum = parseInt(wPart);
  // Get Monday of that ISO week
  const jan4 = new Date(parseInt(year), 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (weekNum - 1) * 7);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function renderAttendanceGrid() {
  const weekStr = getCurrentAttWeek();
  const weekDates = getWeekDates(weekStr);
  const weekData = attendanceData[weekStr] || {};
  const grid = document.getElementById('attendanceGrid');
  if (!grid) return;

  grid.innerHTML = weekDates.map((date, dayIdx) => {
    const dayData = weekData[dayIdx] || {};
    const dateStr = date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' });
    const dayTotal = MEALS_LIST.reduce((s, m) => s + (parseInt(dayData[m.key]) || 0), 0);

    const mealInputs = MEALS_LIST.map(m => {
      const val = dayData[m.key] !== undefined ? dayData[m.key] : '';
      return `
        <div class="att-meal-group">
          <label class="att-meal-label">${m.label}</label>
          <input type="number" min="0" max="200" class="att-meal-input"
            data-day="${dayIdx}" data-meal="${m.key}"
            value="${escHtml(String(val))}" placeholder="–" />
        </div>`;
    }).join('');

    return `
      <div class="att-day-card" id="attDay-${dayIdx}">
        <span class="att-day-name">${DAYS_CS[dayIdx]}</span>
        <span class="att-date">${dateStr}</span>
        <div class="att-meals">${mealInputs}</div>
        <div class="att-day-total">Celkem: <strong id="attDayTotal-${dayIdx}">${dayTotal || '–'}</strong></div>
      </div>`;
  }).join('');

  // Bind inputs
  grid.querySelectorAll('.att-meal-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const day = parseInt(inp.dataset.day);
      const meal = inp.dataset.meal;
      const val = parseInt(inp.value) || 0;
      if (!attendanceData[weekStr]) attendanceData[weekStr] = {};
      if (!attendanceData[weekStr][day]) attendanceData[weekStr][day] = {};
      attendanceData[weekStr][day][meal] = val;
      updateDayTotal(weekStr, day);
      updateWeekTotal(weekStr);
    });
  });

  updateWeekTotal(weekStr);
}

function updateDayTotal(weekStr, dayIdx) {
  const dayData = (attendanceData[weekStr] || {})[dayIdx] || {};
  const total = MEALS_LIST.reduce((s, m) => s + (parseInt(dayData[m.key]) || 0), 0);
  const el = document.getElementById(`attDayTotal-${dayIdx}`);
  if (el) el.textContent = total || '–';
}

function updateWeekTotal(weekStr) {
  const weekData = attendanceData[weekStr] || {};
  let total = 0;
  for (let d = 0; d < 5; d++) {
    const dayData = weekData[d] || {};
    total += MEALS_LIST.reduce((s, m) => s + (parseInt(dayData[m.key]) || 0), 0);
  }
  const el = document.getElementById('attWeekTotal');
  if (el) el.textContent = total > 0 ? total + ' porcí' : '–';
}

async function copyPrevWeek() {
  const weekStr = getCurrentAttWeek();
  // Find previous week
  const dates = getWeekDates(weekStr);
  const prevMonday = new Date(dates[0]);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevWeek = getISOWeekString(prevMonday);

  try {
    // Always fetch fresh — attendanceData may not have this week cached yet.
    await loadAttendanceWeekFromCloud(prevWeek);
  } catch (err) {
    toast('Nepodařilo se načíst předchozí týden: ' + err.message, 'error');
    return;
  }

  if (!attendanceData[prevWeek] || !Object.keys(attendanceData[prevWeek]).length) {
    toast('Předchozí týden nemá žádná data.', 'info'); return;
  }

  const copy = JSON.parse(JSON.stringify(attendanceData[prevWeek]));
  const ageGroup = document.getElementById('attAgeGroup')?.value || 'ms_3_6';
  const rows = [];
  Object.entries(copy).forEach(([day, meals]) => {
    Object.entries(meals).forEach(([meal, count]) => {
      rows.push({
        org_id: window.SYNC.ORG_ID,
        week_key: weekStr,
        day_index: parseInt(day, 10),
        meal,
        age_group: ageGroup,
        child_count: count,
      });
    });
  });

  if (!rows.length) { toast('Předchozí týden nemá žádná data.', 'info'); return; }

  try {
    await dbPut('/api/db/attendance/bulk', { rows });
    await loadAttendanceWeekFromCloud(weekStr);
    renderAttendanceGrid();
    toast('Docházka zkopírována z minulého týdne.', 'success');
  } catch (err) {
    toast('Kopírování se nepodařilo uložit: ' + err.message, 'error');
  }
}

// ── Ingredient calculator from attendance + norms ──────────
function getZeleninaSplitRatio() {
  const v = parseFloat(localStorage.getItem('zeleninaSplitRatio'));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 50; // % that is zelenina
}

function setZeleninaSplitRatio(pct) {
  const clamped = Math.max(0, Math.min(100, parseFloat(pct) || 0));
  localStorage.setItem('zeleninaSplitRatio', clamped);
  return clamped;
}

// ══════════════════════════════════════════════════════════
// Shared food-group / zelenina-ovoce classification
// (used by checkCompliance, stock balance, and the smart-buying planner)
// ══════════════════════════════════════════════════════════
const ZELENINA_KEYWORDS = [
  'mrkev', 'mrkvičk', 'rajče', 'rajčat', 'rajčátk', 'paprik', 'okurk', 'špenát', 'kukuřic',
  'kapust', 'celer', 'salát', 'kedlubn', 'ředkv', 'řep', 'pórek', 'cibul', 'česnek', 'kapie',
  'fenykl', 'květák', 'brokolic', 'cuket', 'lilek', 'baklažán', 'hrášk', 'zelí', 'chřest',
  'tykev', 'dýně', 'řepk', 'pažitk', 'petržel', 'pastinák', 'křen', 'artyčok', 'cherry rajč',
  'batáty zeleninové', 'zeleninov', 'kořenov', 'brukev', 'mangold', 'rukol', 'polníček',
];
const OVOCE_KEYWORDS = [
  'jablk', 'banán', 'pomeranč', 'hruš', 'mandarink', 'jahod', 'meloun', 'hrozn', 'broskv',
  'meruňk', 'švestk', 'třešn', 'višn', 'maliny', 'malin', 'borůvk', 'rybíz', 'angrešt',
  'citron', 'limetk', 'grapefruit', 'kiwi', 'ananas', 'mango', 'avokádo', 'granátov',
  'datle', 'fík', 'liči', 'nektarink', 'klementink', 'lesní ovoce', 'ovocný mix', 'ovocná mísa',
  'ovocná miska',
];
// NOTE: the generic words 'zelenina' and 'ovoce' are intentionally NOT in
// either list above. Ledger items created from the shopping-list/"Nákup"
// flow used to be named after the food-group LABEL itself (e.g. "Zelenina,
// ovoce"); treating those generic words as classifiers would wrongly dump
// every such item into one bucket. Since the calc-result split, new entries
// are named exactly "Zelenina" / "Ovoce", handled as an exact-match case below.
const FOODGROUP_KEYWORD_MAPPING = {
  maso:          ['maso', 'kuřec', 'vepřov', 'hovězí', 'sekaná', 'krůt', 'řízek', 'karbanátek', 'drůbež', 'jehně'],
  ryby:          ['ryb', 'losos', 'treska', 'tuňák', 'pstruh', 'kapr', 'korýš', 'kreveta', 'chobotnic'],
  mlecneVyrobky: ['mléko', 'sýr', 'jogurt', 'tvaroh', 'máslo', 'smetana', 'kefír', 'mléčn'],
  tuk:           ['olej', 'tuk volný', 'margarín', 'ghí'],
  cukr:          ['cukr', 'med', 'džem', 'sirup'],
  zeleninaOvoce: [...ZELENINA_KEYWORDS, ...OVOCE_KEYWORDS, 'zelenina', 'ovoce'],
  brambory:      ['brambor', 'batát', 'topinambur'],
  celozrnne:     ['celozrnn', 'pohanka', 'quinoa', 'amarant', 'ovesn', 'žitn', 'celozr', 'krupice celozrnná'],
  lustaniny:     ['čočka', 'fazole', 'hrách', 'cizrna', 'tofu', 'luštěnin', 'sója'],
};

/**
 * Classify a single ledger item into { groupKey, rowKey, wasTagged }.
 * rowKey matches the rowKey scheme used by calcIngredients(): for
 * zeleninaOvoce it's split into 'zeleninaOvoce_zelenina' / 'zeleninaOvoce_ovoce',
 * everything else uses the plain group key as rowKey.
 */
function classifyLedgerItem(item) {
  let grp = item.foodGroup;
  let explicitSub = null;
  if (grp === 'zelenina' || grp === 'ovoce') {
    // Legacy tag from before the 310/2025 merge.
    explicitSub = grp;
    grp = 'zeleninaOvoce';
  }
  let wasTagged = !!grp;
  if (!grp) {
    const nameLower = item.name.toLowerCase();
    grp = Object.entries(FOODGROUP_KEYWORD_MAPPING).find(([, kws]) => kws.some(kw => nameLower.includes(kw)))?.[0] || null;
  }
  if (!grp) return null;

  if (grp !== 'zeleninaOvoce') return { groupKey: grp, rowKey: grp, wasTagged };

  // Determine zelenina vs. ovoce sub-bucket
  const nameLower = item.name.toLowerCase();
  let isOvoce, isZelenina;
  if (explicitSub) {
    isOvoce = explicitSub === 'ovoce';
    isZelenina = explicitSub === 'zelenina';
  } else {
    const isExactOvoce = nameLower === 'ovoce';
    const isExactZelenina = nameLower === 'zelenina';
    isOvoce = !isExactZelenina && (isExactOvoce || OVOCE_KEYWORDS.some(kw => nameLower.includes(kw)));
    isZelenina = !isExactOvoce && (isExactZelenina || ZELENINA_KEYWORDS.some(kw => nameLower.includes(kw)));
  }
  let sub;
  if (isOvoce && !isZelenina) sub = 'ovoce';
  else if (isZelenina && !isOvoce) sub = 'zelenina';
  else sub = null; // ambiguous — caller decides (ratio split)
  return { groupKey: grp, rowKey: sub ? `zeleninaOvoce_${sub}` : null, wasTagged, ambiguousZeleninaOvoce: !sub };
}

/**
 * Current stock balance per rowKey (grams), using ALL ledger history
 * (not just last 30 days) — sum of IN minus OUT, classified the same
 * way as compliance. Negative balances are floored to 0 for purchasing
 * purposes (you can't have negative stock to "use up").
 */
function computeStockByRowKey() {
  const balance = {};
  for (const e of STATE.ledger) {
    const c = classifyLedgerItem(e);
    if (!c) continue;
    const rowKey = c.rowKey || (c.ambiguousZeleninaOvoce
      ? (getZeleninaSplitRatio() >= 50 ? 'zeleninaOvoce_zelenina' : 'zeleninaOvoce_ovoce') // arbitrary but consistent
      : c.groupKey);
    const grams = e.grams || toGrams(e.qty, e.unit);
    const sign = e.type === 'in' ? 1 : -1;
    balance[rowKey] = (balance[rowKey] || 0) + sign * grams;
  }
  return balance;
}

/**
 * Average daily consumption rate per rowKey (g/day), from actual
 * "spotřeba" (OUT) entries over the trailing window. Falls back to IN
 * entries (purchases) as a proxy if no OUT entries exist yet — same
 * fallback checkCompliance already uses.
 */
function computeConsumptionRatePerRowKey(days = 28) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  let entries = STATE.ledger.filter(e => e.type === 'out' && new Date(e.date) >= since);
  let usedFallback = false;
  if (!entries.length) {
    entries = STATE.ledger.filter(e => e.type === 'in' && new Date(e.date) >= since);
    usedFallback = true;
  }
  const totals = {};
  for (const e of entries) {
    const c = classifyLedgerItem(e);
    if (!c) continue;
    const rowKey = c.rowKey || (c.ambiguousZeleninaOvoce
      ? (getZeleninaSplitRatio() >= 50 ? 'zeleninaOvoce_zelenina' : 'zeleninaOvoce_ovoce')
      : c.groupKey);
    const grams = e.grams || toGrams(e.qty, e.unit);
    totals[rowKey] = (totals[rowKey] || 0) + grams;
  }
  const rates = {};
  for (const [k, v] of Object.entries(totals)) rates[k] = v / days;
  return { rates, usedFallback };
}

/**
 * How many days of stock buffer to target right now, tapering down to 0
 * as the calendar year-end approaches — so stock doesn't pile up with
 * nothing left to use it for after 31. 12. Outside the taper window,
 * returns the full base buffer.
 */
function getYearEndTaperedBufferDays(baseBufferDays = 14, taperWindowDays = 56) {
  const now = new Date();
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const daysLeft = Math.max(0, Math.round((yearEnd - now) / 86400000));
  if (daysLeft >= taperWindowDays) return baseBufferDays;
  return Math.round(baseBufferDays * (daysLeft / taperWindowDays));
}

function getSmartBuyMode() {
  return localStorage.getItem('smartBuyMode') === 'on';
}
function setSmartBuyMode(on) {
  localStorage.setItem('smartBuyMode', on ? 'on' : 'off');
}

function calcIngredients() {
  const weekStr = getCurrentAttWeek();
  const ageGroup = document.getElementById('attAgeGroup')?.value || 'ms_3_6';
  const weekData = attendanceData[weekStr] || {};
  const container = document.getElementById('ingredientCalcResult');

  // Build per-meal totals
  const mealTotals = { presnidavka: 0, obed: 0, svacina: 0 };
  for (let d = 0; d < 5; d++) {
    const dayData = weekData[d] || {};
    MEALS_LIST.forEach(m => {
      mealTotals[m.key] += parseInt(dayData[m.key]) || 0;
    });
  }

  const totalPortions = Object.values(mealTotals).reduce((a, b) => a + b, 0);
  if (totalPortions === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🧮</span><p>Nejprve zadejte docházku.</p></div>`;
    return;
  }

  // Calculate required grams per food group per meal
  const N = window.NORMS;
  const zeleninaRatio = getZeleninaSplitRatio() / 100; // your own estimate — 310/2025 sets no official sub-split
  const results = Object.entries(N.foodGroups).flatMap(([key, group]) => {
    let totalGrams = 0;
    const breakdown = MEALS_LIST.map(m => {
      const children = mealTotals[m.key];
      const g = N.calcGrams(key, m.key, ageGroup, children);
      totalGrams += g;
      return `${m.label}: ${g} g (${children} dětí)`;
    });

    if (key === 'zeleninaOvoce') {
      // Split into two genuinely-named rows so every downstream flow
      // (Nákup cart, Sklad příjem/spotřeba) records "Zelenina" and "Ovoce"
      // as distinct ledger entries instead of one generic combined label
      // — that generic label was the cause of the 100%-into-one-bucket
      // misclassification. Ratio is your own setting, since the decree
      // itself defines only the combined target.
      const zeleninaGrams = Math.round(totalGrams * zeleninaRatio);
      const ovoceGrams = totalGrams - zeleninaGrams;
      const mk = (label, grams, suffix) => ({
        key, rowKey: `${key}_${suffix}`, label, totalGrams: grams,
        displayAmt: grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${grams} g`,
        breakdown, color: group.color,
      });
      return [mk('Zelenina', zeleninaGrams, 'zelenina'), mk('Ovoce', ovoceGrams, 'ovoce')];
    }

    // Convert to practical units
    const displayAmt = totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(1)} kg`
      : `${totalGrams} g`;

    return [{ key, rowKey: key, label: group.label, totalGrams, displayAmt, breakdown, color: group.color }];
  });

  // Store globally so Shopping List (Akce & Nákup) and Sklad (consume week) can use it
  window.LAST_CALC = { weekKey: weekStr, ageGroup, mealTotals, totalPortions, results };

  container.innerHTML = `
    <div class="ingr-calc-grid">
      ${results.map(r => `
        <div class="ingr-calc-card">
          <div class="ic-group" style="color:${r.color}">${escHtml(r.label)}</div>
          <div class="ic-amount" style="color:${r.color}">${escHtml(r.displayAmt)}</div>
          <div class="ic-breakdown">${r.breakdown.map(b => escHtml(b)).join('<br>')}</div>
          <div class="ic-bar" style="--pct: ${Math.min(100, r.totalGrams / 50)}%"></div>
        </div>
      `).join('')}
    </div>
    <div class="intro" style="margin-top:1rem">
      <span class="intro-icon">🛒</span>
      <p>Výpočet je hotový. Přejděte na záložku <strong>Nákup</strong> a klikněte
      „🧮 Načíst z výpočtu surovin" — zadejte rezervy pro každou kategorii a vytvořte nákupní seznam.</p>
    </div>
    <p class="muted" style="margin-top:.5rem">
      Celkem porcí tento týden: <strong>${totalPortions}</strong> ·
      Věková skupina: <strong>${escHtml(N.ageGroups[ageGroup]?.label || ageGroup)}</strong> ·
      Hodnoty dle Vyhlášky č. 107/2005 Sb., ve znění Vyhlášky č. 310/2025 Sb. (účinnost 1. 9. 2026)
    </p>`;
}

// ── Nákup tab: independent week picker + DB-sourced calc ───
// Populates the Nákup year picker (same range as Docházka).
function populateNakupYearSelect(selectedYear) {
  const select = document.getElementById('nakupYearPicker');
  if (!select) return;
  const reqYear = parseInt(selectedYear, 10) || new Date().getFullYear();
  const startYear = Math.min(2020, reqYear);
  const endYear   = Math.max(new Date().getFullYear() + 10, reqYear);
  select.innerHTML = '';
  for (let y = startYear; y <= endYear; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    select.appendChild(opt);
  }
  select.value = String(reqYear);
}

function populateNakupWeekSelect(year, selectedWeek) {
  const select = document.getElementById('nakupWeekPicker');
  if (!select) return;
  const totalWeeks = isoWeeksInYear(year);
  let html = '';
  for (let w = 1; w <= totalWeeks; w++) {
    const wk = `${year}-W${String(w).padStart(2, '0')}`;
    html += `<option value="${wk}">${escHtml(weekLabelCz(wk))}</option>`;
  }
  select.innerHTML = html;
  const belongsToYear = selectedWeek && selectedWeek.startsWith(`${year}-W`);
  select.value = belongsToYear ? selectedWeek
    : (new Date().getFullYear() === year ? getISOWeekString() : `${year}-W01`);
}

async function calcIngredientsForNakup() {
  const weekStr  = document.getElementById('nakupWeekPicker')?.value;
  const ageGroup = document.getElementById('attAgeGroup')?.value || 'ms_3_6';
  const container = document.getElementById('nakupIngredientCalcResult');
  if (!weekStr || !container) return;

  container.innerHTML = `<div class="empty-state"><span class="empty-icon">⏳</span><p>Načítám docházku z databáze…</p></div>`;

  // Always fetch fresh from DB — this is the source of truth after multi-class import.
  try {
    await loadAttendanceWeekFromCloud(weekStr);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p>Nepodařilo se načíst docházku: ${escHtml(err.message)}</p></div>`;
    return;
  }

  const weekData = attendanceData[weekStr] || {};
  const mealTotals = { presnidavka: 0, obed: 0, svacina: 0 };
  for (let d = 0; d < 5; d++) {
    const dayData = weekData[d] || {};
    MEALS_LIST.forEach(m => { mealTotals[m.key] += parseInt(dayData[m.key]) || 0; });
  }

  const totalPortions = Object.values(mealTotals).reduce((a, b) => a + b, 0);
  if (totalPortions === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🧮</span>
      <p>Pro týden <strong>${escHtml(weekLabelCz(weekStr))}</strong> nejsou v databázi žádné záznamy docházky.<br>
      Nejprve nahrajte měsíční přehled (záložka Docházka → Import).</p></div>`;
    return;
  }

  const N = window.NORMS;
  const zeleninaRatio = getZeleninaSplitRatio() / 100;
  const results = Object.entries(N.foodGroups).flatMap(([key, group]) => {
    let totalGrams = 0;
    const breakdown = MEALS_LIST.map(m => {
      const children = mealTotals[m.key];
      const g = N.calcGrams(key, m.key, ageGroup, children);
      totalGrams += g;
      return `${m.label}: ${g} g (${children} dětí)`;
    });
    if (key === 'zeleninaOvoce') {
      const zeleninaGrams = Math.round(totalGrams * zeleninaRatio);
      const ovoceGrams = totalGrams - zeleninaGrams;
      const mk = (label, grams, suffix) => ({
        key, rowKey: `${key}_${suffix}`, label, totalGrams: grams,
        displayAmt: grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${grams} g`,
        breakdown, color: group.color,
      });
      return [mk('Zelenina', zeleninaGrams, 'zelenina'), mk('Ovoce', ovoceGrams, 'ovoce')];
    }
    const displayAmt = totalGrams >= 1000 ? `${(totalGrams / 1000).toFixed(1)} kg` : `${totalGrams} g`;
    return [{ key, rowKey: key, label: group.label, totalGrams, displayAmt, breakdown, color: group.color }];
  });

  // Update LAST_CALC so "Načíst z výpočtu surovin" and Akce tab work immediately.
  window.LAST_CALC = { weekKey: weekStr, ageGroup, mealTotals, totalPortions, results };

  container.innerHTML = `
    <div class="ingr-calc-grid">
      ${results.map(r => `
        <div class="ingr-calc-card">
          <div class="ic-group" style="color:${r.color}">${escHtml(r.label)}</div>
          <div class="ic-amount" style="color:${r.color}">${escHtml(r.displayAmt)}</div>
          <div class="ic-breakdown">${r.breakdown.map(b => escHtml(b)).join('<br>')}</div>
          <div class="ic-bar" style="--pct: ${Math.min(100, r.totalGrams / 50)}%"></div>
        </div>
      `).join('')}
    </div>
    <p class="muted" style="margin-top:.75rem">
      Celkem porcí: <strong>${totalPortions}</strong> ·
      Věková skupina: <strong>${escHtml(N.ageGroups[ageGroup]?.label || ageGroup)}</strong> ·
      Týden: <strong>${escHtml(weekLabelCz(weekStr))}</strong> ·
      Hodnoty dle Vyhl. č. 107/2005 Sb., ve znění Vyhl. č. 310/2025 Sb.
    </p>`;
}

// ══════════════════════════════════════════════════════════
// NORMS / COMPLIANCE MODULE
// ══════════════════════════════════════════════════════════

function renderNormReference() {
  const N = window.NORMS;
  const ageKey = 'ms_3_6';
  const container = document.getElementById('normRefGrid');
  if (!container) return;

  // Show daily target for přesnídávka+oběd+svačina (MŠ standard 3-meal day)
  container.innerHTML = Object.entries(N.foodGroups).map(([key, g]) => {
    const dayVal = N.mealValues[ageKey]?.presnidavka_obed_svacina?.[key] ?? 0;
    return `
      <div class="norm-ref-item">
        <span class="norm-dot" style="background:${g.color}"></span>
        <span class="nr-label">${escHtml(g.label)}</span>
        <span class="nr-value">${dayVal} g/den</span>
      </div>`;
  }).join('');
}

/**
 * Count how many distinct calendar weeks in the current month have at least
 * one ledger entry (type 'in' OR 'out') for a given foodGroup key.
 * "Current month" = last 30 days (same window as checkCompliance).
 */
function countWeeksWithGroup(groupKey) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const weeks = new Set();
  for (const e of STATE.ledger) {
    const c = classifyLedgerItem(e);
    if (!c || c.groupKey !== groupKey) continue;
    const d = new Date(e.date);
    if (d < since) continue;
    // ISO week key: YYYY-Www
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const weekNum = Math.ceil(((d - jan4) / 86400000 + jan4.getDay() + 1) / 7);
    weeks.add(`${d.getFullYear()}-W${weekNum}`);
  }
  return weeks.size;
}

// ══════════════════════════════════════════════════════════
// Menu-text rule checking (keyword-based, no AI required)
// Operates on STATE.currentMenu.days[].meals[].dish strings.
// ══════════════════════════════════════════════════════════

const SLADKE_NAPOJE_KEYWORDS = [
  'sirup', 'limonáda', 'džus', 'mošt', 'kofola', 'coca-cola', 'fanta', 'sprite',
  'slazený čaj', 'slazený nápoj', 'energetický nápoj', 'ice tea', 'icetea',
];
// Note: "med" and "ovocný džus" are borderline — we flag "mošt" and "sirup"
// which appear commonly in kindergarten menus and are unambiguously sugary.

const JEMNE_PECIVO_KEYWORDS = [
  'koláč', 'buchta', 'bábovka', 'croissant', 'muffin', 'závin', 'štrůdl',
  'perník', 'sušenka', 'piškot', 'dort', 'dortíček', 'zákusek', 'zákusků',
  'tvarohový košíček', 'věneček', 'větrník', 'linecké', 'čokoládový rohlík',
  'kakaový rohlík', 'šneček', 'šneci',
];

const PALMOVY_TUK_KEYWORDS = [
  'palmový olej', 'palmový tuk', 'palmojádrový', 'kokosový tuk', 'kokosový olej',
];

const BUJONY_KEYWORDS = [
  'bujón', 'bujon', 'vývar z kostiček', 'maggi', 'dehydratovaný vývar',
  'instantní vývar', 'masox',
];

/**
 * Check all loaded menu days for a specific keyword list.
 * Returns { hits: [{dayName, mealLabel, dish}], checkedMeals: number }
 */
function scanMenuForKeywords(keywords, mealFilter = null) {
  const days = STATE.currentMenu?.days || [];
  const hits = [];
  let checkedMeals = 0;
  for (const day of days) {
    for (const meal of (day.meals || [])) {
      if (mealFilter && !mealFilter(meal.label)) continue;
      checkedMeals++;
      const dish = (meal.dish || '').toLowerCase();
      if (keywords.some(kw => dish.includes(kw.toLowerCase()))) {
        hits.push({ dayName: day.name, mealLabel: meal.label, dish: meal.dish });
      }
    }
  }
  return { hits, checkedMeals };
}

/**
 * Check whether every meal in the loaded menu contains zelenina or ovoce.
 * Returns { mealsWithout: [{dayName, mealLabel, dish}], checkedMeals }
 */
function checkZeleninaOvoceEveryMeal() {
  const days = STATE.currentMenu?.days || [];
  const mealsWithout = [];
  let checkedMeals = 0;
  for (const day of days) {
    for (const meal of (day.meals || [])) {
      checkedMeals++;
      const dish = (meal.dish || '').toLowerCase();
      const hasZelenina = ZELENINA_KEYWORDS.some(kw => dish.includes(kw));
      const hasOvoce    = OVOCE_KEYWORDS.some(kw => dish.includes(kw));
      if (!hasZelenina && !hasOvoce) {
        mealsWithout.push({ dayName: day.name, mealLabel: meal.label, dish: meal.dish });
      }
    }
  }
  return { mealsWithout, checkedMeals };
}

/**
 * Count distinct calendar months in which jemné pečivo appears
 * ≥N times at oběd, and total occurrences at přesnídávka/svačina.
 * 310/2025: max 1× měsíčně k obědu, max 2× měsíčně k přesnídávce/svačině.
 */
function checkJemnePecivo() {
  const days = STATE.currentMenu?.days || [];
  let obedHits = 0, snackHits = 0;
  for (const day of days) {
    for (const meal of (day.meals || [])) {
      const dish = (meal.dish || '').toLowerCase();
      const isJemne = JEMNE_PECIVO_KEYWORDS.some(kw => dish.includes(kw));
      if (!isJemne) continue;
      const label = (meal.label || '').toLowerCase();
      if (label.includes('oběd')) obedHits++;
      else snackHits++; // přesnídávka + svačina
    }
  }
  // The loaded menu is typically 1 week; scale to monthly estimate
  const days30 = STATE.currentMenu?.days?.length || 5;
  const scaleFactor = 20 / Math.max(days30, 1); // ~20 working days/month
  const obedMonth  = Math.round(obedHits  * scaleFactor);
  const snackMonth = Math.round(snackHits * scaleFactor);
  return {
    obedHits, snackHits, obedMonth, snackMonth,
    obedOk:  obedMonth  <= 1,
    snackOk: snackMonth <= 2,
  };
}

function renderFreqRules() {
  // ── Ledger-based live checks ────────────────────────────────────────────
  const rybyWeeks      = countWeeksWithGroup('ryby');
  const lustaninyWeeks = countWeeksWithGroup('lustaniny');
  const rybyOk         = rybyWeeks >= 2;
  const lustaninyOk    = lustaninyWeeks >= 4;

  const ledgerStatus = (ok, actual, min, unit) => {
    if (actual === 0) return { badge: `0 / ${min} ${unit}`, cls: 'badge-missing', tip: 'Žádný záznam v posledních 30 dnech' };
    if (ok)           return { badge: `✅ ${actual} / ${min} ${unit}`, cls: 'badge-ok',   tip: 'Plněno dle Vyhl. 310/2025' };
    return            { badge: `❌ ${actual} / ${min} ${unit}`, cls: 'badge-fail', tip: 'Nesplněno dle Vyhl. 310/2025' };
  };

  // ── Menu-text live checks ───────────────────────────────────────────────
  const hasMenu = !!(STATE.currentMenu?.days?.length);

  // 🥦 Zelenina nebo ovoce u každého jídla
  let zeleninaStatus;
  if (!hasMenu) {
    zeleninaStatus = { badge: 'Načtěte jídelníček', cls: 'badge-missing', tip: 'Vyžaduje načtený jídelníček' };
  } else {
    const { mealsWithout, checkedMeals } = checkZeleninaOvoceEveryMeal();
    if (mealsWithout.length === 0) {
      zeleninaStatus = {
        badge: `✅ ${checkedMeals} / ${checkedMeals} jídel`,
        cls: 'badge-ok',
        tip: `Všechna jídla v jídelníčku obsahují zeleninu nebo ovoce`,
      };
    } else {
      const names = mealsWithout.map(m => `${m.dayName} ${m.mealLabel}`).join(', ');
      zeleninaStatus = {
        badge: `❌ ${mealsWithout.length} jídel bez zeleniny/ovoce`,
        cls: 'badge-fail',
        tip: `Chybí: ${names}`,
      };
    }
  }

  // 🚫 Sladké nápoje
  let sladkeStatus;
  if (!hasMenu) {
    sladkeStatus = { badge: 'Načtěte jídelníček', cls: 'badge-missing', tip: 'Vyžaduje načtený jídelníček' };
  } else {
    const { hits, checkedMeals } = scanMenuForKeywords(SLADKE_NAPOJE_KEYWORDS);
    if (hits.length === 0) {
      sladkeStatus = {
        badge: `✅ Nenalezeno (${checkedMeals} jídel)`,
        cls: 'badge-ok',
        tip: 'Žádné sladké nápoje nenalezeny v jídelníčku',
      };
    } else {
      const names = hits.map(h => `${h.dayName} ${h.mealLabel}: ${h.dish}`).join(' | ');
      sladkeStatus = {
        badge: `❌ ${hits.length}× nalezeno`,
        cls: 'badge-fail',
        tip: names,
      };
    }
  }

  // 🍞 Jemné pečivo
  let pecivStatus;
  if (!hasMenu) {
    pecivStatus = { badge: 'Načtěte jídelníček', cls: 'badge-missing', tip: 'Vyžaduje načtený jídelníček' };
  } else {
    const jp = checkJemnePecivo();
    const days = STATE.currentMenu.days.length;
    if (jp.obedHits === 0 && jp.snackHits === 0) {
      pecivStatus = {
        badge: `✅ Nenalezeno`,
        cls: 'badge-ok',
        tip: `Žádné jemné pečivo nenalezeno v ${days} dnech jídelníčku`,
      };
    } else {
      const parts = [];
      if (jp.obedHits  > 0) parts.push(`oběd: ${jp.obedHits}× (limit 1×/měs.)`);
      if (jp.snackHits > 0) parts.push(`přesnídávka/svačina: ${jp.snackHits}× (limit 2×/měs.)`);
      const ok = jp.obedOk && jp.snackOk;
      pecivStatus = {
        badge: ok ? `✅ ${jp.obedHits + jp.snackHits}× (v normě)` : `❌ ${jp.obedHits + jp.snackHits}× (překročeno)`,
        cls: ok ? 'badge-ok' : 'badge-fail',
        tip: `${parts.join(', ')} — měsíční odhad z ${days} dní jídelníčku`,
      };
    }
  }

  // ── Build rule list ─────────────────────────────────────────────────────
  const rules = [
    // Ledger-based
    { icon: '🐟', label: 'Ryby, korýši, měkkýši min. 2× měsíčně',   ...ledgerStatus(rybyOk,      rybyWeeks,      2, 'týdny'), live: true, src: 'ledger' },
    { icon: '🫘', label: 'Luštěniny min. 4× měsíčně (1× týdně)',     ...ledgerStatus(lustaninyOk, lustaninyWeeks, 4, 'týdny'), live: true, src: 'ledger' },
    // Menu-text based
    { icon: '🥦', label: 'Zelenina nebo ovoce součástí každého jídla',         ...zeleninaStatus, live: true, src: 'menu' },
    { icon: '🚫', label: 'Zakázáno: sladké nápoje (džus, limonáda, sirup…)',   ...sladkeStatus,   live: true, src: 'menu' },
    { icon: '🍞', label: 'Jemné pečivo: max. 1× oběd / 2× přesnídávka+svačina měsíčně', ...pecivStatus, live: true, src: 'menu' },
    // Cannot be auto-checked
    { icon: '🚫', label: 'Zakázáno: palmový, palmojádrový a kokosový volný tuk — nelze ověřit z jídelníčku (nutná kontrola etiket)', badge: '⚠️ Ruční kontrola', cls: 'badge-missing' },
    { icon: '🚫', label: 'Zakázáno: dehydratované směsi a bujóny s >1 g soli/100 g — nelze ověřit z jídelníčku (nutná kontrola etiket)', badge: '⚠️ Ruční kontrola', cls: 'badge-missing' },
    // Reference / informational
    { icon: '🌾', label: 'Celozrnné obiloviny/pseudoobiloviny (min. 75 %) — viz plnění výše',                           badge: 'Viz výše',   cls: 'badge-info' },
    { icon: '⚗️', label: 'Poměr rostlinných a živočišných tuků min. 2:1 ve prospěch rostlinných',                       badge: '⚠️ Ruční kontrola', cls: 'badge-missing' },
    { icon: '📊', label: 'Tolerance: Maso 75–125 %, Tuky/Cukry max. 100 %, Ryby/Zelenina min. 75 % (bez max.)',         badge: 'Viz výše',   cls: 'badge-info' },
    { icon: '🌱', label: 'BIO potraviny: min. 2 % hmotnosti (jídelny s >180 strávníky od 1. 9. 2028)',                  badge: 'Od 9/2028',  cls: 'badge-future' },
  ];

  const container = document.getElementById('freqRules');
  if (!container) return;

  container.innerHTML = rules.map(r => {
    const srcLabel = r.src === 'ledger' ? '📦 sklad' : r.src === 'menu' ? '📋 jídelníček' : '';
    const srcBadge = r.live ? `<span class="fr-src-badge">${srcLabel}</span>` : '';
    return `
    <div class="freq-rule ${r.live ? 'freq-rule-live' : ''}" ${r.tip ? `title="${escHtml(r.tip)}"` : ''}>
      <span class="fr-icon">${r.icon}</span>
      <span class="fr-label">${escHtml(r.label)}${srcBadge}</span>
      <span class="fr-badge ${r.cls}">${escHtml(r.badge)}</span>
    </div>`;
  }).join('');
}

function getComplianceViewMode() {
  return localStorage.getItem('complianceViewMode') === 'custom' ? 'custom' : 'official';
}

function setComplianceViewMode(mode) {
  localStorage.setItem('complianceViewMode', mode === 'custom' ? 'custom' : 'official');
  renderComplianceViewToggle();
  checkCompliance();
}

function renderComplianceViewToggle() {
  const mode = getComplianceViewMode();
  document.querySelectorAll('#compViewToggle .cvt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const hint = document.getElementById('compViewHint');
  if (hint) {
    hint.textContent = mode === 'custom'
      ? '🎛️ Vlastní zobrazení: Zelenina a Ovoce zvlášť (% sdílené, dle vyhlášky), Celozrnné obiloviny a pseudoobiloviny skryté.'
      : '📜 Nejnovější pravidla: přesně dle Vyhl. č. 107/2005 Sb., ve znění Vyhl. č. 310/2025 Sb.';
  }
  const ratioRow = document.getElementById('compRatioRow');
  if (ratioRow) ratioRow.style.display = mode === 'custom' ? 'flex' : 'none';
  const ratioInput = document.getElementById('zeleninaRatioInput');
  if (ratioInput && document.activeElement !== ratioInput) ratioInput.value = getZeleninaSplitRatio();
}

function checkCompliance() {
  const N = window.NORMS;
  const ageKey = document.getElementById('attAgeGroup')?.value || 'ms_3_6';
  const container = document.getElementById('complianceResult');

  // Calculate actual monthly consumption from ledger INCOME entries (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentItems = STATE.ledger.filter(e => e.type === 'in' && new Date(e.date) >= thirtyDaysAgo);

  const workingDays = 20; // ~20 working days per month
  const avgChildren = parseInt(document.getElementById('childCount')?.value) || 25;

  if (!recentItems.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">⚖️</span><p>Žádné záznamy ve skladu za posledních 30 dní. Nejprve potvrďte nákup.</p></div>`;
    return;
  }

  // Classification uses the shared classifyLedgerItem() helper (module scope)
  // so compliance, stock balance, and the smart-buying planner all agree.

  let taggedCount = 0, guessedCount = 0;

  // Sum actual grams per food group, plus a zelenina/ovoce sub-split
  // (display-only — used only by the custom view, never affects the
  // official compliance % which is always computed from the combined total).
  const actualGrams = {};
  const subSplit = { zelenina: 0, ovoce: 0 };
  for (const item of recentItems) {
    const c = classifyLedgerItem(item);
    if (!c) continue;
    if (c.wasTagged) taggedCount++; else guessedCount++;

    const grams = item.grams || toGrams(item.qty, item.unit);
    const gramsPerDay = grams / workingDays / avgChildren;
    actualGrams[c.groupKey] = (actualGrams[c.groupKey] || 0) + gramsPerDay;

    if (c.groupKey === 'zeleninaOvoce') {
      if (c.rowKey === 'zeleninaOvoce_ovoce') {
        subSplit.ovoce += gramsPerDay;
      } else if (c.rowKey === 'zeleninaOvoce_zelenina') {
        subSplit.zelenina += gramsPerDay;
      } else {
        // Still ambiguous — fall back to your configured ratio rather than an arbitrary 50/50.
        const r = getZeleninaSplitRatio() / 100;
        subSplit.zelenina += gramsPerDay * r;
        subSplit.ovoce += gramsPerDay * (1 - r);
      }
    }
  }

  // Render compliance bars
  // Track represents 0–150 % of the norm target.
  // bar fill width and marker positions are all scaled to that range.
  const SCALE = 150; // track = 150 % of norm
  const mode = getComplianceViewMode();

  const renderBarRow = (group, result, label) => {
    const barWidth = Math.min(100, (result.pct / SCALE) * 100); // capped at 100% of track
    const minMark = (group.min * 100 / SCALE) * 100;
    const maxMark = group.max !== null ? (group.max * 100 / SCALE) * 100 : null;
    const maxMarker = maxMark !== null
      ? `<div class="comp-bar-max" style="left:${maxMark}%" title="Max ${Math.round(group.max*100)}%"></div>`
      : '';
    return `
      <div class="comp-row-header">
        <span class="norm-dot" style="background:${group.color}"></span>
        <span class="comp-label">${escHtml(label)}</span>
        <span class="comp-pct ${result.status}">${result.pct} %</span>
      </div>
      <div class="comp-bar-track">
        <div class="comp-bar-fill ${result.status}" style="width:${barWidth}%"></div>
        <div class="comp-bar-min" style="left:${minMark}%" title="Min ${Math.round(group.min*100)}%"></div>
        ${maxMarker}
      </div>`;
  };

  let groupEntries = Object.entries(N.foodGroups);
  if (mode === 'custom') {
    // Custom view: hide Celozrnné obiloviny a pseudoobiloviny, split Zelenina/Ovoce into two rows.
    groupEntries = groupEntries.filter(([key]) => key !== 'celozrnne');
  }

  const rows = groupEntries.map(([key, group]) => {
    const actual = actualGrams[key] || 0;
    const result = N.checkCompliance(actual, key, ageKey);

    if (mode === 'custom' && key === 'zeleninaOvoce') {
      // Two visual rows (Zelenina / Ovoce), both driven by the SAME combined
      // result (target/%/status) — per Vyhláška 310/2025 there is only one
      // official combined target, so the compliance % must stay identical
      // on both rows. Only the displayed "actual" amount differs, split by
      // item name for your own internal tracking.
      const ovoceGroup = { ...group, label: 'Ovoce', color: '#C0CA33' };
      const zeleninaGroup = { ...group, label: 'Zelenina', color: '#43A047' };
      const sharedNote = `<div class="comp-shared-note">Společný cíl dle vyhlášky 310/2025 (Zelenina + Ovoce dohromady) — % je sdílené mezi oběma řádky.</div>`;
      return `
      <div class="comp-row comp-row-linked" style="color:${zeleninaGroup.color}">
        ${renderBarRow(zeleninaGroup, result, zeleninaGroup.label)}
        <div class="comp-detail">Skutečnost (zelenina): ${subSplit.zelenina.toFixed(1)} g/den</div>
        ${sharedNote}
      </div>
      <div class="comp-row comp-row-linked" style="color:${ovoceGroup.color}">
        ${renderBarRow(ovoceGroup, result, ovoceGroup.label)}
        <div class="comp-detail">Skutečnost (ovoce): ${subSplit.ovoce.toFixed(1)} g/den</div>
        <div class="comp-detail">Cíl (společný): ${result.target.toFixed(1)} g/den · Min: ${(result.target * group.min).toFixed(1)} g/den · Max: ${group.max !== null ? (result.target * group.max).toFixed(1) + ' g/den' : '—'} · ${result.status === 'ok' ? '✅ V normě' : result.status === 'low' ? '❌ Pod normou' : '⚠️ Nad normou'}</div>
      </div>`;
    }

    return `
      <div class="comp-row">
        ${renderBarRow(group, result, group.label)}
        <div class="comp-detail">
          Cíl: ${result.target.toFixed(1)} g/den · Skutečnost: ${result.actual.toFixed(1)} g/den ·
          Min: ${(result.target * group.min).toFixed(1)} g/den · Max: ${group.max !== null ? (result.target * group.max).toFixed(1) + ' g/den' : '—'} ·
          ${result.status === 'ok' ? '✅ V normě' : result.status === 'low' ? '❌ Pod normou' : '⚠️ Nad normou'}
        </div>
      </div>`;
  });

  container.innerHTML = `
    <div class="compliance-grid">${rows.join('')}</div>
    <p class="muted" style="margin-top:.75rem">
      Výpočet z posledních 30 dní · ${recentItems.length} položek (${taggedCount} přesně přiřazeno, ${guessedCount} odhadnuto z názvu) ·
      ${workingDays} pracovních dní · Průměr ${avgChildren} dětí/den.
    </p>`;
}

// ══════════════════════════════════════════════════════════
// INIT ATTENDANCE & NORMS
// ══════════════════════════════════════════════════════════
function initAttendance() {
  const currentWeek = getISOWeekString();
  const currentYear = new Date().getFullYear();

  populateAttYearSelect(currentYear);
  populateAttWeekSelect(currentYear, currentWeek);

  const yearSelect = document.getElementById('attYearPicker');
  const weekSelect = document.getElementById('attWeekPicker');

  yearSelect?.addEventListener('change', () => {
    const year = parseInt(yearSelect.value, 10);
    populateAttWeekSelect(year); // no selectedWeek → defaults to current week (if this year) or week 1
    setAttWeek(weekSelect.value);
  });
  weekSelect?.addEventListener('change', () => setAttWeek(weekSelect.value));

  // Do NOT load from cloud here — initAttendance() runs at DOMContentLoaded,
  // before the user is logged in. Cloud fetch happens in showApp() via
  // refreshAllFromCloud() after a successful login. Just render the empty grid.
  renderAttendanceGrid();

  const ageSelect = document.getElementById('attAgeGroup');
  if (ageSelect) ageSelect.addEventListener('change', renderAttendanceGrid);

  document.getElementById('btnSaveAttendance')?.addEventListener('click', async () => {
    // Read all inputs and build rows to write to Supabase
    const week = getCurrentAttWeek();
    const rows = [];
    document.querySelectorAll('.att-meal-input').forEach(inp => {
      const day = parseInt(inp.dataset.day);
      const meal = inp.dataset.meal;
      const count = parseInt(inp.value) || 0;
      rows.push({
        org_id: window.SYNC.ORG_ID,
        week_key: week,
        day_index: day,
        meal,
        age_group: document.getElementById('attAgeGroup')?.value || 'ms_3_6',
        child_count: count,
      });
    });

    const btn = document.getElementById('btnSaveAttendance');
    btn.disabled = true;
    setStatus('busy', 'Ukládám docházku…');
    try {
      await dbPut('/api/db/attendance/bulk', { rows });
      await loadAttendanceWeekFromCloud(week);
      renderAttendanceGrid();
      setStatus('ok', 'Uloženo');
      toast('Docházka uložena!', 'success');
    } catch (err) {
      setStatus('error', 'Chyba ukládání');
      toast('Docházku se nepodařilo uložit: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btnCopyPrevWeek')?.addEventListener('click', copyPrevWeek);
  document.getElementById('btnCalcIngredients')?.addEventListener('click', calcIngredients);

// ── Nákup tab week picker init ──────────────────────────
  const nakupCurrentWeek = getISOWeekString();
  const nakupCurrentYear = new Date().getFullYear();
  populateNakupYearSelect(nakupCurrentYear);
  populateNakupWeekSelect(nakupCurrentYear, nakupCurrentWeek);

  const nakupYearSel = document.getElementById('nakupYearPicker');
  const nakupWeekSel = document.getElementById('nakupWeekPicker');
  nakupYearSel?.addEventListener('change', () => {
    populateNakupWeekSelect(parseInt(nakupYearSel.value, 10));
  });
  document.getElementById('btnNakupCalc')?.addEventListener('click', calcIngredientsForNakup);
}

// Fetches all distinct week_keys with attendance data from DB,
// groups them by month, picks the most recent month's weeks,
// and renders quick-select pill buttons above the Nákup calc result.
async function loadNakupWeekShortcuts() {
  const orgId = window.SYNC?.ORG_ID;
  if (!orgId) {
    // Auth may not be ready yet — retry once after login settles
    setTimeout(loadNakupWeekShortcuts, 800);
    return;
  }

  let weeks;
  try {
    const res = await authedFetch(`/api/db/attendance/weeks/${orgId}`);
    if (!res.ok) {
      console.error('loadNakupWeekShortcuts: HTTP', res.status);
      return;
    }
    weeks = await res.json();
  } catch (err) {
    console.error('loadNakupWeekShortcuts fetch error:', err);
    return;
  }

  if (!weeks || !weeks.length) return;

  // Group weeks by month using the Thursday of each week — ISO rule: Thursday
  // always falls in the same month that "owns" the week, so weeks spanning
  // month boundaries are attributed correctly (e.g. a week starting June 30
  // whose Thursday is July 3 belongs to July).
  const byMonth = new Map();
  for (const wk of weeks) {
    const thursday = getWeekDates(wk)[3]; // index 3 = Thursday
    const monthKey = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push(wk);
  }

  // Most recent month (first entry since weeks sorted desc).
  const latestMonthKey = [...byMonth.keys()][0];
  const latestWeeks = byMonth.get(latestMonthKey).sort(); // asc for display

  // Parse month label from Thursday of the first week in this month.
  const firstThursday = getWeekDates(latestWeeks[0])[3];
  const monthLabel = `${MONTH_NAMES_CZ[firstThursday.getMonth() + 1]} ${firstThursday.getFullYear()}`;

  const container = document.getElementById('nakupWeekShortcuts');
  if (!container) return;

  container.innerHTML = `
    <span class="nws-label">Poslední import — ${escHtml(monthLabel)}:</span>
    ${latestWeeks.map(wk => {
      const dates = getWeekDates(wk);
      const [,wNum] = wk.split('-W');
      const label = `Týden ${parseInt(wNum, 10)}<br><small>${formatCzDate(dates[0])} – ${formatCzDate(dates[4])}</small>`;
      return `<button class="btn nws-btn" data-week="${escHtml(wk)}">${label}</button>`;
    }).join('')}`;

  container.querySelectorAll('.nws-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wk = btn.dataset.week;
      const year = parseInt(wk.split('-W')[0], 10);
      // Sync the dropdowns to match the chosen week.
      const yearSel = document.getElementById('nakupYearPicker');
      if (yearSel && yearSel.value !== String(year)) {
        yearSel.value = String(year);
        populateNakupWeekSelect(year, wk);
      }
      const weekSel = document.getElementById('nakupWeekPicker');
      if (weekSel) weekSel.value = wk;
      // Highlight active button.
      container.querySelectorAll('.nws-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Run the calc immediately.
      calcIngredientsForNakup();
    });
  });
}

function initNorms() {
  renderNormReference();
  renderFreqRules();
  document.getElementById('btnCheckCompliance')?.addEventListener('click', checkCompliance);
  document.querySelectorAll('#compViewToggle .cvt-btn').forEach(btn => {
    btn.addEventListener('click', () => setComplianceViewMode(btn.dataset.mode));
  });
  document.getElementById('zeleninaRatioInput')?.addEventListener('change', (e) => {
    setZeleninaSplitRatio(e.target.value);
    renderComplianceViewToggle();
    checkCompliance();
  });
  renderComplianceViewToggle();
}
