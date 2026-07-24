-- ═══════════════════════════════════════════════════════════
-- Migration 010: Custom Products (Vlastní produkty)
-- Stores user-defined products that persist across sessions
-- and appear as quick-add suggestions in the Nákup section.
-- ═══════════════════════════════════════════════════════════

create table if not exists custom_products (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  food_group  text,
  qty         numeric(10,3) not null default 1,
  unit        text not null default 'ks',
  price       numeric(10,2) not null default 0,
  supplier    text,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create index if not exists custom_products_org_idx on custom_products(org_id);

alter table custom_products enable row level security;

create policy "custom_products_select"
  on custom_products for select
  using (org_id = current_user_org_id());

create policy "custom_products_insert"
  on custom_products for insert
  with check (org_id = current_user_org_id());

create policy "custom_products_delete"
  on custom_products for delete
  using (org_id = current_user_org_id());
