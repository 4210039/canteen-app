-- ═══════════════════════════════════════════════════════════
-- Migration 015: Recipe name aliases
-- Lets one recipe be recognised under more than one exact dish-name
-- string, without ever doing fuzzy/approximate matching in the actual
-- shopping calculation. Aliases are only ever added one at a time, by
-- explicit user action (accepting a similarity suggestion in the UI) —
-- never inferred automatically at calculation time.
-- ═══════════════════════════════════════════════════════════

alter table recipes add column if not exists aliases text[] not null default '{}';
