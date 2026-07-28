-- ═══════════════════════════════════════════════════════════
-- Migration 013: Recipes & recipe ingredients
-- Lets staff define what a menu dish actually contains once,
-- so Nákup can suggest subcategory quantities automatically
-- instead of the dish description staying opaque free text.
-- ═══════════════════════════════════════════════════════════

create table if not exists recipes (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references organizations(id) on delete cascade,
  dish_name   text not null,       -- matched against menu dish text, case-insensitive exact match
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create index if not exists recipes_org_idx on recipes(org_id);
-- Speeds up case-insensitive exact-match lookup at Nákup calc time
create index if not exists recipes_org_dishname_lower_idx on recipes(org_id, lower(dish_name));

create table if not exists recipe_ingredients (
  id               uuid primary key default uuid_generate_v4(),
  recipe_id        uuid not null references recipes(id) on delete cascade,
  name             text not null,       -- human-readable, e.g. 'mrkev', 'kuřecí prsa'
  food_group       text,                -- key from NORMS.foodGroups, nullable
  category_l2      text,                -- must match an existing products.category_l2 for that
                                         -- food_group, so Nákup prefill can find the right row
  qty_per_portion  numeric(10,3) not null default 0,  -- amount for ONE child portion
  unit             text not null default 'g',
  sort_order       int not null default 0
);

create index if not exists recipe_ingredients_recipe_idx on recipe_ingredients(recipe_id);

alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;

create policy "recipes_select" on recipes for select
  using (org_id = current_user_org_id());
create policy "recipes_insert" on recipes for insert
  with check (org_id = current_user_org_id());
create policy "recipes_update" on recipes for update
  using (org_id = current_user_org_id());
create policy "recipes_delete" on recipes for delete
  using (org_id = current_user_org_id());

-- recipe_ingredients has no org_id of its own — access is via its parent recipe
create policy "recipe_ingredients_select" on recipe_ingredients for select
  using (recipe_id in (select id from recipes where org_id = current_user_org_id()));
create policy "recipe_ingredients_insert" on recipe_ingredients for insert
  with check (recipe_id in (select id from recipes where org_id = current_user_org_id()));
create policy "recipe_ingredients_update" on recipe_ingredients for update
  using (recipe_id in (select id from recipes where org_id = current_user_org_id()));
create policy "recipe_ingredients_delete" on recipe_ingredients for delete
  using (recipe_id in (select id from recipes where org_id = current_user_org_id()));
