-- ═══════════════════════════════════════════════════════════
-- Seed data for Sprint 1 pilot
-- Run after 001_initial_schema.sql
-- ═══════════════════════════════════════════════════════════

-- Pilot organization
insert into organizations (id, name, menu_url)
values (
  '00000000-0000-0000-0000-000000000001',
  'MŠ Harmonie',
  'https://www.ms-harmonie.cz/jidelnicek/'
);

-- Norms config — values transcribed from Vyhláška č. 107/2005 Sb.,
-- Tabulka 1 (spotřební koš), matching public/norms.js exactly so the
-- database and the existing frontend agree on every number.
insert into norms_config (org_id, food_group, label, unit, adult_day_g, tolerance_min, tolerance_max, color) values
('00000000-0000-0000-0000-000000000001', 'maso',      'Maso',                   'g', 75,  0.75, 1.25, '#E53935'),
('00000000-0000-0000-0000-000000000001', 'ryby',      'Ryby, korýši, měkkýši',  'g', 10,  0.75, 1.25, '#1E88E5'),
('00000000-0000-0000-0000-000000000001', 'mleko',     'Mléko a mléčné výrobky', 'g', 250, 0.75, 1.25, '#FDD835'),
('00000000-0000-0000-0000-000000000001', 'tuk',       'Tuk volný',              'g', 20,  0.75, 1.25, '#FB8C00'),
('00000000-0000-0000-0000-000000000001', 'cukr',      'Cukr volný',             'g', 20,  0.75, 1.25, '#8E24AA'),
('00000000-0000-0000-0000-000000000001', 'zelenina',  'Zelenina a ovoce',       'g', 250, 0.75, 1.25, '#43A047'),
('00000000-0000-0000-0000-000000000001', 'brambory',  'Brambory a hlízy',       'g', 150, 0.75, 1.25, '#6D4C41'),
('00000000-0000-0000-0000-000000000001', 'celozrnne', 'Celozrnné obiloviny',    'g', 20,  0.75, 1.25, '#00897B'),
('00000000-0000-0000-0000-000000000001', 'lustaniny', 'Luštěniny',              'g', 15,  0.75, 1.25, '#3949AB');
