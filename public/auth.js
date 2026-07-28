/* ═══════════════════════════════════════════════════════════
   Sprint 2 — auth.js
   Handles login, session persistence, and role-aware UI gating.
   Loaded BEFORE app.js — exposes window.AUTH for app.js to use.
═══════════════════════════════════════════════════════════ */

window.AUTH = (function () {
  let supabaseClient = null;
  let session = null;
  let profile = null; // { id, org_id, role, full_name }

  const ROLE_LABELS = {
    admin: 'Ředitelka / Admin',
    vedouci: 'Vedoucí jídelny',
    kucharka: 'Kuchařka',
    tester: 'Tester',
  };

  // Tabs each role is allowed to see. Admin and vedouci see everything;
  // kuchařka focuses on daily kitchen operations, not financial/compliance
  // reporting or settings (matches the Sprint 2 role definition).
  // tester: sees/uses everything EXCEPT audit log and settings.
  const TAB_PERMISSIONS = {
    admin:    ['menu', 'recepty', 'attendance', 'offers', 'nakup', 'warehouse', 'finance', 'norms', 'audit', 'settings'],
    vedouci:  ['menu', 'recepty', 'attendance', 'offers', 'nakup', 'warehouse', 'finance', 'norms', 'audit', 'settings'],
    kucharka: ['menu', 'recepty', 'attendance', 'offers', 'nakup', 'warehouse'],
    tester:   ['menu', 'recepty', 'attendance', 'offers', 'nakup', 'warehouse', 'finance', 'norms'],
  };

  async function init() {
    const res = await fetch('/api/public-config');
    const config = await res.json();

    if (!config.dbConfigured || !config.supabaseUrl || !config.supabaseAnonKey) {
      return { dbConfigured: false };
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    // Restore existing session (page refresh, returning visit)
    const { data: { session: existing } } = await supabaseClient.auth.getSession();
    if (existing) {
      session = existing;
      await loadProfile();
    }

    return { dbConfigured: true };
  }

  async function loadProfile() {
    if (!session) return null;
    const res = await fetch('/api/db/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      profile = null;
      return null;
    }
    const data = await res.json();
    profile = data.profile;
    return profile;
  }

  async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
    session = data.session;
    await loadProfile();
    // Record login event in audit log (fire-and-forget, don't block UI)
    fetch('/api/db/audit/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {}); // non-blocking, never throws
    return profile;
  }

  async function signUp(email, password, fullName) {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }, // role defaults to 'kucharka' via DB trigger
    });
    if (error) throw new Error(translateAuthError(error.message));
    session = data.session;
    if (session) await loadProfile();
    return { session: data.session, needsEmailConfirm: !data.session };
  }

  async function signOut() {
    await supabaseClient.auth.signOut();
    session = null;
    profile = null;
  }

  function translateAuthError(msg) {
    const map = {
      'Invalid login credentials': 'Nesprávný e-mail nebo heslo.',
      'User already registered': 'Tento e-mail je již zaregistrován.',
      'Password should be at least 6 characters': 'Heslo musí mít alespoň 6 znaků.',
      'Email not confirmed': 'E-mail ještě nebyl potvrzen. Zkontrolujte schránku.',
    };
    return map[msg] || msg;
  }

  function getSession() { return session; }
  function getProfile() { return profile; }
  function isLoggedIn() { return !!session && !!profile; }
  function getAuthHeader() {
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  }
  function canSeeTab(tabName) {
    if (!profile) return false;
    return (TAB_PERMISSIONS[profile.role] || []).includes(tabName);
  }
  function roleLabel(role) {
    return ROLE_LABELS[role || (profile && profile.role)] || role;
  }

  return {
    init, signIn, signUp, signOut, loadProfile,
    getSession, getProfile, isLoggedIn, getAuthHeader, canSeeTab, roleLabel,
    ROLE_LABELS, TAB_PERMISSIONS,
  };
})();

/* ═══════════════════════════════════════════════════════════
   window.SYNC — org-id accessor only.
   Supabase is the single source of truth for all app data; there is
   no client-side push/pull module anymore (everything goes straight
   through app.js's dbPost/dbPut/dbDelete + refreshAllFromCloud()).
   This object exists only so the many call sites across app.js and
   import.js that read window.SYNC.ORG_ID keep working, now backed by
   the real logged-in user's org_id instead of a hardcoded constant.
═══════════════════════════════════════════════════════════ */
window.SYNC = {
  get ORG_ID() {
    return window.AUTH?.getProfile()?.org_id || null;
  },
};
