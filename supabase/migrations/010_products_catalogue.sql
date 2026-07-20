-- ── Migration 010: Products catalogue (skladové karty) ────────────────────
-- Adds a products table with global built-in products (org_id IS NULL)
-- and support for org-specific custom products (org_id = their uuid).
-- inventory_ledger gets a nullable product_id FK — old entries unaffected.

-- ── Products table ────────────────────────────────────────────────────────
create table if not exists products (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organizations(id) on delete cascade,
  -- NULL = global built-in visible to all orgs
  -- non-null = org-specific custom product

  name          text not null,           -- "Tesco Kuřecí prsní řízky chlazené"
  brand         text,                    -- "Tesco"
  category_l1   text not null,           -- "Maso, drůbež a ryby"
  category_l2   text not null,           -- "Drůbež"
  food_group    text not null,           -- norm key: maso/ryby/mlecneVyrobky/tuk/cukr/zeleninaOvoce/brambory/celozrnne/lusteniny/none
  default_unit  text not null default 'kg',
  default_store text,
  active        boolean not null default true,
  created_at    timestamptz default now(),

  constraint products_food_group_check check (
    food_group in ('maso','ryby','mlecneVyrobky','tuk','cukr','zeleninaOvoce','brambory','celozrnne','lusteniny','none')
  ),
  constraint products_unit_check check (
    default_unit in ('kg','g','l','ml','ks','bal')
  )
);

create index idx_products_food_group on products(food_group);
create index idx_products_org        on products(org_id);
create index idx_products_l2         on products(category_l2);
create index idx_products_name       on products using gin(to_tsvector('czech', name));

-- ── Link ledger entries to products (nullable, backwards compatible) ──────
alter table inventory_ledger
  add column if not exists product_id uuid references products(id) on delete set null;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table products enable row level security;

-- Anyone authenticated can read global products or their own org's products
create policy "products_select" on products
  for select using (
    org_id is null or org_id = current_user_org_id()
  );

-- Admin/vedouci can insert org-specific products
create policy "products_insert" on products
  for insert with check (
    org_id = current_user_org_id() and is_admin_or_vedouci()
  );

-- Admin/vedouci can update/delete their own org's products (not global ones)
create policy "products_update" on products
  for update using (
    org_id = current_user_org_id() and is_admin_or_vedouci()
  );

create policy "products_delete" on products
  for delete using (
    org_id = current_user_org_id() and is_admin_or_vedouci()
  );

-- ── Seed: global built-in products (org_id = NULL) ───────────────────────
insert into products (org_id, name, brand, category_l1, category_l2, food_group, default_unit) values

-- ═══════════════════════════════════════════════════════════════════════════
-- MASO
-- ═══════════════════════════════════════════════════════════════════════════
-- Drůbež
(null,'Vodňanské kuře Čerstvé celé kuře','Vodňanské kuře','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Tesco Kuřecí prsní řízky chlazené','Tesco','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Vodňanská drůbež Kuřecí spodní stehna','Vodňanská drůbež','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Krůtí král Krůtí prsní řízek','Krůtí král','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Tesco Krůtí spodní stehno s kostí','Tesco','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Albert Mleté krůtí maso prsní','Albert','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Tesco Kachna celá hluboce zmrazená','Tesco','Maso, drůbež a ryby','Drůbež','maso','kg'),
(null,'Tesco Finest Kachní prsa s kůží','Tesco','Maso, drůbež a ryby','Drůbež','maso','kg'),
-- Vepřové
(null,'Tesco Vepřová kýta bez kosti vcelku','Tesco','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Maso Planá Vepřové řízky z kýty','Maso Planá','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Tesco Vepřová pečeně bez kosti plátky','Tesco','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Tesco Vepřová krkovice bez kosti plátky','Tesco','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Kostelecké uzeniny Krkovice na gril','Kostelecké uzeniny','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Tesco Vepřový bůček s kostí','Tesco','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Tesco Vepřová žebra na pečení masitá','Tesco','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
(null,'Tesco Mleté vepřové maso 100%','Tesco','Maso, drůbež a ryby','Vepřové maso','maso','kg'),
-- Hovězí a telecí
(null,'Tesco Hovězí zadní kýta','Tesco','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
(null,'Maso Planá Hovězí plátky z kýty','Maso Planá','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
(null,'Tesco Hovězí krk bez kosti','Tesco','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
(null,'Tesco Hovězí kostky na guláš','Tesco','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
(null,'Tesco Finest Hovězí svíčková','Tesco','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
(null,'Tesco Hovězí mleté maso 100%','Tesco','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
(null,'Maso Planá Telecí kýta bez kosti','Maso Planá','Maso, drůbež a ryby','Hovězí a telecí maso','maso','kg'),
-- Mleté směsi
(null,'Tesco Mix mletého masa vepřové a hovězí 50/50','Tesco','Maso, drůbež a ryby','Mleté maso a masové směsi','maso','kg'),
(null,'Kostelecké uzeniny Hovězí burger premium','Kostelecké uzeniny','Maso, drůbež a ryby','Mleté maso a masové směsi','maso','kg'),
-- Zvěřina
(null,'Petron Jelení maso na guláš','Petron','Maso, drůbež a ryby','Zvěřina, jehněčí a králičí maso','maso','kg'),
(null,'Petron Kančí hřbet bez kosti','Petron','Maso, drůbež a ryby','Zvěřina, jehněčí a králičí maso','maso','kg'),
(null,'Tesco Jehněčí hřebínek','Tesco','Maso, drůbež a ryby','Zvěřina, jehněčí a králičí maso','maso','kg'),
(null,'Rabbit Trhový Štěpánov Králík celý kuchaný','Rabbit Trhový Štěpánov','Maso, drůbež a ryby','Zvěřina, jehněčí a králičí maso','maso','kg'),
-- Grilování
(null,'Schneider Marinovaná vepřová krkovice Grill','Schneider','Maso, drůbež a ryby','Maso na grilování a marinované','maso','kg'),
(null,'Kostelecké uzeniny Kuřecí špíz se slaninou','Kostelecké uzeniny','Maso, drůbež a ryby','Maso na grilování a marinované','maso','kg'),
-- Vnitřnosti
(null,'Vodňanské kuře Kuřecí játra chlazená','Vodňanské kuře','Maso, drůbež a ryby','Vnitřnosti','maso','kg'),
(null,'Tesco Vepřové srdce čerstvé','Tesco','Maso, drůbež a ryby','Vnitřnosti','maso','kg'),
-- Uzeniny → maso
(null,'LE&CO Šunka nejvyšší jakosti 92% masa','LE&CO','Uzeniny, lahůdky a rybí výrobky','Šunky a salámy','maso','kg'),
(null,'Chodura Dušená šunka výběrová','Chodura','Uzeniny, lahůdky a rybí výrobky','Šunky a salámy','maso','kg'),
(null,'Pejskar Sušená šunka Serrano','Pejskar','Uzeniny, lahůdky a rybí výrobky','Šunky a salámy','maso','kg'),
(null,'Krahulík Vysočina salám','Krahulík','Uzeniny, lahůdky a rybí výrobky','Šunky a salámy','maso','kg'),
(null,'Kostelecké uzeniny Poličan','Kostelecké uzeniny','Uzeniny, lahůdky a rybí výrobky','Šunky a salámy','maso','kg'),
(null,'Kmotr Paprikáš','Kmotr','Uzeniny, lahůdky a rybí výrobky','Šunky a salámy','maso','kg'),
(null,'Kostelecké uzeniny Vídeňské párky premium','Kostelecké uzeniny','Uzeniny, lahůdky a rybí výrobky','Párky, klobásy a špekáčky','maso','kg'),
(null,'Chodura Debrecínské párky','Chodura','Uzeniny, lahůdky a rybí výrobky','Párky, klobásy a špekáčky','maso','kg'),
(null,'Kmotr Ostravská klobása','Kmotr','Uzeniny, lahůdky a rybí výrobky','Párky, klobásy a špekáčky','maso','kg'),
(null,'Tesco Špekáčky extra','Tesco','Uzeniny, lahůdky a rybí výrobky','Párky, klobásy a špekáčky','maso','kg'),
-- Mražené maso
(null,'Nowaco Kuřecí nugetky obalované','Nowaco','Mražené potraviny','Mražené maso','maso','kg'),

-- ═══════════════════════════════════════════════════════════════════════════
-- RYBY
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Tesco Čerstvý filet z lososa s kůží','Tesco','Maso, drůbež a ryby','Čerstvé ryby','ryby','kg'),
(null,'Klatovské rybářství Pstruh duhový kuchaný','Klatovské rybářství','Maso, drůbež a ryby','Čerstvé ryby','ryby','kg'),
(null,'Tesco Čerstvé krevety loupané vařené','Tesco','Maso, drůbež a ryby','Mořské plody','ryby','kg'),
(null,'Ocean4You Slávky jedlé v poloviční schránce','Ocean4You','Maso, drůbež a ryby','Mořské plody','ryby','kg'),
(null,'Nekton Uzený losos plátky','Nekton','Uzeniny, lahůdky a rybí výrobky','Uzené a marinované ryby','ryby','kg'),
(null,'Varmuža Zavináče v kořeněném nálevu','Varmuža','Uzeniny, lahůdky a rybí výrobky','Uzené a marinované ryby','ryby','kg'),
(null,'Korál Sledě v rostlinném oleji s cibulí','Korál','Uzeniny, lahůdky a rybí výrobky','Uzené a marinované ryby','ryby','kg'),
(null,'Gastro Lahůdky Rybí pomazánka s majonézou','Gastro Lahůdky','Uzeniny, lahůdky a rybí výrobky','Lahůdky a pomazánky','ryby','kg'),
(null,'Franz Josef Tuňák celý v olivovém oleji','Franz Josef','Trvanlivé potraviny','Konzervy a zavařeniny','ryby','ks'),
-- Mražené ryby
(null,'Nowaco Rybí prsty exclusive nemleté','Nowaco','Mražené potraviny','Mražené ryby','ryby','kg'),
(null,'Findus Filé z lososa mražené','Findus','Mražené potraviny','Mražené ryby','ryby','kg'),

-- ═══════════════════════════════════════════════════════════════════════════
-- MLÉČNÉ VÝROBKY
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Olma Čerstvé mléko plnotučné 3,5%','Olma','Mléčné výrobky, vejce a chlazené','Mléko, smetana a máslo','mlecneVyrobky','l'),
(null,'Kunín Trvanlivé mléko polotučné 1,5%','Kunín','Mléčné výrobky, vejce a chlazené','Mléko, smetana a máslo','mlecneVyrobky','l'),
(null,'Tatra Nízkolaktózové mléko','Tatra','Mléčné výrobky, vejce a chlazené','Mléko, smetana a máslo','mlecneVyrobky','l'),
(null,'Kunín Smetana na vaření 12%','Kunín','Mléčné výrobky, vejce a chlazené','Mléko, smetana a máslo','mlecneVyrobky','ml'),
(null,'Olma Smetana ke šlehání 31%','Olma','Mléčné výrobky, vejce a chlazené','Mléko, smetana a máslo','mlecneVyrobky','ml'),
(null,'Madeta Jihočeská zakysaná smetana 15%','Madeta','Mléčné výrobky, vejce a chlazené','Mléko, smetana a máslo','mlecneVyrobky','ml'),
-- Sýry
(null,'Madeta Jihočeský Eidam 30% plátky','Madeta','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Gouda 48% blok Tesco','Tesco','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Olma Moravský bochník','Olma','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Želetava Smetanito tavený sýr','Želetava','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Hochland Plátkový sýr s oky','Hochland','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Sedlčanský Hermelín Originál','Sedlčanský','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','ks'),
(null,'Madeta Jihočeská Niva válec','Madeta','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Galbani Mozzarella di Bufala','Galbani','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','ks'),
(null,'Lemnos Feta sýr','Lemnos','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
(null,'Madeta Jihočeský tvaroh měkký','Madeta','Mléčné výrobky, vejce a chlazené','Sýry','mlecneVyrobky','kg'),
-- Jogurty
(null,'Hollandia Selský jogurt bílý','Hollandia','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','g'),
(null,'Milko Řecký jogurt bílý 0%','Milko','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','g'),
(null,'Olma Klasik bílý jogurt','Olma','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','g'),
(null,'Florian Jogurt jahoda','Olma','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','g'),
(null,'Müller Mix jogurt s křupinkami','Müller','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','g'),
(null,'Activia Jogurt lesní plody','Activia','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','g'),
(null,'Kunín Kefírové mléko natur','Kunín','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','ml'),
(null,'Zott Monte čokoláda-oříšek','Zott','Mléčné výrobky, vejce a chlazené','Jogurty a mléčné dezerty','mlecneVyrobky','ks'),
-- Bezlaktózové
(null,'Meggle Bezlaktózový tvaroh jemný','Meggle','Zdravá výživa a speciální dieta','Bezlaktózy a rostlinné alternativy','mlecneVyrobky','kg'),

-- ═══════════════════════════════════════════════════════════════════════════
-- TUK
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Madeta Jihočeské máslo 250g','Madeta','Mléčné výrobky, vejce a chlazené','Máslo, margaríny a tuky','tuk','g'),
(null,'Tatra Máslo','Tatra','Mléčné výrobky, vejce a chlazené','Máslo, margaríny a tuky','tuk','g'),
(null,'Rama Classic roztíratelný tuk','Rama','Mléčné výrobky, vejce a chlazené','Máslo, margaríny a tuky','tuk','g'),
(null,'Hera na pečení','Hera','Mléčné výrobky, vejce a chlazené','Máslo, margaríny a tuky','tuk','g'),
(null,'Fabio Slunečnicový olej Mňam','Fabio','Trvanlivé potraviny','Oleje, octy a dochucovadla','tuk','l'),
(null,'Brölio Řepkový olej rafinovaný','Brölio','Trvanlivé potraviny','Oleje, octy a dochucovadla','tuk','l'),
(null,'Monini Classico Olivový olej Extra Virgin','Monini','Trvanlivé potraviny','Oleje, octy a dochucovadla','tuk','l'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CUKR
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Korunní cukr Cukr krupice','Korunní','Trvanlivé potraviny','Koření a ingredience na pečení','cukr','kg'),
(null,'Dr. Oetker Vanilínový cukr','Dr. Oetker','Trvanlivé potraviny','Koření a ingredience na pečení','cukr','g'),
(null,'Orion Studentská pečeť mléčná','Orion','Trvanlivé potraviny','Sladkosti a slané pochutiny','cukr','g'),
(null,'Lindt Excellence Hořká čokoláda 70%','Lindt','Trvanlivé potraviny','Sladkosti a slané pochutiny','cukr','g'),
(null,'Opavia Tatranky s lískooříškovou náplní','Opavia','Trvanlivé potraviny','Sladkosti a slané pochutiny','cukr','g'),
(null,'Opavia BeBe Dobré ráno Kakaové','Opavia','Trvanlivé potraviny','Sladkosti a slané pochutiny','cukr','g'),

-- ═══════════════════════════════════════════════════════════════════════════
-- ZELENINA A OVOCE
-- ═══════════════════════════════════════════════════════════════════════════
-- Čerstvé ovoce
(null,'Jablka Gala','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Jablka Golden Delicious','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Hrušky Lucasova','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Pomeranče','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Mandarinky klementinky','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Citrony','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Banány Chiquita','Chiquita','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Ananas celý čerstvý','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','ks'),
(null,'Hrozny révy vinné bílé bezpeckové','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Tesco Borůvky balené 125g','Tesco','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','g'),
(null,'Čerstvé jahody vanička 250g','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','g'),
(null,'Broskve ploché balené','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','kg'),
(null,'Avokádo Ready to Eat 2ks','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','ks'),
(null,'Mango zralé ke konzumaci','','Ovoce a zelenina','Čerstvé ovoce','zeleninaOvoce','ks'),
-- Čerstvá zelenina
(null,'Rajčata keříková','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','kg'),
(null,'Tesco Cherry rajčata medová','Tesco','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','g'),
(null,'Paprika ramiro červená','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','kg'),
(null,'Okurka hadová','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','ks'),
(null,'Mrkev karotka','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','kg'),
(null,'Celer bulvový','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','ks'),
(null,'Brokolice balená 500g','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','g'),
(null,'Květák celý','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','ks'),
(null,'Ledový salát','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','ks'),
(null,'Rukola balená vanička 125g','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','g'),
(null,'Žampióny bílé zahradní balené 250g','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','g'),
(null,'Hlíva ústřičná čerstvá vanička','','Ovoce a zelenina','Čerstvá zelenina','zeleninaOvoce','g'),
-- Sušené ovoce a ořechy
(null,'Tesco Mandle jádra loupaná 100g','Tesco','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
(null,'Ensa Kešu ořechy pražené solené','Ensa','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
(null,'Tesco Rozinky výběrové 200g','Tesco','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
(null,'Ensa Datle sušené bez pecek','Ensa','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
(null,'Druid Sušené švestky měkké','Druid','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
(null,'Tesco Slunečnicová semínka loupaná','Tesco','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
(null,'Iswari Chia semínka BIO','Iswari','Ovoce a zelenina','Sušené ovoce, ořechy a semínka','zeleninaOvoce','g'),
-- Mražená zelenina a ovoce
(null,'Nowaco Hrášek mražený','Nowaco','Mražené potraviny','Mražená zelenina a ovoce','zeleninaOvoce','kg'),
(null,'Bonduelle Vapeur Kukuřice sladká','Bonduelle','Mražené potraviny','Mražená zelenina a ovoce','zeleninaOvoce','kg'),
(null,'Dione Špenátový protlak mražený','Dione','Mražené potraviny','Mražená zelenina a ovoce','zeleninaOvoce','kg'),
(null,'Agro Jesenice Zeleninová směs pod svíčkovou','Agro Jesenice','Mražené potraviny','Mražená zelenina a ovoce','zeleninaOvoce','kg'),
-- Konzervy zelenina
(null,'Bonduelle Hrášek v mírně slaném nálevu gold','Bonduelle','Trvanlivé potraviny','Konzervy a zavařeniny','zeleninaOvoce','ks'),
(null,'Giana Kukuřice sladká','Giana','Trvanlivé potraviny','Konzervy a zavařeniny','zeleninaOvoce','ks'),

-- ═══════════════════════════════════════════════════════════════════════════
-- BRAMBORY
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Brambory konzumní pozdní přílohové','','Ovoce a zelenina','Brambory, cibule a česnek','brambory','kg'),
(null,'Cibule žlutá síť 1kg','','Ovoce a zelenina','Brambory, cibule a česnek','brambory','kg'),
(null,'Česnek fialový balený','','Ovoce a zelenina','Brambory, cibule a česnek','brambory','ks'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CELOZRNNÉ OBILOVINY
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Panzani Spaghetti No.5','Panzani','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','g'),
(null,'Barilla Penne Rigate','Barilla','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','g'),
(null,'Zátkovy Vaječné těstoviny Kolínka','Zátkovy','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','g'),
(null,'Adriana Vlasové nudle polévkové','Adriana','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','g'),
(null,'Lagris Rýže Jasmínová','Lagris','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','kg'),
(null,'Vitana Rýže Basmati','Vitana','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','kg'),
(null,'Menu Gold Rýže Kulatozrnná na rizoto','Menu Gold','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','celozrnne','kg'),
(null,'Emco Ovesné vločky jemné','Emco','Trvanlivé potraviny','Snídaňové cereálie, müsli a kaše','celozrnne','g'),
(null,'Nestlé Corn Flakes kukuřičné lupínky','Nestlé','Trvanlivé potraviny','Snídaňové cereálie, müsli a kaše','celozrnne','g'),
(null,'Emco Mysli na zdraví křupavé s jahodami','Emco','Trvanlivé potraviny','Snídaňové cereálie, müsli a kaše','celozrnne','g'),
(null,'Bonavita Ovesná kaše s čokoládou','Bonavita','Trvanlivé potraviny','Snídaňové cereálie, müsli a kaše','celozrnne','g'),
(null,'Wasa Knäckebrot Original','Wasa','Pekařství a cukrářství','Trvanlivé pečivo a knäckebroty','celozrnne','g'),
(null,'Bonavita Křehké plátky pšeničné','Bonavita','Pekařství a cukrářství','Trvanlivé pečivo a knäckebroty','celozrnne','g'),
(null,'Penam Žitný chléb celozrnný','Penam','Pekařství a cukrářství','Chléb a pečivo','celozrnne','ks'),
(null,'Tesco Slunečnicový chléb','Tesco','Pekařství a cukrářství','Chléb a pečivo','celozrnne','ks'),
(null,'Chléb Šumava konzumní pšenično-žitný krájený','','Pekařství a cukrářství','Chléb a pečivo','celozrnne','ks'),
(null,'Rohlík pšeničný ze zmrazeného těsta','','Pekařství a cukrářství','Chléb a pečivo','celozrnne','ks'),
(null,'Houska pšeničná ražená','','Pekařství a cukrářství','Chléb a pečivo','celozrnne','ks'),

-- ═══════════════════════════════════════════════════════════════════════════
-- LUŠTĚNINY
-- ═══════════════════════════════════════════════════════════════════════════
(null,'Lagris Čočka horská hnědá','Lagris','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','lusteniny','kg'),
(null,'Menu Gold Čočka červená loupaná','Menu Gold','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','lusteniny','kg'),
(null,'Vitana Fazole bílá v suchém stavu','Vitana','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','lusteniny','kg'),
(null,'Arax Hrách žlutý půlený','Arax','Trvanlivé potraviny','Těstoviny, rýže a luštěniny','lusteniny','kg'),
(null,'Deli Hummus Natural','Deli','Uzeniny, lahůdky a rybí výrobky','Lahůdky a pomazánky','lusteniny','g'),

-- ═══════════════════════════════════════════════════════════════════════════
-- NONE (mimo normy)
-- ═══════════════════════════════════════════════════════════════════════════
-- Vejce
(null,'Tesco Vejce velikost M 30ks','Tesco','Mléčné výrobky, vejce a chlazené','Vejce','none','ks'),
(null,'Česká vejce Velikost L 10ks','','Mléčné výrobky, vejce a chlazené','Vejce','none','ks'),
(null,'Schubert Podestýlková vejce','Schubert','Mléčné výrobky, vejce a chlazené','Vejce','none','ks'),
-- Nápoje
(null,'Mattoni Neperlivá přírodní','Mattoni','Nápoje','Minerální a pramenité vody','none','l'),
(null,'Rajec Jemně perlivá','Rajec','Nápoje','Minerální a pramenité vody','none','l'),
(null,'Coca-Cola Originál 1,5l','Coca-Cola','Nápoje','Limonády, koly a energetické nápoje','none','l'),
(null,'Relax 100% Pomeranč s dužinou','Relax','Nápoje','Džusy, nektary a sirupy','none','l'),
(null,'Jupí Sirup Pomerančový hustý','Jupí','Nápoje','Džusy, nektary a sirupy','none','l'),
(null,'Jihlavanka Standard mletá káva','Jihlavanka','Nápoje','Káva, čaj a kakao','none','g'),
(null,'Nescafé Gold instantní káva','Nescafé','Nápoje','Káva, čaj a kakao','none','g'),
(null,'Pickwick Ranní čaj černý','Pickwick','Nápoje','Káva, čaj a kakao','none','ks'),
(null,'Teekanne Green Tea','Teekanne','Nápoje','Káva, čaj a kakao','none','ks'),
-- Koření a dochucovadla
(null,'Vitana Sůl kamenná s jodem','Vitana','Trvanlivé potraviny','Koření a ingredience na pečení','none','kg'),
(null,'Kotányi Černý pepř mletý','Kotányi','Trvanlivé potraviny','Koření a ingredience na pečení','none','g'),
(null,'Babiččina volba Mouka pšeničná hladká','Babiččina volba','Trvanlivé potraviny','Koření a ingredience na pečení','none','kg'),
(null,'Vitana Majoránka drhnutá','Vitana','Trvanlivé potraviny','Koření a ingredience na pečení','none','g'),
-- Omáčky
(null,'Otma Gurmán Kečup jemný','Otma','Trvanlivé potraviny','Omáčky, kečupy a hořčice','none','ml'),
(null,'Alba Plnotučná hořčice','Alba','Trvanlivé potraviny','Omáčky, kečupy a hořčice','none','g'),
(null,'Bzenecký ocet kvasný lihový 8%','Bzenecký','Trvanlivé potraviny','Oleje, octy a dochucovadla','none','ml'),
-- Konzervy ostatní
(null,'Efko Okurky lahůdkové sterilované','Efko','Trvanlivé potraviny','Konzervy a zavařeniny','none','ks'),
(null,'Novák Jahodový kompot','Novák','Trvanlivé potraviny','Konzervy a zavařeniny','none','ks'),
-- Mražená hotová jídla
(null,'Dr. Oetker Pizza Ristorante Salame','Dr. Oetker','Mražené potraviny','Mražená hotová jídla a pizzy','none','ks'),
-- Sladkosti
(null,'Haribo Goldbären','Haribo','Trvanlivé potraviny','Sladkosti a slané pochutiny','none','g'),
-- Bio
(null,'Olma BIO Mléko čerstvé 3,5%','Olma','Zdravá výživa a speciální dieta','Bio a organické produkty','mlecneVyrobky','l'),
(null,'Sonnentor BIO Čaj klidná hlava','Sonnentor','Zdravá výživa a speciální dieta','Bio a organické produkty','none','ks'),
-- Bezlepkové
(null,'Schär Pan Blanco bezlepkový chléb','Schär','Zdravá výživa a speciální dieta','Bezlepkové produkty','none','ks'),
(null,'Schär Penne bezlepkové těstoviny','Schär','Zdravá výživa a speciální dieta','Bezlepkové produkty','none','g'),
-- Rostlinné alternativy
(null,'Alpro Mandlové mléko neslazené','Alpro','Zdravá výživa a speciální dieta','Bezlaktózy a rostlinné alternativy','none','l'),
(null,'Violife Vegan plátkový sýr s příchutí gouda','Violife','Zdravá výživa a speciální dieta','Bezlaktózy a rostlinné alternativy','none','g')
;

