/* ═══════════════════════════════════════════════════════════
   Sprint 2 — sync.js
   Bridges the existing localStorage-based STATE with the database.

   DESIGN DECISION: rather than rewriting every read/write call site
   in app.js to be async and DB-aware (high risk of breaking the
   working ledger/attendance/menu logic build in Sprints 1 alone),
   Sprint 2 introduces an explicit, visible sync action:

     localStorage (STATE) <──sync──> Supabase (org's cloud data)

   This is the same pattern real offline-first apps use (e.g. "Sync
   now" buttons), and it's the right level of risk for this sprint:
   auth + roles work fully live against the DB (gating, RLS), while
   the DATA sync is an explicit, auditable action the user triggers
   — visible in the UI, not a silent background rewrite of business
   logic that's already been tested and works.

   A fully automatic per-action DB write (no sync button) is the
   natural next increment once this bridge is proven reliable.
═══════════════════════════════════════════════════════════ */

window.SYNC = (function () {
  const ORG_ID = '00000000-0000-0000-0000-000000000001'; // single pilot org for now

  function authedFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...window.AUTH.getAuthHeader(),
        ...(options.headers || {}),
      },
    });
  }

  // ── PUSH: localStorage → database ──────────────────────────
  async function pushToCloud(onProgress) {
    const report = { menu: false, attendance: 0, ledger: 0, errors: [] };

    // Menu
    try {
      if (STATE.currentMenu && STATE.currentMenu.fetchedAt) {
        const weekKey = getWeekKey(new Date(STATE.currentMenu.fetchedAt));
        const res = await authedFetch('/api/db/menus', {
          method: 'POST',
          body: JSON.stringify({
            org_id: ORG_ID, week_key: weekKey,
            raw_text: STATE.currentMenu.raw,
            days_json: STATE.currentMenu.days,
            ingredients: STATE.ingredients,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        report.menu = true;
        onProgress?.('Jídelníček nahrán…');
      }
    } catch (e) { report.errors.push('Menu: ' + e.message); }

    // Attendance
    try {
      const attendanceData = load('attendance', {});
      const rows = [];
      for (const [weekKey, weekData] of Object.entries(attendanceData)) {
        for (const [dayIndex, dayData] of Object.entries(weekData)) {
          for (const meal of ['presnidavka', 'obed', 'svacina']) {
            if (dayData[meal] !== undefined) {
              rows.push({
                org_id: ORG_ID, week_key: weekKey, day_index: parseInt(dayIndex),
                meal, age_group: 'ms_3_6', child_count: parseInt(dayData[meal]) || 0,
              });
            }
          }
        }
      }
      if (rows.length) {
        const res = await authedFetch('/api/db/attendance/bulk', {
          method: 'PUT', body: JSON.stringify({ rows }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        report.attendance = rows.length;
        onProgress?.(`Docházka nahrána (${rows.length} buněk)…`);
      }
    } catch (e) { report.errors.push('Docházka: ' + e.message); }

    // Ledger — only push entries not already marked as synced, to avoid
    // re-inserting duplicates on repeated syncs.
    try {
      const unsyncedIn  = STATE.ledger.filter(e => e.type === 'in'  && !e._synced);
      const unsyncedOut = STATE.ledger.filter(e => e.type === 'out' && !e._synced);

      const toDbRow = (e) => ({
        org_id: ORG_ID, name: e.name, food_group: e.foodGroup,
        qty: e.qty, unit: e.unit, grams: e.grams, price: e.price || 0,
        store: e.store, promo: !!e.promo, week_key: e.weekKey, source: e.source,
      });

      if (unsyncedIn.length) {
        const res = await authedFetch('/api/db/ledger/bulk-in', {
          method: 'POST', body: JSON.stringify({ entries: unsyncedIn.map(toDbRow) }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        unsyncedIn.forEach(e => e._synced = true);
        report.ledger += unsyncedIn.length;
      }
      if (unsyncedOut.length) {
        const res = await authedFetch('/api/db/ledger/bulk-out', {
          method: 'POST', body: JSON.stringify({ entries: unsyncedOut.map(toDbRow) }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        unsyncedOut.forEach(e => e._synced = true);
        report.ledger += unsyncedOut.length;
      }
      if (report.ledger) {
        saveLedger(); // persist the _synced flags locally
        onProgress?.(`Sklad nahrán (${report.ledger} záznamů)…`);
      }
    } catch (e) { report.errors.push('Sklad: ' + e.message); }

    return report;
  }

  // ── PULL: database → localStorage (for a fresh device/browser) ──
  async function pullFromCloud(onProgress) {
    const report = { menu: false, attendance: 0, ledger: 0, errors: [] };

    try {
      const res = await authedFetch(`/api/db/ledger/${ORG_ID}`);
      if (!res.ok) throw new Error((await res.json()).error);
      const rows = await res.json();
      STATE.ledger = rows.map(r => ({
        id: r.id, type: r.type, name: r.name, foodGroup: r.food_group,
        qty: r.qty, unit: r.unit, grams: r.grams, price: r.price,
        store: r.store, promo: r.promo, date: r.created_at, weekKey: r.week_key,
        source: r.source, _synced: true,
      }));
      saveLedger();
      report.ledger = rows.length;
      onProgress?.(`Sklad stažen (${rows.length} záznamů)…`);
    } catch (e) { report.errors.push('Sklad: ' + e.message); }

    return report;
  }

  return { pushToCloud, pullFromCloud, ORG_ID };
})();
