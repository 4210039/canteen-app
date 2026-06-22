/**
 * Sprint 2 — Auth middleware
 *
 * Verifies the Supabase JWT sent by the frontend (Authorization: Bearer <token>)
 * and attaches `req.user` (Supabase auth user) and `req.profile`
 * (org_id + role from user_profiles) to the request.
 *
 * Two middlewares are exported:
 *   requireAuth         — rejects the request if no valid token is present
 *   requireRole(...roles) — requireAuth + rejects if profile.role isn't in the list
 *
 * Design note: role enforcement ALSO happens at the database level via
 * RLS policies (003_auth_and_roles.sql). This middleware is a second,
 * earlier layer — it gives clean 401/403 responses with clear messages
 * instead of letting a request reach Postgres and fail there with a
 * less friendly RLS error. Defense in depth, not either/or.
 */
const { getSupabase, isDbConfigured } = require('./db/supabaseClient');

async function requireAuth(req, res, next) {
  if (!isDbConfigured()) {
    return res.status(503).json({ error: 'Database not configured.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Chybí přihlašovací token. Přihlaste se prosím znovu.' });
  }

  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Neplatný nebo expirovaný token. Přihlaste se prosím znovu.' });
  }

  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('id, org_id, role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return res.status(403).json({ error: 'Uživatelský profil nebyl nalezen. Kontaktujte administrátora.' });
  }

  req.user = user;
  req.profile = profile;
  next();
}

function requireRole(...allowedRoles) {
  return [
    requireAuth,
    (req, res, next) => {
      if (!allowedRoles.includes(req.profile.role)) {
        return res.status(403).json({
          error: `Tato akce vyžaduje roli: ${allowedRoles.join(' nebo ')}. Vaše role: ${req.profile.role}.`,
        });
      }
      next();
    },
  ];
}

module.exports = { requireAuth, requireRole };
