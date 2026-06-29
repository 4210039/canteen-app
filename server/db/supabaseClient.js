/**
 * Supabase client — server-side, uses the service-role key so the
 * Express backend (not the browser) is the only thing that can write
 * to the database in Sprint 1. This keeps the architecture honest:
 *
 *   Browser → Express API (/api/*) → Supabase
 *
 * not:
 *
 *   Browser → Supabase directly
 *
 * The direct-from-browser pattern is common with Supabase, but we're
 * deliberately keeping the existing Express proxy layer (already used
 * for the Groq API key) so Sprint 2's role-based access control has a
 * single enforcement point, and so the menu-scraping endpoint and the
 * database endpoints share one consistent API surface.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return null; // Not configured — callers must surface this as a hard error, not fall back
  }
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabase;
}

function isDbConfigured() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

module.exports = { getSupabase, isDbConfigured };
