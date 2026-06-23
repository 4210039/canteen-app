/**
 * Sprint 2 — Database-backed persistence + role-aware access.
 *
 * Every route now requires a valid Supabase session (requireAuth) and
 * sensitive routes additionally require specific roles (requireRole).
 *
 * IMPORTANT ARCHITECTURE NOTE: routes use a per-request Supabase client
 * authenticated AS THE CALLING USER (via their JWT), not the service-role
 * client. This means the RLS policies from 003_auth_and_roles.sql are
 * actually enforced by Postgres on every query — the service-role key
 * (which bypasses RLS entirely) is now used ONLY for the auth check
 * itself in authMiddleware.js, never for data access. This is what
 * makes "defense in depth" real rather than aspirational: even if a
 * route here had a bug and forgot to filter by org_id, RLS would still
 * block cross-org access at the database layer.
 */
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { isDbConfigured } = require('./db/supabaseClient');
const { requireAuth, requireRole } = require('./authMiddleware');
const { audit } = require('./audit');

const router = express.Router();

// Builds a Supabase client scoped to the calling user's JWT, so every
// query through it is subject to that user's RLS policies — not the
// unrestricted service-role policy used by authMiddleware's token check.
function userScopedClient(req) {
  const token = req.headers.authorization.slice(7); // "Bearer <token>" already validated by requireAuth
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

// Guard: if Supabase isn't configured, every DB route returns a clear
// error instead of crashing, so the app can still run in localStorage
// mode during the Sprint 1→2 transition period.
router.use((req, res, next) => {
  if (!isDbConfigured()) {
    return res.status(503).json({
      error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to enable cloud persistence.',
    });
  }
  next();
});

// All routes below this line require a logged-in user.
router.use(requireAuth);

// ── Current user info (frontend uses this right after login) ──
router.get('/me', (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email }, profile: req.profile });
});

// ── Organizations ────────────────────────────────────────────
router.get('/organizations', async (req, res) => {
  const supabase = userScopedClient(req);
  const { data, error } = await supabase.from('organizations').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Menus ─────────────────────────────────────────────────────
router.get('/menus/:orgId/:weekKey', async (req, res) => {
  const supabase = userScopedClient(req);
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
  const supabase = userScopedClient(req);
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
  await audit(req, {
    action: 'menu.fetch',
    entity: 'menus',
    entity_id: data.id,
    description: `Jídelníček načten pro týden ${week_key}`,
    after_json: { week_key, days_count: (days_json || []).length },
  });
  res.json(data);
});

// ── Attendance ────────────────────────────────────────────────
router.get('/attendance/:orgId/:weekKey', async (req, res) => {
  const supabase = userScopedClient(req);
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
  const supabase = userScopedClient(req);
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
  const supabase = userScopedClient(req);
  const { rows } = req.body; // array of the same shape as the single PUT body
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'rows[] is required' });
  }

  const { data, error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'org_id,week_key,day_index,meal,age_group' })
    .select();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req, {
    action: 'attendance.save',
    entity: 'attendance',
    description: `Docházka uložena: ${rows.length} buněk`,
    after_json: { count: rows.length },
  });
  res.json(data);
});

// ── Shopping lists ────────────────────────────────────────────
router.post('/shopping-lists', async (req, res) => {
  const supabase = userScopedClient(req);
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
  const supabase = userScopedClient(req);
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
  const supabase = userScopedClient(req);
  const { data, error } = await supabase
    .from('shopping_lists')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req, {
    action: 'shopping.confirm',
    entity: 'shopping_lists',
    entity_id: req.params.id,
    description: `Nákupní seznam potvrzen (týden ${data.week_key})`,
    after_json: { week_key: data.week_key, status: 'confirmed' },
  });
  res.json(data);
});

// ── Inventory ledger (the warehouse) ────────────────────────
router.get('/ledger/:orgId', async (req, res) => {
  const supabase = userScopedClient(req);
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
  const supabase = userScopedClient(req);
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'entries[] is required' });
  }
  const rows = entries.map(e => ({ ...e, type: 'in' }));
  const { data, error } = await supabase.from('inventory_ledger').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  const totalPrice = rows.reduce((s, r) => s + (r.price || 0), 0);
  await audit(req, {
    action: 'ledger.in',
    entity: 'inventory_ledger',
    description: `Příjem na sklad: ${rows.length} položek, celkem ${totalPrice} Kč`,
    after_json: { count: rows.length, total_price: totalPrice, week_key: rows[0]?.week_key },
  });
  res.json(data);
});

// Bulk insert outcome ('out') entries — called by "Odepsat spotřebu týdne".
router.post('/ledger/bulk-out', async (req, res) => {
  const supabase = userScopedClient(req);
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'entries[] is required' });
  }
  const rows = entries.map(e => ({ ...e, type: 'out' }));
  const { data, error } = await supabase.from('inventory_ledger').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req, {
    action: 'ledger.out',
    entity: 'inventory_ledger',
    description: `Spotřeba odepsána ze skladu: ${rows.length} skupin potravin, týden ${rows[0]?.week_key}`,
    after_json: { count: rows.length, week_key: rows[0]?.week_key },
  });
  res.json(data);
});

router.delete('/ledger/:id', requireRole('admin', 'vedouci'), async (req, res) => {
  const { id } = req.params;
  // Reject non-UUID IDs early — local-only (unsynced) items have timestamp IDs,
  // not UUIDs, and passing them to Postgres causes a cast error.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ deleted: false, reason: 'not_in_db' });
  }
  const supabase = userScopedClient(req);
  // Fetch before deleting so we can record what was removed
  const { data: before } = await supabase
    .from('inventory_ledger').select('*').eq('id', id).maybeSingle();
  const { error } = await supabase.from('inventory_ledger').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  await audit(req, {
    action: 'ledger.delete',
    entity: 'inventory_ledger',
    entity_id: id,
    description: `Záznam skladu smazán: ${before?.name || id}`,
    before_json: before || null,
  });
  res.json({ deleted: true });
});

// ── Norms config ──────────────────────────────────────────────
router.get('/norms-config/:orgId', async (req, res) => {
  const supabase = userScopedClient(req);
  const { data, error } = await supabase
    .from('norms_config')
    .select('*')
    .eq('org_id', req.params.orgId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Only admin/vedouci may edit compliance thresholds — kitchen staff
// shouldn't be able to loosen the norms they're being measured against.
router.put('/norms-config/:foodGroup', requireRole('admin', 'vedouci'), async (req, res) => {
  const supabase = userScopedClient(req);
  const { org_id, adult_day_g, tolerance_min, tolerance_max } = req.body;
  const { data, error } = await supabase
    .from('norms_config')
    .update({ adult_day_g, tolerance_min, tolerance_max })
    .eq('org_id', org_id)
    .eq('food_group', req.params.foodGroup)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Org members (Settings tab — role management) ───────────
router.get('/members', async (req, res) => {
  const supabase = userScopedClient(req);
  const { data, error } = await supabase.from('org_members').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Only admin can change another user's role.
router.patch('/members/:userId/role', requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'vedouci', 'kucharka'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, vedouci, or kucharka' });
  }
  const supabase = userScopedClient(req);
  const { data: before } = await supabase
    .from('user_profiles').select('role, full_name').eq('id', req.params.userId).maybeSingle();
  const { data, error } = await supabase
    .from('user_profiles')
    .update({ role })
    .eq('id', req.params.userId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req, {
    action: 'role.change',
    entity: 'user_profiles',
    entity_id: req.params.userId,
    description: `Role změněna pro ${before?.full_name || req.params.userId}: ${before?.role} → ${role}`,
    before_json: { role: before?.role },
    after_json: { role },
  });
  res.json(data);
});

// ── Audit log (read-only for frontend) ───────────────────────
// Sorted newest-first, paginated (default 100 rows).
router.get('/audit', async (req, res) => {
  const supabase = userScopedClient(req);
  const { limit = 100, offset = 0, action } = req.query;

  let query = supabase
    .from('audit_log')
    .select('*')
    .eq('org_id', req.profile.org_id)
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (action) query = query.eq('action', action);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Login event — called by the frontend right after successful auth.signIn()
// so we have a record of who logged in from where and when.
router.post('/audit/login', async (req, res) => {
  await audit(req, {
    action: 'auth.login',
    entity: 'auth',
    description: `Přihlášení: ${req.profile.full_name || req.user.email}`,
  });
  res.json({ ok: true });
});

module.exports = router;
