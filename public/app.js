/* ═══════════════════════════════════════════════════════════
   Canteen Smart Manager – app.js
   All state is persisted to localStorage under 'canteen_*'
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
const STATE = {
  currentMenu: null,        // { fetchedAt, raw, days: [{name, meals:[]}] }
  ingredients: [],          // string[]
  ledger: [],                // unified income/outcome transactions (see model above)
  cart: [],                  // current shopping list draft, built from norms calc
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Approximate unit → grams conversion for norm math (best effort)
const UNIT_TO_GRAMS = { kg: 1000, g: 1, l: 1000, ml: 1, ks: 100, bal: 250 };
function toGrams(qty, unit) {
  return Math.round((parseFloat(qty) || 0) * (UNIT_TO_GRAMS[unit] || 100));
}

// ── Persistence ────────────────────────────────────────────
function save(key, val) {
  try { localStorage.setItem('canteen_' + key, JSON.stringify(val)); } catch (e) {}
}
function load(key, fallback = null) {
  try {
    const s = localStorage.getItem('canteen_' + key);
    return s !== null ? JSON.parse(s) : fallback;
  } catch (e) { return fallback; }
}
function loadAll() {
  STATE.currentMenu  = load('menu',      null);
  STATE.ingredients  = load('ingredients', []);
  STATE.ledger       = load('ledger',    migrateOldData());
  STATE.cart         = load('cart',      []);
}
function saveMenu()    { save('menu', STATE.currentMenu); save('ingredients', STATE.ingredients); }
function saveLedger()  { save('ledger', STATE.ledger); }
function saveCart()    { save('cart', STATE.cart); }

// One-time migration from old 'warehouse' array (pre-ledger) so existing users don't lose data
function migrateOldData() {
  const oldWarehouse = load('warehouse', null);
  if (!oldWarehouse || !oldWarehouse.length) return [];
  return oldWarehouse.map(item => ({
    id: item.id || (Date.now() + Math.random()),
    type: 'in',
    name: item.name,
    foodGroup: null,
    qty: item.qty,
    unit: item.unit,
    grams: toGrams(item.qty, item.unit),
    price: item.price || 0,
    store: item.store || 'Neznámý',
    promo: !!item.promo,
    date: item.addedAt || new Date().toISOString(),
    weekKey: item.weekKey || getWeekKey(),
    source: 'manual',
  }));
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
      // Lazy-load audit log when tab is opened
      if (btn.dataset.tab === 'audit') loadAuditLog();
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

    STATE.currentMenu = { fetchedAt, raw: trimmed, days: parsed };
    STATE.ingredients = extractIngredients(parsed);
    saveMenu();

    // DB sync — fires menu.fetch audit
    const weekKey = getWeekKey(new Date(fetchedAt));
    dbPost('/api/db/menus', {
      org_id: window.SYNC?.ORG_ID,
      week_key: weekKey,
      raw_text: trimmed,
      days_json: parsed,
      ingredients: STATE.ingredients,
    });

    renderMenu();
    renderIngredients();
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
    max_tokens: 2000,
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
  { id: 'kupi',     name: 'Kupi.cz – Akce',      search: 'https://www.kupi.cz/sleva/{q}',   type: 'search' },
  { id: 'kupi_all', name: 'Kupi.cz – Hledat vše', search: 'https://www.kupi.cz/hledej?f={q}', type: 'search' },
  { id: 'lidl',     name: 'Lidl – leták',     search: 'https://www.kupi.cz/letaky/lidl',     type: 'browse' },
  { id: 'kaufland', name: 'Kaufland – leták', search: 'https://www.kupi.cz/letaky/kaufland', type: 'browse' },
  { id: 'albert',   name: 'Albert – leták',   search: 'https://www.kupi.cz/letaky/albert',   type: 'browse' },
  { id: 'globus',   name: 'Globus – leták',   search: 'https://www.kupi.cz/letaky/globus',   type: 'browse' },
];

function storeSearchUrl(storeId, query) {
  const store = STORES.find(s => s.id === storeId);
  if (!store) return '#';
  return store.type === 'search' ? store.search.replace('{q}', encodeURIComponent(query)) : store.search;
}

/**
 * Build the shopping list directly from the last norm calculation
 * (window.LAST_CALC, set by calcIngredients() in the Attendance tab).
 * Each food group becomes one cart line with the required grams,
 * pre-filled with a sensible practical unit (kg).
 */
function loadShoppingFromNorms() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) {
    toast('Nejprve v záložce Docházka zadejte docházku a klikněte „Přepočítat".', 'info');
    return;
  }

  STATE.cart = calc.results
    .filter(r => r.totalGrams > 0)
    .map(r => ({
      id: 'fg_' + r.key,
      foodGroup: r.key,
      name: r.label,
      qty: r.totalGrams >= 1000 ? +(r.totalGrams / 1000).toFixed(2) : r.totalGrams,
      unit: r.totalGrams >= 1000 ? 'kg' : 'g',
      neededGrams: r.totalGrams,
      price: 0,
      store: '',
      promo: false,
      source: 'norms',
    }));
  saveCart();
  renderOffers(calc);
  renderShoppingList();
  toast('Nákupní seznam vytvořen z výpočtu surovin!', 'success');
  setStatus('ok', 'Nákupní seznam připraven');
}

function renderOffers(calc) {
  const container = document.getElementById('offersContent');
  if (!STATE.cart?.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🛒</span><p>Nejprve v záložce <strong>Docházka</strong> zadejte docházku a klikněte „Přepočítat". Pak se zde tlačítkem „Načíst z výpočtu surovin" vytvoří nákupní seznam.</p></div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'offers-grid';

  for (const item of STATE.cart) {
    if (item.source === 'custom') continue; // custom items don't need store search cards
    const card = document.createElement('div');
    card.className = 'offer-card';
    const links = STORES.map(s => {
      const badgeLabel = s.type === 'search' ? '🏷️ Najít akci' : '📰 Prohlédnout leták';
      return `<a class="store-link" href="${escHtml(storeSearchUrl(s.id, item.name))}" target="_blank" rel="noopener">
        <span>${escHtml(s.name)}</span>
        <span class="store-badge ${s.type === 'search' ? 'promo' : ''}">${badgeLabel}</span>
      </a>`;
    }).join('');
    card.innerHTML = `<div class="ingredient-name">🥕 ${escHtml(item.name)} <span class="muted">(potřeba ${item.qty} ${item.unit})</span></div>
      <div class="store-links">${links}</div>`;
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
      <label class="si-name" for="si-${i}">${escHtml(item.name)} <span class="muted">(${item.qty} ${item.unit})</span>
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
  saveCart();
  updateCartTotal();
}
function updateCartStore(i, val) {
  STATE.cart[i].store = val;
  saveCart();
}
function updateCartPromo(i, checked) {
  STATE.cart[i].promo = checked;
  saveCart();
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
    saveCart();
    renderShoppingList();
    document.getElementById('customItemForm').classList.add('hidden');
    ['custItemName','custItemQty','custItemPrice','custItemSupplier'].forEach(id => document.getElementById(id).value = '');
    toast(`Položka „${name}" přidána do nákupního seznamu.`, 'success');
  });
}

// ══════════════════════════════════════════════════════════
// CONFIRM PURCHASE → WAREHOUSE (ledger income/IN entries)
// ══════════════════════════════════════════════════════════
function confirmPurchase() {
  const items = STATE.cart.filter(i => !i._skip && i.name);
  if (!items.length) { toast('Nákupní seznam je prázdný.', 'info'); return; }

  const weekKey = getWeekKey();
  const now = new Date().toISOString();

  for (const item of items) {
    STATE.ledger.push({
      id: Date.now() + Math.random(),
      type: 'in',
      name: item.name,
      foodGroup: item.foodGroup || null,
      qty: item.qty,
      unit: item.unit,
      grams: toGrams(item.qty, item.unit),
      price: item.price || 0,
      store: item.store || (item.source === 'custom' ? 'Vlastní dodavatel' : 'Neuvedeno'),
      promo: item.promo || false,
      date: now,
      weekKey,
      source: item.source === 'custom' ? 'manual' : 'shopping',
    });
  }

  saveLedger();
  STATE.cart = [];
  saveCart();

  // DB sync — fires ledger.in audit automatically via dbRoutes
  const dbEntries = items.map(item => ({
    org_id: window.SYNC?.ORG_ID,
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
  dbPost('/api/db/ledger/bulk-in', { entries: dbEntries });

  // Also create + confirm a shopping list record → fires shopping.confirm audit
  dbPost('/api/db/shopping-lists', {
    org_id: window.SYNC?.ORG_ID,
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
  }).then(list => {
    if (list?.id) {
      // Immediately confirm it — this is the action that fires shopping.confirm audit
      fetch(`/api/db/shopping-lists/${list.id}/confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...window.AUTH.getAuthHeader() },
      }).catch(() => {});
    }
  });

  renderWarehouse();
  renderStockBalance();
  renderFinance();
  document.getElementById('shoppingPanel').classList.add('hidden');
  toast(`${items.length} položek přijato na sklad!`, 'success');
  switchTab('warehouse');
}

// ══════════════════════════════════════════════════════════
// CONSUME WEEK → WAREHOUSE (ledger outcome/OUT entries)
// Deducts the calculated norm requirement for the selected week
// from stock, representing food that was cooked & served.
// ══════════════════════════════════════════════════════════
function consumeWeek() {
  const calc = window.LAST_CALC;
  if (!calc || !calc.results?.length) {
    toast('Nejprve v záložce Docházka spočítejte suroviny pro daný týden („Přepočítat").', 'info');
    return;
  }

  const weekKey = calc.weekKey || getWeekKey();
  const now = new Date().toISOString();

  // Check if this week was already consumed to avoid double-deduction
  const alreadyConsumed = STATE.ledger.some(e => e.type === 'out' && e.weekKey === weekKey && e.source === 'consumption');
  if (alreadyConsumed) {
    if (!confirm(`Spotřeba pro týden ${weekKeyLabel(weekKey)} už byla jednou odepsána. Odepsat znovu?`)) return;
  }

  let count = 0;
  for (const r of calc.results) {
    if (r.totalGrams <= 0) continue;
    STATE.ledger.push({
      id: Date.now() + Math.random() + count,
      type: 'out',
      name: r.label,
      foodGroup: r.key,
      qty: r.totalGrams >= 1000 ? +(r.totalGrams / 1000).toFixed(2) : r.totalGrams,
      unit: r.totalGrams >= 1000 ? 'kg' : 'g',
      grams: r.totalGrams,
      price: 0,
      store: 'Spotřeba (vařeno a vydáno)',
      promo: false,
      date: now,
      weekKey,
      source: 'consumption',
    });
    count++;
  }

  saveLedger();

  // DB sync — fires ledger.out audit automatically via dbRoutes
  const dbOutEntries = STATE.ledger
    .filter(e => e.type === 'out' && e.weekKey === weekKey && e.source === 'consumption' && !e._synced)
    .map(e => ({
      org_id: window.SYNC?.ORG_ID,
      name: e.name,
      food_group: e.foodGroup || null,
      qty: e.qty,
      unit: e.unit,
      grams: e.grams,
      price: 0,
      store: e.store,
      promo: false,
      week_key: weekKey,
      source: 'consumption',
    }));
  if (dbOutEntries.length) dbPost('/api/db/ledger/bulk-out', { entries: dbOutEntries });

  renderWarehouse();
  renderStockBalance();
  renderFinance();
  toast(`Spotřeba týdne ${weekKeyLabel(weekKey)} odepsána ze skladu (${count} skupin potravin).`, 'success');
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

function deleteLedgerItem(id) {
  STATE.ledger = STATE.ledger.filter(i => String(i.id) !== String(id));
  saveLedger();
  renderWarehouse();
  renderStockBalance();
  renderFinance();
  toast('Záznam odstraněn.', 'info');
  // DB sync — fires ledger.delete audit (only works if item was synced to DB)
  if (window.AUTH?.isLoggedIn()) {
    fetch(`/api/db/ledger/${id}`, {
      method: 'DELETE',
      headers: window.AUTH.getAuthHeader(),
    }).catch(() => {}); // non-blocking, item may not exist in DB yet (unsynced local item)
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
  document.getElementById('btnSaveItem').addEventListener('click', () => {
    const name  = document.getElementById('itemName').value.trim();
    const foodGroup = document.getElementById('itemGroup').value || null;
    const qty   = parseFloat(document.getElementById('itemQty').value) || 1;
    const unit  = document.getElementById('itemUnit').value;
    const price = parseFloat(document.getElementById('itemPrice').value) || 0;
    const store = document.getElementById('itemStore').value;
    const promo = document.getElementById('itemPromo').value === 'true';

    if (!name) { toast('Zadejte název suroviny.', 'error'); return; }

    const weekKey = getWeekKey();
    STATE.ledger.push({
      id: Date.now(), type: 'in', name, foodGroup,
      qty, unit, grams: toGrams(qty, unit),
      price, store, promo,
      date: new Date().toISOString(), weekKey,
      source: 'manual',
    });

    saveLedger();

    // DB sync — fires ledger.in audit automatically via dbRoutes
    dbPost('/api/db/ledger/bulk-in', {
      entries: [{ org_id: window.SYNC?.ORG_ID, name, food_group: foodGroup, qty, unit, grams: toGrams(qty, unit), price, store, promo, week_key: weekKey, source: 'manual' }]
    });

    renderWarehouse();
    renderStockBalance();
    renderFinance();
    document.getElementById('addItemForm').classList.add('hidden');
    ['itemName','itemQty','itemPrice'].forEach(id => document.getElementById(id).value = '');
    toast('Položka přidána na sklad!', 'success');
  });

  document.getElementById('btnConsumeWeek')?.addEventListener('click', consumeWeek);
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

  document.getElementById('btnClearData').addEventListener('click', () => {
    if (!confirm('Opravdu smazat všechna data? Tato akce je nevratná.')) return;
    ['menu','ingredients','ledger','cart','warehouse','purchases','attendance'].forEach(k => localStorage.removeItem('canteen_' + k));
    loadAll();
    renderAll();
    toast('Všechna data byla smazána.', 'info');
  });
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
  renderOffers();
  renderWarehouse();
  renderStockBalance();
  renderFinance();
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// DB SYNC HELPER — fires DB writes alongside localStorage
// Non-blocking: if DB call fails, localStorage write already
// succeeded so the app keeps working. Audit is a side-effect.
// ══════════════════════════════════════════════════════════

async function dbPost(path, body) {
  if (!window.AUTH?.isLoggedIn()) return null;
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...window.AUTH.getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[dbSync] ${path} failed:`, err.error || res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[dbSync] ${path} error:`, e.message);
    return null;
  }
}

async function dbPut(path, body) {
  if (!window.AUTH?.isLoggedIn()) return null;
  try {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...window.AUTH.getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[dbSync] PUT ${path} failed:`, err.error || res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[dbSync] PUT ${path} error:`, e.message);
    return null;
  }
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
// SPRINT 2 — AUTH BOOTSTRAP
// Gates the app behind login when DB is configured; otherwise the
// app runs exactly as before (Sprint 1 localStorage-only fallback).
// ══════════════════════════════════════════════════════════

async function initAuthFlow() {
  const { dbConfigured } = await window.AUTH.init();

  if (!dbConfigured) {
    // No database configured at all — skip auth entirely, app works
    // exactly like pre-Sprint-2 on localStorage only.
    return;
  }

  if (window.AUTH.isLoggedIn()) {
    showApp();
  } else {
    showLogin();
  }

  wireLoginForms();
}

function showLogin() {
  document.getElementById('loginOverlay').classList.remove('hidden');
}

function showApp() {
  document.getElementById('loginOverlay').classList.add('hidden');
  applyRoleGating();
  renderAccountInfo();
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
  badge.innerHTML = `${escHtml(profile.full_name || 'Uživatel')} <span class="role-pill">${escHtml(window.AUTH.roleLabel())}</span>`;

  const accountInfo = document.getElementById('accountInfo');
  accountInfo.innerHTML = `
    Přihlášen jako <strong>${escHtml(profile.full_name || '–')}</strong><br>
    Role: <strong>${escHtml(window.AUTH.roleLabel())}</strong>`;
  document.getElementById('btnLogout').classList.remove('hidden');

  document.getElementById('syncCard').classList.remove('hidden');

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
      showApp();
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
        showApp();
        toast('Účet vytvořen a jste přihlášeni!', 'success');
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await window.AUTH.signOut();
    document.getElementById('userBadge').classList.add('hidden');
    document.getElementById('syncCard').classList.add('hidden');
    document.getElementById('membersCard').classList.add('hidden');
    showLogin();
  });

  document.getElementById('btnSyncPush')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('syncStatus');
    statusEl.textContent = 'Synchronizuji…';
    const report = await window.SYNC.pushToCloud(msg => statusEl.textContent = msg);
    statusEl.textContent = report.errors.length
      ? `Hotovo s chybami: ${report.errors.join('; ')}`
      : `✅ Nahráno: menu=${report.menu}, docházka=${report.attendance}, sklad=${report.ledger}`;
  });

  document.getElementById('btnSyncPull')?.addEventListener('click', async () => {
    if (!confirm('Stažení z cloudu přepíše lokální sklad daty z databáze. Pokračovat?')) return;
    const statusEl = document.getElementById('syncStatus');
    statusEl.textContent = 'Stahuji…';
    const report = await window.SYNC.pullFromCloud(msg => statusEl.textContent = msg);
    renderWarehouse(); renderStockBalance(); renderFinance();
    statusEl.textContent = report.errors.length
      ? `Hotovo s chybami: ${report.errors.join('; ')}`
      : `✅ Staženo: sklad=${report.ledger} záznamů`;
  });
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
    <h3>📋 ${escHtml(weekKeyRangeLabel(weekKey))}</h3>
    <span class="muted">Uloženo: ${new Date(entry.fetched_at).toLocaleDateString('cs-CZ')}</span>
  </div>`;
  detail.appendChild(grid);
}

function initSavedMenusBrowser() {
  document.getElementById('btnLoadSavedMenus').addEventListener('click', loadSavedMenus);
}

document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  initTabs();
  initWarehouseForm();
  initSettings();

  // Init modules
  initAttendance();
  initNorms();
  initCustomItemForm();
  initAuditTab();
  initAuthFlow();
  initSavedMenusBrowser();
  initExport();

  // Button bindings
  document.getElementById('btnFetchMenu').addEventListener('click', fetchMenu);
  document.getElementById('btnGoToOffers').addEventListener('click', () => switchTab('offers'));
  document.getElementById('btnGenOffers').addEventListener('click', loadShoppingFromNorms);
  document.getElementById('btnConfirmPurchase').addEventListener('click', confirmPurchase);

  // Child count change → re-render finance
  document.getElementById('childCount').addEventListener('change', renderFinance);

  // Render saved data on load
  renderAll();

  // Restore last check label
  if (STATE.currentMenu?.fetchedAt) {
    document.getElementById('lastCheck').textContent =
      'Poslední kontrola: ' + new Date(STATE.currentMenu.fetchedAt).toLocaleString('cs-CZ');
  }

  setStatus('', 'Připraveno');
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
let attendanceData = {};

function loadAttendance() {
  attendanceData = load('attendance', {});
}
function saveAttendance() {
  save('attendance', attendanceData);
}

function getCurrentAttWeek() {
  const picker = document.getElementById('attWeekPicker');
  return picker ? picker.value : getISOWeekString();
}

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

function copyPrevWeek() {
  const weekStr = getCurrentAttWeek();
  // Find previous week
  const dates = getWeekDates(weekStr);
  const prevMonday = new Date(dates[0]);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevWeek = getISOWeekString(prevMonday);

  if (!attendanceData[prevWeek]) {
    toast('Předchozí týden nemá žádná data.', 'info'); return;
  }
  attendanceData[weekStr] = JSON.parse(JSON.stringify(attendanceData[prevWeek]));
  saveAttendance();
  renderAttendanceGrid();
  toast('Docházka zkopírována z minulého týdne.', 'success');
}

// ── Ingredient calculator from attendance + norms ──────────
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
  const results = Object.entries(N.foodGroups).map(([key, group]) => {
    let totalGrams = 0;
    const breakdown = MEALS_LIST.map(m => {
      const children = mealTotals[m.key];
      const g = N.calcGrams(key, m.key, ageGroup, children);
      totalGrams += g;
      return `${m.label}: ${g} g (${children} dětí)`;
    });

    // Convert to practical units
    const displayAmt = totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(1)} kg`
      : `${totalGrams} g`;

    return { key, label: group.label, totalGrams, displayAmt, breakdown, color: group.color };
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
      <p>Výpočet je hotový. Přejděte na záložku <strong>Akce & Nákup</strong> a klikněte
      „🧮 Načíst z výpočtu surovin" — vytvoří se nákupní seznam přesně podle těchto čísel.</p>
    </div>
    <p class="muted" style="margin-top:.5rem">
      Celkem porcí tento týden: <strong>${totalPortions}</strong> ·
      Věková skupina: <strong>${escHtml(N.ageGroups[ageGroup]?.label || ageGroup)}</strong> ·
      Hodnoty dle Vyhlášky č. 107/2005 Sb., Tabulka 1
    </p>`;
}

// ══════════════════════════════════════════════════════════
// NORMS / COMPLIANCE MODULE
// ══════════════════════════════════════════════════════════

function renderNormReference() {
  const N = window.NORMS;
  const ageKey = 'ms_3_6';
  const age = N.ageGroups[ageKey];
  const container = document.getElementById('normRefGrid');
  if (!container) return;

  container.innerHTML = Object.entries(N.foodGroups).map(([key, g]) => {
    const dayVal = Math.round(g.adultDay * age.pct);
    return `
      <div class="norm-ref-item">
        <span class="norm-dot" style="background:${g.color}"></span>
        <span class="nr-label">${escHtml(g.label)}</span>
        <span class="nr-value">${dayVal} g/den</span>
      </div>`;
  }).join('');
}

function renderFreqRules() {
  const rules = [
    { icon: '🐟', label: 'Ryby min. 2× měsíčně', badge: '2×/měsíc' },
    { icon: '🫘', label: 'Luštěniny min. 4× měsíčně (1× týdně)', badge: '4×/měsíc' },
    { icon: '🌾', label: 'Celozrnné obiloviny min. 3× týdně', badge: '3×/týden' },
    { icon: '🥦', label: 'Zelenina nebo ovoce součástí každého jídla', badge: 'Každé jídlo' },
    { icon: '🚫', label: 'Zakázáno: sladké nápoje (džus, limonáda, sirup)', badge: 'Zakázáno' },
    { icon: '🚫', label: 'Zakázáno: palmový, kokosový tuk jako volný tuk', badge: 'Zakázáno' },
    { icon: '🚫', label: 'Zakázáno: polévkové koření (bujón, Maggi) s >10% soli', badge: 'Zakázáno' },
    { icon: '🚫', label: 'Zakázáno: sladidla v nápojích nebo potravinách', badge: 'Zakázáno' },
    { icon: '⚠️', label: 'Sůl: sledujte obsah ve výrobcích, max. 10 g/100 g', badge: 'Max 10g/100g' },
    { icon: '📊', label: 'Plnění SK: tolerance 75 %–125 % (50–150 % pro maso při výběru)', badge: '75–125 %' },
  ];

  const container = document.getElementById('freqRules');
  if (!container) return;
  container.innerHTML = rules.map(r => `
    <div class="freq-rule">
      <span class="fr-icon">${r.icon}</span>
      <span class="fr-label">${escHtml(r.label)}</span>
      <span class="fr-badge">${escHtml(r.badge)}</span>
    </div>`).join('');
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

  // Fallback keyword mapping — only used for items without an explicit foodGroup
  // (e.g. old manually-added items, or items predating this feature)
  const groupMapping = {
    maso:      ['maso', 'kuřec', 'vepřov', 'hovězí', 'sekaná', 'krůt', 'řízek', 'karbanátek'],
    ryby:      ['ryb', 'losos', 'treska', 'tuňák', 'pstruh', 'kapr'],
    mleko:     ['mléko', 'sýr', 'jogurt', 'tvaroh', 'máslo', 'smetana', 'kefír'],
    tuk:       ['olej', 'tuk', 'margarín'],
    cukr:      ['cukr', 'med', 'džem'],
    zelenina:  ['mrkev', 'brambor', 'rajče', 'paprika', 'okurka', 'špenát', 'hrách', 'kukuřice', 'kapusta', 'celer', 'jablk', 'banán', 'pomeranč', 'zelenina', 'ovoce'],
    brambory:  ['brambor'],
    celozrnne: ['celozrnný', 'celozrnné', 'špaldov', 'pohank', 'ječné', 'kroupy', 'bulgur', 'quinoa'],
    lustaniny: ['čočka', 'fazole', 'hrách', 'cizrna', 'tofu', 'luštěnin'],
  };

  let taggedCount = 0, guessedCount = 0;

  // Sum actual grams per food group
  const actualGrams = {};
  for (const item of recentItems) {
    let grp = item.foodGroup;
    if (grp) {
      taggedCount++;
    } else {
      // Fallback: guess from name
      const nameLower = item.name.toLowerCase();
      grp = Object.entries(groupMapping).find(([, kws]) => kws.some(kw => nameLower.includes(kw)))?.[0];
      if (grp) guessedCount++;
    }
    if (!grp) continue;
    const grams = item.grams || toGrams(item.qty, item.unit);
    const gramsPerDay = grams / workingDays / avgChildren;
    actualGrams[grp] = (actualGrams[grp] || 0) + gramsPerDay;
  }

  // Render compliance bars
  const rows = Object.entries(N.foodGroups).map(([key, group]) => {
    const actual = actualGrams[key] || 0;
    const result = N.checkCompliance(actual, key, ageKey);
    const barWidth = Math.min(150, result.pct);
    const minMark = 75;
    const maxMark = 125;

    return `
      <div class="comp-row">
        <div class="comp-row-header">
          <span class="norm-dot" style="background:${group.color}"></span>
          <span class="comp-label">${escHtml(group.label)}</span>
          <span class="comp-pct ${result.status}">${result.pct} %</span>
        </div>
        <div class="comp-bar-track">
          <div class="comp-bar-fill ${result.status}" style="width:${barWidth}%"></div>
          <div class="comp-bar-min" style="left:${minMark}%" title="Min 75%"></div>
          <div class="comp-bar-max" style="left:${maxMark}%" title="Max 125%"></div>
        </div>
        <div class="comp-detail">
          Cíl: ${result.target.toFixed(1)} g/den · Skutečnost: ${result.actual.toFixed(1)} g/den ·
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
  loadAttendance();

  // Set week picker to current week
  const picker = document.getElementById('attWeekPicker');
  if (picker) {
    picker.value = getISOWeekString();
    picker.addEventListener('change', renderAttendanceGrid);
  }

  const ageSelect = document.getElementById('attAgeGroup');
  if (ageSelect) ageSelect.addEventListener('change', renderAttendanceGrid);

  document.getElementById('btnSaveAttendance')?.addEventListener('click', async () => {
    // Read all inputs into state
    const week = getCurrentAttWeek();
    const rows = [];
    document.querySelectorAll('.att-meal-input').forEach(inp => {
      const day = parseInt(inp.dataset.day);
      const meal = inp.dataset.meal;
      const count = parseInt(inp.value) || 0;
      if (!attendanceData[week]) attendanceData[week] = {};
      if (!attendanceData[week][day]) attendanceData[week][day] = {};
      attendanceData[week][day][meal] = count;
      rows.push({
        org_id: window.SYNC?.ORG_ID,
        week_key: week,
        day_index: day,
        meal,
        age_group: document.getElementById('attAgeGroup')?.value || 'ms_3_6',
        child_count: count,
      });
    });
    saveAttendance();
    toast('Docházka uložena!', 'success');
    // DB sync — non-blocking, fires audit automatically in dbRoutes
    dbPut('/api/db/attendance/bulk', { rows });
  });

  document.getElementById('btnCopyPrevWeek')?.addEventListener('click', copyPrevWeek);
  document.getElementById('btnCalcIngredients')?.addEventListener('click', calcIngredients);

  renderAttendanceGrid();
}

function initNorms() {
  renderNormReference();
  renderFreqRules();
  document.getElementById('btnCheckCompliance')?.addEventListener('click', checkCompliance);
}
