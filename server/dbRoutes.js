/**
 * Sprint 1 API routes — database-backed persistence.
 *
 * These routes mirror the shape of the existing localStorage keys
 * (menu, attendance, ledger, shopping cart) so the frontend migration
 * in a later step can swap fetch('/api/db/...') in for
 * localStorage.getItem/setItem with minimal rewiring.
 *
 * Every route is scoped by org_id. For Sprint 1 (single pilot canteen)
 * the frontend will always pass the one seeded organization id, but
 * the routes are written multi-tenant-correct from day one.
 *
 * NOTE: No auth/role checks yet — that is Sprint 2. Right now any
 * client that can reach this server can read/write any org's data.
 * This is acceptable for a single-canteen local/pilot deployment but
 * must not be exposed publicly without Sprint 2 completed.
 */
const express = require('express');
const { getSupabase, isDbConfigured } = require('./db/supabaseClient');

const router = express.Router();

// Guard: if Supabase isn't configured, every DB route returns a clear
// error instead of crashing, so the app can still run in localStorage
// mode during the Sprint 1 transition period.
router.use((req, res, next) => {
  if (!isDbConfigured()) {
    return res.status(503).json({
      error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to enable cloud persistence.',
    });
  }
  next();
});

// ── Organizations ────────────────────────────────────────────
router.get('/organizations', async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('organizations').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Menus ─────────────────────────────────────────────────────
router.get('/menus/:orgId/:weekKey', async (req, res) => {
  const supabase = getSupabase();
  const { orgId, weekKey } = req.params;
  const { data, error } = await supabase
    .from('menus')
    .select('*')
    .eq('org_id', orgId)
    .eq('week_key', weekKey)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/menus', async (req, res) => {
  const supabase = getSupabase();
  const { org_id, week_key, raw_text, days_json, ingredients } = req.body;
  if (!org_id || !week_key) return res.status(400).json({ error: 'org_id and week_key are required' });

  const { data, error } = await supabase
    .from('menus')
    .upsert(
      { org_id, week_key, raw_text, days_json, ingredients, fetched_at: new Date().toISOString() },
      { onConflict: 'org_id,week_key' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Attendance ────────────────────────────────────────────────
router.get('/attendance/:orgId/:weekKey', async (req, res) => {
  const supabase = getSupabase();
  const { orgId, weekKey } = req.params;
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('org_id', orgId)
    .eq('week_key', weekKey);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Upsert a single (day, meal, age_group) attendance cell.
router.put('/attendance', async (req, res) => {
  const supabase = getSupabase();
  const { org_id, week_key, day_index, meal, age_group, child_count, updated_by } = req.body;
  if (!org_id || !week_key || day_index === undefined || !meal) {
    return res.status(400).json({ error: 'org_id, week_key, day_index, meal are required' });
  }

  const { data, error } = await supabase
    .from('attendance')
    .upsert(
      {
        org_id, week_key, day_index, meal,
        age_group: age_group || 'ms_3_6',
        child_count: child_count || 0,
        updated_by: updated_by || null,
      },
      { onConflict: 'org_id,week_key,day_index,meal,age_group' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Bulk upsert — used when saving a whole week's attendance grid at once.
router.put('/attendance/bulk', async (req, res) => {
  const supabase = getSupabase();
  const { rows } = req.body; // array of the same shape as the single PUT body
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'rows[] is required' });
  }

  const { data, error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'org_id,week_key,day_index,meal,age_group' })
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Shopping lists ────────────────────────────────────────────
router.post('/shopping-lists', async (req, res) => {
  const supabase = getSupabase();
  const { org_id, week_key, age_group, items, created_by } = req.body;
  if (!org_id || !week_key) return res.status(400).json({ error: 'org_id and week_key are required' });

  const { data: list, error: listErr } = await supabase
    .from('shopping_lists')
    .insert({ org_id, week_key, age_group: age_group || 'ms_3_6', created_by: created_by || null })
    .select()
    .single();
  if (listErr) return res.status(500).json({ error: listErr.message });

  if (Array.isArray(items) && items.length) {
    const rows = items.map(i => ({ ...i, shopping_list_id: list.id }));
    const { error: itemsErr } = await supabase.from('shopping_list_items').insert(rows);
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });
  }

  res.json(list);
});

router.get('/shopping-lists/:id/items', async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shopping_list_items')
    .select('*')
    .eq('shopping_list_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Confirm a shopping list → also the trigger point for writing ledger
// 'in' entries (Sprint 1 keeps this as two calls from the frontend:
// PATCH this list to confirmed, then POST to /ledger/bulk-in; kept
// separate rather than implicit so the audit trail in Sprint 4 has a
// clean, explicit "confirm" event to hook into).
router.patch('/shopping-lists/:id/confirm', async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shopping_lists')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Inventory ledger (the warehouse) ────────────────────────
router.get('/ledger/:orgId', async (req, res) => {
  const supabase = getSupabase();
  const { orgId } = req.params;
  const { since } = req.query; // optional ISO date filter, e.g. for "last 30 days"

  let query = supabase.from('inventory_ledger').select('*').eq('org_id', orgId);
  if (since) query = query.gte('created_at', since);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Bulk insert income ('in') entries — called after a shopping list is confirmed.
router.post('/ledger/bulk-in', async (req, res) => {
  const supabase = getSupabase();
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'entries[] is required' });
  }
  const rows = entries.map(e => ({ ...e, type: 'in' }));
  const { data, error } = await supabase.from('inventory_ledger').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Bulk insert outcome ('out') entries — called by "Odepsat spotřebu týdne".
router.post('/ledger/bulk-out', async (req, res) => {
  const supabase = getSupabase();
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'entries[] is required' });
  }
  const rows = entries.map(e => ({ ...e, type: 'out' }));
  const { data, error } = await supabase.from('inventory_ledger').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/ledger/:id', async (req, res) => {
  const supabase = getSupabase();
  const { error } = await supabase.from('inventory_ledger').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

// ── Norms config ──────────────────────────────────────────────
router.get('/norms-config/:orgId', async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('norms_config')
    .select('*')
    .eq('org_id', req.params.orgId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
