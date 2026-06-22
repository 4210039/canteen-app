-- ═══════════════════════════════════════════════════════════
-- Canteen Smart Manager — Database Schema
-- Sprint 1: Datový model a migrace na databázi
-- Target: Supabase (PostgreSQL)
-- ═══════════════════════════════════════════════════════════
--
-- Design notes:
-- - Every table has an `org_id` so this schema is multi-tenant-ready
--   from day one (Sprint 8 won't require a schema rewrite).
--   For Sprint 1 / single-canteen pilot, there will just be one org row.
-- - `created_by` / `updated_by` columns lay the groundwork for the
--   audit log in Sprint 4, without building the full audit system yet.
-- - All money values are stored in Kč as NUMERIC (not float) to avoid
--   rounding errors in financial reporting.
-- - Row Level Security (RLS) is enabled but with permissive policies
--   for Sprint 1 — real role-based policies arrive in Sprint 2 once
--   Supabase Auth is wired up.
-- ═══════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Organizations (schools/canteens) ───────────────────────
-- Multi-tenant root. For Sprint 1 pilot, one row: "MŠ Harmonie".
create table organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  menu_url    text,                          -- e.g. https://www.ms-harmonie.cz/jidelnicek/
  created_at  timestamptz not null default now()
);

-- ── Children (for future per-child tracking; Sprint 1 uses aggregate counts) ──
-- Not actively used by attendance yet (attendance is aggregate-count based,
-- matching the current app), but the table exists so Sprint 7+ (per-child
-- allergies, individual tracking) doesn't require new tables later.
create table children (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references organizations(id) on delete cascade,
  full_name   text not null,
  age_group   text not null default 'ms_3_6',  -- matches NORMS.ageGroups keys
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Attendance ──────────────────────────────────────────────
-- One row per (org, week, day, meal) with an aggregate child count.
-- Mirrors the current attendanceData[weekKey][dayIndex][mealKey] shape.
create table attendance (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  week_key      text not null,                 -- e.g. '2026-W25'
  day_index     smallint not null check (day_index between 0 and 4), -- 0=Mon .. 4=Fri
  meal          text not null check (meal in ('presnidavka','obed','svacina')),
  age_group     text not null default 'ms_3_6',
  child_count   integer not null default 0,
  updated_by    uuid,                          -- references auth.users(id) from Sprint 2
  updated_at    timestamptz not null default now(),
  unique (org_id, week_key, day_index, meal, age_group)
);

-- ── Menus ───────────────────────────────────────────────────
-- One row per fetched weekly menu (raw + AI-parsed structured days).
create table menus (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  week_key      text not null,
  fetched_at    timestamptz not null default now(),
  raw_text      text,                          -- scraped page text (for re-parsing/debug)
  days_json     jsonb not null default '[]',   -- [{name, date, meals:[{label,dish}]}]
  ingredients   jsonb not null default '[]',   -- string[] of dish names (current extraction)
  created_at    timestamptz not null default now(),
  unique (org_id, week_key)
);

-- ── Shopping lists ──────────────────────────────────────────
-- One row per shopping list draft (usually one per week, built from
-- the norms calculation). Items live in shopping_list_items.
create table shopping_lists (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  week_key      text not null,
  age_group     text not null default 'ms_3_6',
  status        text not null default 'draft' check (status in ('draft','confirmed')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz
);

create table shopping_list_items (
  id                uuid primary key default uuid_generate_v4(),
  shopping_list_id  uuid not null references shopping_lists(id) on delete cascade,
  food_group        text,                       -- key from NORMS.foodGroups, nullable for custom items
  name              text not null,
  qty               numeric not null default 0,
  unit              text not null default 'ks',
  needed_grams      integer,                    -- target from norms calc, null for custom items
  price             numeric not null default 0,
  store             text,                       -- store name or custom supplier name
  promo             boolean not null default false,
  source            text not null default 'norms' check (source in ('norms','custom')),
  skipped           boolean not null default false, -- unchecked in the shopping list UI
  created_at        timestamptz not null default now()
);

-- ── Inventory ledger (the warehouse) ───────────────────────
-- Core of Sprint-1-and-beyond accounting: every income ('in') and
-- outcome ('out') movement, mirroring the current STATE.ledger model 1:1.
create table inventory_ledger (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  type          text not null check (type in ('in','out')),
  name          text not null,
  food_group    text,                          -- key from NORMS.foodGroups, nullable
  qty           numeric not null default 0,
  unit          text not null default 'ks',
  grams         integer not null default 0,    -- normalized for norm math
  price         numeric not null default 0,    -- 0 for 'out' consumption entries
  store         text,                          -- supplier/store, or 'Spotřeba' for consumption
  promo         boolean not null default false,
  week_key      text not null,
  source        text not null default 'manual' check (source in ('shopping','manual','consumption')),
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- ── Norms configuration snapshot ───────────────────────────
-- The 9 food groups + coefficients are currently hardcoded in norms.js.
-- This table lets them be edited per-org without a code deploy, and
-- gives Sprint 6 (compliance reporting) a stable source to reference
-- even if the underlying regulation values change in a future year.
create table norms_config (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  food_group    text not null,                  -- e.g. 'maso', 'ryby', 'lustaniny'
  label         text not null,
  unit          text not null default 'g',
  adult_day_g   numeric not null,               -- grams/day at 100% (adult) portion
  tolerance_min numeric not null default 0.75,
  tolerance_max numeric not null default 1.25,
  color         text,
  updated_at    timestamptz not null default now(),
  unique (org_id, food_group)
);

-- ── Indexes for the access patterns the app actually uses ──
create index idx_attendance_org_week     on attendance(org_id, week_key);
create index idx_menus_org_week          on menus(org_id, week_key);
create index idx_shopping_lists_org_week on shopping_lists(org_id, week_key);
create index idx_ledger_org_week         on inventory_ledger(org_id, week_key);
create index idx_ledger_org_date         on inventory_ledger(org_id, created_at);
create index idx_ledger_food_group       on inventory_ledger(org_id, food_group);

-- ── updated_at auto-touch trigger (reused across tables) ────
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_attendance_touch
  before update on attendance
  for each row execute function touch_updated_at();

create trigger trg_norms_config_touch
  before update on norms_config
  for each row execute function touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────
-- Enabled now so Sprint 2 (auth + roles) only needs to write policies,
-- not retrofit RLS onto live tables.
alter table organizations         enable row level security;
alter table children               enable row level security;
alter table attendance             enable row level security;
alter table menus                  enable row level security;
alter table shopping_lists         enable row level security;
alter table shopping_list_items    enable row level security;
alter table inventory_ledger       enable row level security;
alter table norms_config           enable row level security;

-- Permissive Sprint-1 policies: any authenticated request can read/write.
-- These are intentionally wide open — Sprint 2 replaces them with
-- role-scoped policies (admin / vedouci / kucharka) once Supabase Auth
-- is wired up. Marking clearly so this isn't mistaken for the final state.
create policy "sprint1_allow_all_organizations"      on organizations      for all using (true) with check (true);
create policy "sprint1_allow_all_children"           on children           for all using (true) with check (true);
create policy "sprint1_allow_all_attendance"         on attendance         for all using (true) with check (true);
create policy "sprint1_allow_all_menus"              on menus              for all using (true) with check (true);
create policy "sprint1_allow_all_shopping_lists"     on shopping_lists     for all using (true) with check (true);
create policy "sprint1_allow_all_shopping_list_items" on shopping_list_items for all using (true) with check (true);
create policy "sprint1_allow_all_inventory_ledger"   on inventory_ledger   for all using (true) with check (true);
create policy "sprint1_allow_all_norms_config"       on norms_config       for all using (true) with check (true);
