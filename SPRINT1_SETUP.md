# Sprint 1 — Databáze a migrace

Tento dokument popisuje, jak nastavit Supabase databázi pro Canteen Smart Manager
a migrovat existující data z localStorage.

## Co Sprint 1 přináší

- Kompletní databázové schéma (`organizations`, `attendance`, `menus`,
  `shopping_lists`, `inventory_ledger`, `norms_config`)
- Backend API vrstva (`/api/db/*`) připravená nahradit `localStorage`
- Migrační nástroj pro export dat z prohlížeče a import do databáze
- **Appka funguje beze změny i bez databáze** — pokud Supabase nenastavíte,
  vše běží jako dosud na `localStorage`. Sprint 1 je *příprava*, ne *přepnutí*.

Frontend (`app.js`) v tomto sprintu **ještě nevolá** `/api/db/*` — to je
záměrně odložené na okamžik, kdy bude ověřeno, že backend a schéma fungují
správně. Příští krok (mimo rozsah Sprintu 1) je přepojit `save()`/`load()`
v `app.js` na tyto endpointy.

---

## Krok 1 — Vytvořte Supabase projekt

1. Jděte na [supabase.com](https://supabase.com) → **New Project** (zdarma)
2. Počkejte ~2 minuty, než se projekt vytvoří
3. V levém menu: **Project Settings → API**
   - Zkopírujte **Project URL** → to je `SUPABASE_URL`
   - Zkopírujte **service_role key** (ne `anon` klíč!) → to je `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **service_role klíč má plný přístup k databázi bez omezení.** Nikdy ho
nevkládejte do frontend kódu ani ho nesdílejte — patří jen do `.env` na serveru.

## Krok 2 — Spusťte migrace schématu

1. V Supabase: **SQL Editor → New query**
2. Otevřete `supabase/migrations/001_initial_schema.sql`, zkopírujte celý obsah, vložte a klikněte **Run**
3. Stejně postupujte s `supabase/migrations/002_seed_data.sql`
4. Ověřte: **Table Editor** by měl ukazovat 8 tabulek a v `organizations` jeden řádek „MŠ Harmonie"

## Krok 3 — Nastavte .env

```
SUPABASE_URL=https://vasprojekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Restartujte server:
```cmd
node server.js
```

Měli byste vidět:
```
Database (Supabase): ✅ configured
```

Ověřte v prohlížeči: `http://localhost:3000/api/db/organizations` by mělo
vrátit JSON s „MŠ Harmonie".

## Krok 4 — Exportujte existující data z prohlížeče

1. Otevřete `http://localhost:3000/export.html`
2. Klikněte **„⬇️ Stáhnout export.json"**
3. Soubor se stáhne do vaší Downloads složky

## Krok 5 — Importujte do databáze

```cmd
node migrate-to-supabase.js C:\Users\VaseJmeno\Downloads\canteen-export-2026-06-21.json
```

Skript vypíše, co se migrovalo:
```
✅ Organization found: MŠ Harmonie
✅ Menu migrated (week 2026-W25)
✅ Attendance migrated (15 cells across 3 weeks)
✅ Ledger migrated (12 entries)
```

Zkontrolujte výsledek v Supabase **Table Editor**.

⚠️ **Tento skript spusťte jen jednou za export.** Opakované spuštění stejného
souboru duplikuje záznamy ve skladu (`inventory_ledger`), protože se vkládají
nově, ne přes upsert (na rozdíl od menu a docházky).

---

## Co dál (mimo Sprint 1)

Sprint 1 končí tady — databáze existuje, API vrstva funguje, data jdou
migrovat. Appka v prohlížeči ale **stále čte a zapisuje do localStorage**,
ne do databáze. Přepojení frontendu je samostatný krok, který logicky patří
buď na konec Sprintu 1, nebo na začátek Sprintu 2 (společně s přihlášením,
protože jakmile appka mluví s databází, dává smysl rovnou vědět *kdo* s ní mluví).
