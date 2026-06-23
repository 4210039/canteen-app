/* ═══════════════════════════════════════════════════════════
   sync.js — Supabase is the single source of truth.
   localStorage is not used.  This module exposes the ORG_ID
   constant and a refreshFromCloud() helper used by the
   Settings tab "Obnovit data" button.
═══════════════════════════════════════════════════════════ */

window.SYNC = (function () {
  const ORG_ID = '00000000-0000-0000-0000-000000000001'; // single pilot org

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

  // Re-fetch all data from Supabase into the in-memory STATE.
  // Called by the "Obnovit data" button in Settings.
  async function refreshFromCloud(onProgress) {
    const report = { ledger: 0, errors: [] };

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
      report.ledger = rows.length;
      onProgress?.(`✅ Sklad obnoven (${rows.length} záznamů)`);
    } catch (e) { report.errors.push('Sklad: ' + e.message); }

    return report;
  }

  return { refreshFromCloud, ORG_ID };
})();
