# Sprint 2 — Přihlášení a role

Tento dokument popisuje, jak zapnout autentizaci a role pro Canteen Smart Manager,
a jak ověřit, že vše funguje.

## Co Sprint 2 přináší

- Přihlášení (e-mail + heslo) přes Supabase Auth
- Tři role: **Admin** (ředitelka), **Vedoucí jídelny**, **Kuchařka**
- Role-based zobrazení záložek — kuchařka nevidí Finance/Normy/Nastavení
- Databáze teď **skutečně vynucuje** přístup (RLS policies), ne jen UI
- Tlačítko **Synchronizace** v Nastavení — ručně nahraje/stáhne data mezi
  prohlížečem (localStorage) a cloudem (Supabase)

**Appka funguje beze změny i bez přihlášení**, pokud `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` nejsou v `.env` nastavené — přihlašovací
obrazovka se vůbec nezobrazí, appka běží jako ve Sprintu 1.

---

## Krok 1 — Spusťte SQL migraci

V Supabase **SQL Editor**, spusťte `supabase/migrations/003_auth_and_roles.sql`
(po Sprintu 1 migracích 001 a 002, pokud jste je ještě nespustili).

Ověřte: **Table Editor → user_profiles** by měla existovat (zatím prázdná).

## Krok 2 — Doplňte ANON klíč do .env

V Supabase: **Project Settings → API** — tentokrát zkopírujte klíč
**„anon" / „public"** (NE service_role, ten už máte ze Sprintu 1).

```
SUPABASE_ANON_KEY=eyJ...
```

Restartujte server.

## Krok 3 — Povolte e-mailové přihlášení v Supabase

1. V Supabase: **Authentication → Providers**
2. Ujistěte se, že **Email** provider je zapnutý
3. **Authentication → URL Configuration** — pro lokální testování by mělo
   stačit výchozí nastavení; pro produkční nasazení později přidáte vaši
   doménu do **Site URL** a **Redirect URLs**

### Volitelné: vypněte potvrzení e-mailu pro rychlejší testování

V **Authentication → Providers → Email** můžete dočasně vypnout
„Confirm email" — pak se po registraci přihlásíte okamžitě, bez
nutnosti klikat na potvrzovací odkaz v e-mailu. **Pro produkci to
zase zapněte.**

---

## Krok 4 — Otestujte registraci a přihlášení

1. Otevřete appku — měla by se objevit přihlašovací obrazovka
2. Klikněte **„Vytvořit nový účet"**
3. Vyplňte jméno, e-mail, heslo (min. 6 znaků) → **„Vytvořit účet"**
4. Pokud jste nevypnuli potvrzení e-mailu: zkontrolujte schránku a klikněte
   na potvrzovací odkaz, pak se vraťte a přihlaste se
5. Po přihlášení byste měli vidět appku s vaším jménem a rolí **„Kuchařka"**
   v pravém horním rohu (to je výchozí role nového účtu)

### Ověřte v Supabase

**Table Editor → user_profiles** — měl by tam být nový řádek s vaším
jménem, `role = 'kucharka'`, a `org_id` ukazující na MŠ Harmonie.

## Krok 5 — Povyšte se na Admina

Protože první účet dostane roli „Kuchařka" automaticky, potřebujete se
ručně povýšit přímo v databázi (jen poprvé — pak už to půjde přes UI):

1. V Supabase **Table Editor → user_profiles**
2. Klikněte na svůj řádek, upravte sloupec `role` na `admin`, uložte
3. V appce: odhlaste se a přihlaste znovu (nebo obnovte stránku)
4. V Nastavení byste teď měli vidět sekci **„👥 Uživatelé a role"**

## Krok 6 — Ověřte role-based zobrazení záložek

- Jako **Admin**: měli byste vidět všech 7 záložek
- Vytvořte si druhý testovací účet (jiný e-mail) a nechte mu výchozí roli
  **Kuchařka** — po přihlášení by měl vidět jen: Jídelníček, Docházka,
  Akce & Nákup, Sklad (4 záložky, ne Finance/Normy/Nastavení)
- Jako Admin v Nastavení → Uživatelé a role změňte roli druhého účtu na
  „Vedoucí jídelny" — po jeho příštím přihlášení by měl vidět všech 7 záložek

## Krok 7 — Vyzkoušejte synchronizaci

1. Přihlaste se jako Admin
2. V Nastavení → ☁️ Synchronizace klikněte **„⬆️ Nahrát do cloudu"**
3. Mělo by se zobrazit: `✅ Nahráno: menu=true, docházka=X, sklad=Y`
4. Ověřte v Supabase **Table Editor → inventory_ledger** — měly by tam
   přibýt nové záznamy (pokud jste použil Sprint 1 migrační skript dřív,
   tyto by se NEMĚLY duplikovat díky `_synced` příznaku)

---

## Bezpečnostní poznámka

Sprint 1 nechal v databázi „allow all" policies (kdokoliv s service_role
klíčem mohl číst/psát cokoliv). Migrace `003_auth_and_roles.sql` tyto
policies **ruší** a nahrazuje je rolemi — od teď i requesty přes
service_role klíč v `authMiddleware.js` slouží jen k ověření tokenu,
samotná data se čtou/zapisují přes klienta scoped na konkrétního
přihlášeného uživatele (`userScopedClient` v `dbRoutes.js`), takže RLS
skutečně běží na každém požadavku.

## Co dál (mimo Sprint 2)

Sync je zatím **manuální tlačítko**, ne automatický zápis při každé akci.
Plně automatický zápis do databáze (každé kliknutí na „Potvrdit nákup"
rovnou zapíše do Supabase, ne jen do localStorage) je navazující krok,
jakmile bude tenhle most ověřený jako spolehlivý v reálném provozu.
