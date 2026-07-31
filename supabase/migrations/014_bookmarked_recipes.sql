-- ═══════════════════════════════════════════════════════════
-- Migration 014: Bookmarked recipe links
-- Fast, reliable import of a browser bookmarks export (title +
-- URL + folder only — no ingredients yet). Searchable immediately.
-- Each link can later be "upgraded" to a full recipe on demand by
-- fetching the page and extracting ingredients — see recipe_id.
-- ═══════════════════════════════════════════════════════════

create table if not exists bookmarked_recipes (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references organizations(id) on delete cascade,
  title        text not null,
  url          text not null,
  folder_name  text,               -- from the bookmark file's folder structure, nullable
  recipe_id    uuid references recipes(id) on delete set null,
                                    -- null = still just a link; set once ingredients are extracted
  created_at   timestamptz not null default now(),
  created_by   uuid
);

create index if not exists bookmarked_recipes_org_idx on bookmarked_recipes(org_id);
create index if not exists bookmarked_recipes_recipe_idx on bookmarked_recipes(recipe_id);

alter table bookmarked_recipes enable row level security;

create policy "bookmarked_recipes_select" on bookmarked_recipes for select
  using (org_id = current_user_org_id());
create policy "bookmarked_recipes_insert" on bookmarked_recipes for insert
  with check (org_id = current_user_org_id());
create policy "bookmarked_recipes_update" on bookmarked_recipes for update
  using (org_id = current_user_org_id());
create policy "bookmarked_recipes_delete" on bookmarked_recipes for delete
  using (org_id = current_user_org_id());
