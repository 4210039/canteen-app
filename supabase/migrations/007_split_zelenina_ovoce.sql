-- ═══════════════════════════════════════════════════════════
-- Canteen Smart Manager — Sprint 6: split Zelenina/Ovoce,
-- remove Celozrnné obiloviny
-- Run AFTER 006_tester_role.sql
-- ═══════════════════════════════════════════════════════════
--
-- Design notes:
-- - public/norms.js previously tracked "Zelenina a ovoce" as one combined
--   group at 250 g/adult/day. It's now two groups, 'zelenina' (125 g) and
--   'ovoce' (125 g) — matching the official Tabulka 1, which lists them
--   as separate columns. The 125/125 split keeps the same combined total;
--   adjust adult_day_g below per group if a different split fits this
--   jídelna's actual numbers better.
-- - 'celozrnne' (Celozrnné obiloviny) is removed entirely — it's no
--   longer tracked anywhere in the frontend (norms.js, app.js).
-- - food_group on inventory_ledger / shopping_list_items is a free-text
--   column (no foreign key, no check constraint), so existing rows
--   already tagged 'celozrnne' are left as-is — they're historical
--   purchase records, not configuration, and rewriting someone's past
--   ledger entries isn't this migration's job. They simply won't be
--   picked up by future compliance calculations, since the frontend no
--   longer iterates a 'celozrnne' entry in NORMS.foodGroups.
-- ═══════════════════════════════════════════════════════════

-- ── Split the combined zelenina-a-ovoce row into two ────────
-- Update the existing 'zelenina' row in place (was 250 g, "Zelenina a
-- ovoce") to become the 125 g "Zelenina"-only row...
update norms_config
set label = 'Zelenina', adult_day_g = 125
where food_group = 'zelenina';

-- ...then add the new 'ovoce' row for every org that already has a
-- 'zelenina' row, copying its tolerance settings (admins can tune the
-- two independently afterward via the norms-config API).
insert into norms_config (org_id, food_group, label, unit, adult_day_g, tolerance_min, tolerance_max, color)
select org_id, 'ovoce', 'Ovoce', unit, 125, tolerance_min, tolerance_max, '#C0CA33'
from norms_config
where food_group = 'zelenina'
  and not exists (
    select 1 from norms_config nc2
    where nc2.org_id = norms_config.org_id and nc2.food_group = 'ovoce'
  );

-- ── Remove Celozrnné obiloviny entirely ──────────────────────
delete from norms_config where food_group = 'celozrnne';
