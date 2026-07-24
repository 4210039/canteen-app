-- Migration 011: Split "Hovězí a telecí maso" into two subcategories
-- Updates all global catalogue rows so the combobox shows them separately.

update products
  set category_l2 = 'Hovězí maso'
where category_l2 = 'Hovězí a telecí maso'
  and org_id is null
  and name ilike '%hov%'
  and name not ilike '%telec%';

update products
  set category_l2 = 'Telecí maso'
where category_l2 = 'Hovězí a telecí maso'
  and org_id is null
  and name ilike '%telec%';

-- Anything left (mixed or unclassifiable) goes to Hovězí maso as default
update products
  set category_l2 = 'Hovězí maso'
where category_l2 = 'Hovězí a telecí maso'
  and org_id is null;
