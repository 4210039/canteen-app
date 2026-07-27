-- Migration 012: Per-org hidden subcategories
-- Allows orgs to hide global catalogue subcategories they don't use,
-- without modifying the global catalogue (org_id IS NULL rows).

create table if not exists hidden_subcategories (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references organizations(id) on delete cascade,
  food_group text not null,
  category_l2 text not null,
  created_at timestamptz not null default now(),
  unique (org_id, food_group, category_l2)
);

create index if not exists hidden_subcategories_org_idx on hidden_subcategories(org_id);

alter table hidden_subcategories enable row level security;

create policy "hidden_subcategories_select"
  on hidden_subcategories for select
  using (org_id = current_user_org_id());

create policy "hidden_subcategories_insert"
  on hidden_subcategories for insert
  with check (org_id = current_user_org_id());

create policy "hidden_subcategories_delete"
  on hidden_subcategories for delete
  using (org_id = current_user_org_id());
