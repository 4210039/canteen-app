require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const dbRoutes = require('./server/dbRoutes');
const { isDbConfigured } = require('./server/db/supabaseClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Serve /public with caching fully disabled. This app has no versioned/hashed
// filenames (app.js, style.css, index.html keep the same name across every
// deploy), so any layer that's allowed to cache them — the browser, or
// Vercel's edge CDN in front of a stable domain like the production alias —
// can end up serving an old copy after a new deployment goes live, with no
// visible sign anything is wrong (a hard refresh or incognito window does NOT
// bypass a CDN-level cache, only browser-level cache/cookies). Forcing
// no-store means every request always goes all the way to the origin.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ── Database-backed persistence routes ─────────────────────────────────────
// All routes under /api/db/* — see server/dbRoutes.js. Returns 503 with a
// clear message if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set.
// The frontend has no local fallback — without these env vars, the app
// cannot run at all.
app.use('/api/db', dbRoutes);

// ── Proxy: fetch school menu page ──────────────────────────────────────────
app.get('/api/fetch-menu', async (req, res) => {
  try {
    const url = 'https://www.ms-harmonie.cz/jidelnicek/';
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
      },
      timeout: 15000
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Menu site returned ${response.status}` });
    }

    const html = await response.text();
    res.json({ html, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Menu fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy: fetch a bookmarked recipe page + draft ingredients via AI ───────
// Runs server-side because the target sites (recepty.cz, toprecepty.cz, etc.)
// won't have CORS headers allowing a browser to fetch them directly.
// Strips tags to plain text (no extra HTML-parsing dependency) and truncates
// before handing to Groq, to keep token usage bounded regardless of page size.
app.post('/api/extract-recipe-from-url', async (req, res) => {
  const { url, foodGroupList } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in .env' });
  }
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });
    if (!pageRes.ok) {
      return res.status(502).json({ error: `Stránku se nepodařilo načíst (HTTP ${pageRes.status})` });
    }
    const rawHtml = await pageRes.text();

    // Strip scripts/styles, then all remaining tags, collapse whitespace.
    const text = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000); // keep prompt size bounded regardless of page length

    if (!text || text.length < 50) {
      return res.status(422).json({ error: 'Ze stránky se nepodařilo získat žádný čitelný text.' });
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1200,
        messages: [
          { role: 'system', content: 'Jsi kuchař. Z textu webové stránky s receptem vytáhneš skutečný seznam ingrediencí. Vracíš POUZE čisté JSON pole, bez markdown, bez vysvětlení.' },
          { role: 'user', content: `Text stránky s receptem:\n"""${text}"""\n\nVytáhni skutečné ingredience a jejich množství. Pokud recept udává počet porcí, přepočítej množství na JEDNU porci. Pokud počet porcí není uveden, odhadni pro 1 porci dítěte.\nPro každou ingredienci urči nejpravděpodobnější skupinu potravin z tohoto seznamu klíčů: ${foodGroupList || ''}\n\nVrať POUZE JSON pole (bez markdown):\n[{"name": "mrkev", "food_group": "zelenina", "qty_per_portion": 30, "unit": "g"}]` }
        ]
      }),
      timeout: 30000,
    });
    const groqData = await groqRes.json();
    if (groqData.error) return res.status(500).json({ error: groqData.error.message || 'Groq API chyba' });

    const raw = groqData.choices?.[0]?.message?.content || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();
    let ingredients;
    try {
      ingredients = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'AI vrátila neplatný formát.' });
    }
    if (!Array.isArray(ingredients)) ingredients = [];
    res.json({ ingredients });
  } catch (err) {
    console.error('Recipe extraction error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy: Groq API (keeps API key server-side) ────────────────────────────
app.post('/api/groq', async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in .env — get your free key at https://console.groq.com' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
      timeout: 60000
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Groq API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Public config for frontend Supabase client ──────────────────────────────
// The anon key is DESIGNED to be public (RLS protects the data, not secrecy
// of this key) — this endpoint just avoids hardcoding it into a static JS
// file, so the same build works against any .env without editing source.
app.get('/api/public-config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    dbConfigured: isDbConfigured(),
  });
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.GROQ_API_KEY,
    dbConfigured: isDbConfigured(),
    time: new Date().toISOString()
  });
});

// ── Fallback: serve SPA ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🍽️  Canteen Manager running at http://localhost:${PORT}`);
  console.log(`   Groq API key: ${process.env.GROQ_API_KEY ? '✅ set' : '❌ missing – get free key at https://console.groq.com'}`);
  console.log(`   Database (Supabase): ${isDbConfigured() ? '✅ configured' : '❌ NOT configured – app cannot run without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'}\n`);
});
