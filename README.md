# 🍽️ Canteen Smart Manager

Chytrý správce nákupů pro školní jídelnu MŠ Harmonie.
Používá **Groq API** (zdarma, bez platební karty) s modelem `llama-3.3-70b-versatile`.

## Co aplikace dělá

- **Jídelníček** – Stáhne aktuální týdenní menu z ms-harmonie.cz a pomocí AI extrahuje suroviny
- **Akce & Nákup** – Pro každou surovinu vygeneruje přímé odkazy do Lidl, Kaufland, Albert, Globus a Kupi.cz
- **Sklad** – Eviduje nakoupené suroviny, množství, ceny a obchod
- **Finance** – Týdenní a měsíční přehledy nákladů, cena na dítě, úspory z akcí

---

## 🚀 Spuštění lokálně

### 1. Získejte zdarma Groq API klíč
1. Jděte na https://console.groq.com
2. Zaregistrujte se (nevyžaduje platební kartu)
3. Klikněte **API Keys → Create API Key**
4. Zkopírujte klíč (začíná `gsk_...`)

### 2. Předpoklady
- [Node.js](https://nodejs.org) verze 18 nebo vyšší

### 3. Instalace
```bash
unzip canteen-app.zip
cd canteen-app
npm install
```

### 4. Nastavení API klíče
```bash
cp .env.example .env
```
Otevřete soubor `.env` a doplňte váš klíč:
```
GROQ_API_KEY=gsk_...váš-klíč...
PORT=3000
```

### 5. Spuštění
```bash
node server.js
```
Otevřete prohlížeč na adrese: **http://localhost:3000**

---

## 📁 Struktura projektu

```
canteen-app/
├── server.js              # Express server (proxy + statické soubory + DB routes)
├── server/
│   ├── dbRoutes.js         # Sprint 1: API routes pro Supabase databázi
│   └── db/
│       └── supabaseClient.js
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql   # Sprint 1: databázové schéma
│       └── 002_seed_data.sql        # Sprint 1: výchozí org + normy
├── migrate-to-supabase.js  # Sprint 1: import dat z localStorage do DB
├── SPRINT1_SETUP.md        # Sprint 1: návod na nastavení databáze
├── package.json
├── .env.example            # Šablona pro prostředí (Groq + Supabase)
├── .env                    # Vaše klíče (NESDÍLEJTE!)
└── public/
    ├── index.html          # Hlavní SPA
    ├── app.js               # Veškerá logika frontendu
    ├── norms.js             # Výživové normy (Vyhl. 107/2005 Sb.)
    ├── style.css            # Styly
    ├── guide.html           # Uživatelský průvodce
    └── export.html          # Sprint 1: export dat z prohlížeče pro migraci
```

> **Poznámka k Sprintu 1:** Databáze je připravená a funkční, ale frontend
> (`app.js`) zatím stále používá `localStorage` jako primární úložiště.
> Appka funguje identicky, ať už Supabase nastavíte nebo ne — viz `SPRINT1_SETUP.md`.

---

## ☁️ Nasazení na Render.com (zdarma)

1. Vytvořte účet na [render.com](https://render.com)
2. Nahrajte projekt na GitHub (`git init && git add . && git commit -m "init" && git push`)
3. V Render vytvořte **New Web Service**
4. Nastavte:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. V sekci **Environment Variables** přidejte:
   - `GROQ_API_KEY` = váš klíč
6. Klikněte **Deploy**

---

## 🔧 Groq free tier limity

| Limit | Hodnota |
|-------|---------|
| Požadavky / minuta | 30 |
| Požadavky / den | 14 400 |
| Tokeny / minuta | 6 000 |

Pro školní jídelnu (2-3 požadavky týdně) je to více než dostatečné.

---

## 🔧 Budoucí rozšíření (MVP → produkce)

- [ ] Automatická denní kontrola jídelníčku (cron job)
- [ ] E-mail notifikace při novém jídelníčku
- [ ] Integrace s Kupi.cz pro reálné akční ceny
- [ ] Export do PDF / Excel
- [ ] Více školních jídelen
