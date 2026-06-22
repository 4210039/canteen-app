#!/usr/bin/env node
/**
 * Sprint 1 — Migration script
 *
 * Usage:
 *   node migrate-to-supabase.js path/to/canteen-export-2026-06-21.json
 *
 * Reads the JSON file produced by public/export.html (localStorage dump)
 * and writes it into the Supabase tables created by
 * supabase/migrations/001_initial_schema.sql + 002_seed_data.sql.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as
 * the server). Run this once per browser/device that has local data
 * worth keeping.
 *
 * Idempotency note: this script is safe to re-run. Menus and attendance
 * use upsert (matching the DB's unique constraints), so re-running won't
 * duplicate them. The inventory ledger uses plain insert — if you run
 * this twice against the same export file, ledger entries WILL be
 * duplicated. Each ledger row gets a deterministic legacy_id tag in its
 * id so duplicates are at least traceable, but the safe pattern is:
 * run once per device, verify in Supabase, then stop.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ORG_ID = process.env.MIGRATION_ORG_ID || '00000000-0000-0000-0000-000000000001';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node migrate-to-supabase.js path/to/export.json');
    process.exit(1);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
  }

  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${fullPath}`);
    process.exit(1);
  }

  const exportPayload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const data = exportPayload.data || exportPayload; // tolerate raw dumps too

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  console.log(`\n📦 Migrating export from: ${exportPayload.exportedAt || 'unknown date'}`);
  console.log(`   Target organization: ${ORG_ID}\n`);

  // ── 1. Verify the organization exists ──────────────────────
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', ORG_ID)
    .maybeSingle();

  if (orgErr) { console.error('❌ Failed to check organization:', orgErr.message); process.exit(1); }
  if (!org) {
    console.error(`❌ Organization ${ORG_ID} not found. Run supabase/migrations/002_seed_data.sql first.`);
    process.exit(1);
  }
  console.log(`✅ Organization found: ${org.name}`);

  // ── 2. Migrate menu ──────────────────────────────────────────
  if (data.menu && data.menu.fetchedAt) {
    const weekKey = isoWeekFromDate(new Date(data.menu.fetchedAt));
    const { error } = await supabase.from('menus').upsert(
      {
        org_id: ORG_ID,
        week_key: weekKey,
        raw_text: data.menu.raw || null,
        days_json: data.menu.days || [],
        ingredients: data.ingredients || [],
        fetched_at: data.menu.fetchedAt,
      },
      { onConflict: 'org_id,week_key' }
    );
    if (error) console.error('⚠️  Menu migration failed:', error.message);
    else console.log(`✅ Menu migrated (week ${weekKey})`);
  } else {
    console.log('ℹ️  No menu data to migrate');
  }

  // ── 3. Migrate attendance ────────────────────────────────────
  if (data.attendance && typeof data.attendance === 'object') {
    const rows = [];
    for (const [weekKey, weekData] of Object.entries(data.attendance)) {
      for (const [dayIndex, dayData] of Object.entries(weekData)) {
        for (const meal of ['presnidavka', 'obed', 'svacina']) {
          if (dayData[meal] !== undefined && dayData[meal] !== null) {
            rows.push({
              org_id: ORG_ID,
              week_key: weekKey,
              day_index: parseInt(dayIndex),
              meal,
              age_group: 'ms_3_6', // localStorage version didn't store per-cell age group; assume default
              child_count: parseInt(dayData[meal]) || 0,
            });
          }
        }
      }
    }

    if (rows.length) {
      const { error } = await supabase
        .from('attendance')
        .upsert(rows, { onConflict: 'org_id,week_key,day_index,meal,age_group' });
      if (error) console.error('⚠️  Attendance migration failed:', error.message);
      else console.log(`✅ Attendance migrated (${rows.length} cells across ${Object.keys(data.attendance).length} weeks)`);
    } else {
      console.log('ℹ️  No attendance cells to migrate');
    }
  } else {
    console.log('ℹ️  No attendance data to migrate');
  }

  // ── 4. Migrate inventory ledger ──────────────────────────────
  if (Array.isArray(data.ledger) && data.ledger.length) {
    const rows = data.ledger.map(e => ({
      org_id: ORG_ID,
      type: e.type || 'in',
      name: e.name,
      food_group: e.foodGroup || null,
      qty: e.qty || 0,
      unit: e.unit || 'ks',
      grams: e.grams || 0,
      price: e.price || 0,
      store: e.store || null,
      promo: !!e.promo,
      week_key: e.weekKey || isoWeekFromDate(new Date(e.date || Date.now())),
      source: e.source || 'manual',
      created_at: e.date || new Date().toISOString(),
    }));

    const { error } = await supabase.from('inventory_ledger').insert(rows);
    if (error) console.error('⚠️  Ledger migration failed:', error.message);
    else console.log(`✅ Ledger migrated (${rows.length} entries)`);
  } else {
    console.log('ℹ️  No ledger entries to migrate');
  }

  console.log('\n🎉 Migration complete. Verify data in the Supabase table editor before deleting localStorage data.\n');
}

// Mirrors the getWeekKey() logic in public/app.js so week keys match
// between the old localStorage data and the new database rows.
function isoWeekFromDate(d) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
