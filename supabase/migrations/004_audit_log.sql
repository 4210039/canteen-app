-- ═══════════════════════════════════════════════════════════
-- Canteen Smart Manager — Sprint 4: Audit Log
-- Run AFTER 003_auth_and_roles.sql
-- ═══════════════════════════════════════════════════════════
--
-- Design notes:
-- - The audit log is APPEND-ONLY: no UPDATE or DELETE policies.
--   Once a record is written, it cannot be modified — not even by admin.
--   This is what makes it legally credible for school inspections.
-- - Records are written by the Express backend using the SERVICE ROLE
--   key (bypassing RLS for writes), because the audit log must be
--   written even if the user's RLS policy would normally deny access
--   to audit_log (defense in depth: the log captures even failed attempts
--   at the route level, before they reach the DB).
-- - All org members can READ their org's audit log (transparency).
--   Only the backend can WRITE to it (integrity).
-- ═══════════════════════════════════════════════════════════

create table audit_log (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid,                    -- null for system actions
  user_name    text,                    -- denormalized: snapshot of name at time of action
  user_role    text,                    -- denormalized: snapshot of role at time of action
  action       text not null,          -- e.g. 'ledger.in', 'attendance.save', 'role.change'
  entity       text,                   -- table/domain affected: 'inventory_ledger', 'attendance', etc.
  entity_id    text,                   -- id of the affected record (if applicable)
  description  text,                   -- human-readable Czech description of what happened
  before_json  jsonb,                  -- state before the change (null for creates)
  after_json   jsonb,                  -- state after the change (null for deletes)
  ip_address   text,                   -- client IP (best-effort, may be proxy)
  created_at   timestamptz not null default now()
);

-- Index for the primary access pattern: "show me recent events for my org"
create index idx_audit_org_date    on audit_log(org_id, created_at desc);
create index idx_audit_user        on audit_log(org_id, user_id);
create index idx_audit_action      on audit_log(org_id, action);

-- ── RLS ──────────────────────────────────────────────────────
alter table audit_log enable row level security;

-- All org members can read their org's audit log.
create policy "audit_select_member" on audit_log
  for select using (org_id = current_user_org_id());

-- NO insert/update/delete policies for regular users.
-- The backend writes via service_role key which bypasses RLS.
-- This means only the server can create audit records —
-- users cannot forge, edit, or delete audit entries.
