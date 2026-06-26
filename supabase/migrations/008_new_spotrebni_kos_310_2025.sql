-- Migration 008: Update food groups to match Vyhláška č. 310/2025 Sb.
-- Nový spotřební koš mandatory from 1. 9. 2026.
--
-- Changes:
--   1. Merge 'zelenina' + 'ovoce' → 'zeleninaOvoce'
--   2. Merge 'mleko' into 'mlecneVyrobky' (renamed key)
--   3. Add new group 'celozrnne'
--   4. Fix tolerances: tuk max→1.00, cukr min→0.00/max→1.00, ryby max→NULL, zeleninaOvoce max→NULL
--   5. Remove old adultDay column (values now in separate meal_values table)

-- ── 1. Rename mleko → mlecneVyrobky ───────────────────────────────────────
UPDATE norms_config
SET food_group = 'mlecneVyrobky',
    label      = 'Mléčné výrobky, mléko',
    adult_day  = NULL  -- adultDay no longer used, values in meal_values
WHERE food_group = 'mleko';

-- ── 2. Merge zelenina + ovoce → zeleninaOvoce ─────────────────────────────
-- Retag all ledger entries tagged 'zelenina' or 'ovoce'
UPDATE ledger_entries SET food_group = 'zeleninaOvoce' WHERE food_group IN ('zelenina','ovoce');

-- Update norms_config: rename zelenina row, remove ovoce row
UPDATE norms_config
SET food_group    = 'zeleninaOvoce',
    label         = 'Zelenina, ovoce',
    tolerance_max = NULL  -- no upper limit per new regulation
WHERE food_group = 'zelenina';

DELETE FROM norms_config WHERE food_group = 'ovoce';

-- ── 3. Add celozrnne group ────────────────────────────────────────────────
INSERT INTO norms_config (org_id, food_group, label, unit, adult_day, tolerance_min, tolerance_max, color)
SELECT org_id, 'celozrnne', 'Celozrnné obiloviny a pseudoobiloviny', 'g', NULL, 0.75, NULL, '#78909C'
FROM norms_config
WHERE food_group = 'maso'
ON CONFLICT (org_id, food_group) DO NOTHING;

-- ── 4. Fix tolerances per 310/2025 ───────────────────────────────────────
-- Tuky volné: max 100% (was 125%)
UPDATE norms_config SET tolerance_max = 1.00 WHERE food_group = 'tuk';
-- Cukry volné: min 0%, max 100%
UPDATE norms_config SET tolerance_min = 0.00, tolerance_max = 1.00 WHERE food_group = 'cukr';
-- Ryby: no upper limit
UPDATE norms_config SET tolerance_max = NULL WHERE food_group = 'ryby';
-- Luštěniny: no upper limit
UPDATE norms_config SET tolerance_max = NULL WHERE food_group = 'lustaniny';
-- Brambory: keep 75-125%
-- Maso: keep 75-125%
-- Mléčné výrobky: keep 75-125%

-- ── 5. Retag old mleko ledger entries ─────────────────────────────────────
UPDATE ledger_entries SET food_group = 'mlecneVyrobky' WHERE food_group = 'mleko';
