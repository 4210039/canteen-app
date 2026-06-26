-- ═══════════════════════════════════════════════════════════
-- Canteen Smart Manager — Sprint 5: "tester" role
-- Run AFTER 004_audit_log.sql (and 005, if applied)
-- ═══════════════════════════════════════════════════════════
--
-- Design notes:
-- - 'tester' is a new role for people who should see/use every working
--   tab (menu, attendance, offers, warehouse, finance, norms) with the
--   same DB-level write access as 'vedouci', but must NOT see the Audit
--   log or Settings tabs. Audit/Settings hiding is enforced in the
--   frontend (auth.js TAB_PERMISSIONS) — there's no DB policy to change
--   for "hide a tab", since:
--     * audit_log only allows SELECT for org members anyway (any role);
--       there's no separate per-role audit policy to restrict.
--     * Settings' only privileged action (changing someone's role) is
--       already gated to 'admin' specifically (profiles_insert_admin_only /
--       admin-only role-change UI in app.js) — 'tester' doesn't gain that
--       just by being added to the role list below.
-- - So the only DB change actually needed is: (1) allow 'tester' as a
--   valid role value, and (2) include it wherever 'vedouci' currently
--   gets elevated write access (is_admin_or_vedouci()).
-- ═══════════════════════════════════════════════════════════

-- ── Allow 'tester' as a role value ──────────────────────────
alter table user_profiles drop constraint if exists user_profiles_role_check;
alter table user_profiles add constraint user_profiles_role_check
  check (role in ('admin', 'vedouci', 'kucharka', 'tester'));

-- ── Give 'tester' the same elevated DB access as 'vedouci' ──
-- (ledger delete, norms editing — full working access, just not the
-- audit/settings tabs, which are hidden client-side).
create or replace function is_admin_or_vedouci()
returns boolean as $$
  select current_user_role() in ('admin', 'vedouci', 'tester');
$$ language sql security definer stable;

-- ── Set Marian's role ────────────────────────────────────────
-- Run this AFTER creating the actual login (Dashboard → Authentication →
-- Users → Add user, email marian.filus@seznam.cz, password Jidelna2026!,
-- "Auto Confirm User" ON). The trigger on auth.users creates his
-- user_profiles row automatically with the default role 'kucharka' —
-- this just promotes it to 'tester' and sets his display name.
update user_profiles
set role = 'tester',
    full_name = 'Marian Filus'
where id = (select id from auth.users where email = 'marian.filus@seznam.cz');
