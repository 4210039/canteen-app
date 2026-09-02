-- Migration 016: Beverage dictionary
-- NOTE: If you get "already exists" errors, the table was created before.
-- In that case just run the CREATE INDEX lines only.

create table if not exists beverage_dictionary (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references organizations(id) on delete cascade,
  name           text not null,
  aliases        text[] not null default '{}',
  category       text not null default 'other',
  ml_per_serving numeric(8,1) not null default 200,
  counts_as_norm boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists beverage_dict_org_idx        on beverage_dictionary(org_id);
create index if not exists beverage_dict_name_lower_idx on beverage_dictionary(org_id, lower(name));

alter table beverage_dictionary enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='beverage_dictionary' and policyname='beverage_dict_select') then
    create policy "beverage_dict_select" on beverage_dictionary for select using (org_id = current_user_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='beverage_dictionary' and policyname='beverage_dict_insert') then
    create policy "beverage_dict_insert" on beverage_dictionary for insert with check (org_id = current_user_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='beverage_dictionary' and policyname='beverage_dict_update') then
    create policy "beverage_dict_update" on beverage_dictionary for update using (org_id = current_user_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='beverage_dictionary' and policyname='beverage_dict_delete') then
    create policy "beverage_dict_delete" on beverage_dictionary for delete using (org_id = current_user_org_id());
  end if;
end $$;
