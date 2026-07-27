-- Migration 011: Split "Hovězí a telecí maso" into two subcategories
-- Only affects global catalogue rows (org_id IS NULL)

-- Step 1: Telecí products (name contains 'Telecí' or 'telecí')
update products
  set category_l2 = 'Telecí maso'
where org_id is null
  and category_l2 = 'Hovězí a telecí maso'
  and (name ilike '%Telecí%' or name ilike '%telecí%' or name ilike '%teleci%');

-- Step 2: All remaining "Hovězí a telecí maso" → Hovězí maso
update products
  set category_l2 = 'Hovězí maso'
where org_id is null
  and category_l2 = 'Hovězí a telecí maso';
