-- ═══════════════════════════════════════════════════════════
-- Fix: migration 008 targeted a non-existent table 'ledger_entries'
-- (typo for 'inventory_ledger'), so its retag of legacy 'zelenina',
-- 'ovoce', and 'mleko' food_group tags never actually applied.
-- Those rows have been silently excluded from all compliance
-- calculations ever since (NORMS.foodGroups in norms.js only
-- recognizes 'zeleninaOvoce' and 'mlecneVyrobky').
--
-- Safe to run multiple times — each UPDATE is a no-op once applied.
-- ═══════════════════════════════════════════════════════════

UPDATE inventory_ledger SET food_group = 'zeleninaOvoce' WHERE food_group IN ('zelenina', 'ovoce');
UPDATE inventory_ledger SET food_group = 'mlecneVyrobky' WHERE food_group = 'mleko';
