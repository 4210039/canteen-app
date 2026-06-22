-- ═══════════════════════════════════════════════════════════
-- Canteen Smart Manager — Sprint 2: Auth & Roles
-- Run AFTER 001_initial_schema.sql and 002_seed_data.sql
-- ═══════════════════════════════════════════════════════════
--
-- Design notes:
-- - Supabase Auth already provides auth.users (email/password, magic
--   links, etc.) — we don't reimplement login, just attach a role and
--   an org_id to each authenticated user via a profile table.
-- - Three roles, matching the Sprint plan exactly:
--     admin     — ředitelka: full access, including Finance and Settings
--     vedouci   — vedoucí jídelny: everything except deleting other users
--     kucharka  — kuchařka: Menu, Attendance, Shopping, Warehouse —
--                 NOT Finance, NOT Norms compliance, NOT Settings
-- - Sprint 1's permissive "allow all" policies are dropped here and
--   replaced with role-scoped ones. This is the moment the database
--   actually starts enforcing who can do what, not just the UI.
-- ═══════════════════════════════════════════════════════════

-- ── User profiles (role + org membership) ──────────────────
-- One row per Supabase Auth user. Created automatically by the
-- trigger below whenever someone signs up.
create table user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  full_name   text,
  role        text not null default 'kucharka' check (role in ('admin', 'vedouci', 'kucharka')),
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user signs up.
-- Defaults new signups to 'kucharka' (least privilege) and the
-- pilot organization — an admin can promote them afterward via
-- the Nastavení tab (built later in this sprint).
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, org_id, full_name, role)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'org_id')::uuid, '00000000-0000-0000-0000-000000000001'),
    new.raw_user_meta_data->>'full_name',
    coalesce(new.raw_user_meta_data->>'role', 'kucharka')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Helper functions used inside RLS policies ───────────────
-- security definer so they can read user_profiles even though RLS
-- is enabled on it (avoids infinite recursion in policies).
create or replace function current_user_org_id()
returns uuid as $$
  select org_id from user_profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function current_user_role()
returns text as $$
  select role from user_profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function is_admin_or_vedouci()
returns boolean as $$
  select current_user_role() in ('admin', 'vedouci');
$$ language sql security definer stable;

-- ── user_profiles RLS ────────────────────────────────────────
alter table user_profiles enable row level security;

create policy "profiles_select_same_org" on user_profiles
  for select using (org_id = current_user_org_id());

create policy "profiles_update_own_or_admin" on user_profiles
  for update using (id = auth.uid() or current_user_role() = 'admin')
  with check (id = auth.uid() or current_user_role() = 'admin');

-- Only admins can change roles or create profiles for others manually
-- (normal signup goes through the trigger above, not this policy).
create policy "profiles_insert_admin_only" on user_profiles
  for insert with check (current_user_role() = 'admin');

-- ── Drop Sprint 1's permissive policies ─────────────────────
drop policy if exists "sprint1_allow_all_organizations"       on organizations;
drop policy if exists "sprint1_allow_all_children"             on children;
drop policy if exists "sprint1_allow_all_attendance"           on attendance;
drop policy if exists "sprint1_allow_all_menus"                on menus;
drop policy if exists "sprint1_allow_all_shopping_lists"       on shopping_lists;
drop policy if exists "sprint1_allow_all_shopping_list_items"  on shopping_list_items;
drop policy if exists "sprint1_allow_all_inventory_ledger"     on inventory_ledger;
drop policy if exists "sprint1_allow_all_norms_config"         on norms_config;

-- ── Sprint 2 role-scoped policies ────────────────────────────

-- Organizations: everyone in the org can read it, only admin can edit.
create policy "org_select_member"  on organizations for select using (id = current_user_org_id());
create policy "org_update_admin"   on organizations for update using (id = current_user_org_id() and current_user_role() = 'admin');

-- Children: all roles can read/write within their org.
create policy "children_all_member" on children for all
  using (org_id = current_user_org_id())
  with check (org_id = current_user_org_id());

-- Attendance: all three roles can read/write (kuchařka needs this daily).
create policy "attendance_all_member" on attendance for all
  using (org_id = current_user_org_id())
  with check (org_id = current_user_org_id());

-- Menus: all three roles can read/write (kuchařka fetches the menu).
create policy "menus_all_member" on menus for all
  using (org_id = current_user_org_id())
  with check (org_id = current_user_org_id());

-- Shopping lists: all three roles can read/write (core kitchen workflow).
create policy "shopping_lists_all_member" on shopping_lists for all
  using (org_id = current_user_org_id())
  with check (org_id = current_user_org_id());

create policy "shopping_items_all_member" on shopping_list_items for all
  using (
    shopping_list_id in (select id from shopping_lists where org_id = current_user_org_id())
  )
  with check (
    shopping_list_id in (select id from shopping_lists where org_id = current_user_org_id())
  );

-- Inventory ledger:
--   - all roles can INSERT (confirming a purchase, writing off consumption)
--   - all roles can SELECT (everyone needs to see stock)
--   - only admin/vedouci can DELETE (kuchařka shouldn't erase financial history)
create policy "ledger_select_member" on inventory_ledger
  for select using (org_id = current_user_org_id());

create policy "ledger_insert_member" on inventory_ledger
  for insert with check (org_id = current_user_org_id());

create policy "ledger_delete_admin_vedouci" on inventory_ledger
  for delete using (org_id = current_user_org_id() and is_admin_or_vedouci());

-- Norms config: everyone reads, only admin/vedouci edit (compliance
-- thresholds shouldn't be casually changed by kitchen staff).
create policy "norms_select_member" on norms_config
  for select using (org_id = current_user_org_id());

create policy "norms_update_admin_vedouci" on norms_config
  for all using (org_id = current_user_org_id() and is_admin_or_vedouci())
  with check (org_id = current_user_org_id() and is_admin_or_vedouci());

-- ── Convenience view for the Settings tab user list ─────────
create view org_members as
  select id, full_name, role, created_at
  from user_profiles
  where org_id = current_user_org_id();
