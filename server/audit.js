/**
 * Sprint 4 — Audit log helper
 *
 * Used by dbRoutes.js after every significant state change.
 * Writes using the SERVICE ROLE client (bypasses RLS) so the
 * audit log is always written, even if the user's own RLS
 * policy would block access to the audit_log table.
 *
 * Usage:
 *   await audit(req, {
 *     action: 'ledger.in',
 *     entity: 'inventory_ledger',
 *     description: `Příjem na sklad: ${items.length} položek`,
 *     after_json: items,
 *   });
 *
 * Non-throwing: audit failures are logged to console but never
 * propagate to the caller — a failed audit write must never
 * cause a successful business operation to appear as an error.
 */
const { getSupabase } = require('./db/supabaseClient');

async function audit(req, {
  action,
  entity = null,
  entity_id = null,
  description = null,
  before_json = null,
  after_json = null,
}) {
  try {
    const supabase = getSupabase(); // service-role: bypasses RLS intentionally
    const profile = req.profile;    // attached by requireAuth middleware
    const org_id  = profile?.org_id;

    if (!org_id) return; // no org context, skip silently

    await supabase.from('audit_log').insert({
      org_id,
      user_id:     profile?.id   || null,
      user_name:   profile?.full_name || null,
      user_role:   profile?.role  || null,
      action,
      entity,
      entity_id:   entity_id ? String(entity_id) : null,
      description,
      before_json,
      after_json,
      ip_address:  req.ip || req.headers['x-forwarded-for'] || null,
    });
  } catch (err) {
    // Never throw — audit failure must not block business logic
    console.error('[audit] Failed to write audit log entry:', err.message);
  }
}

module.exports = { audit };
