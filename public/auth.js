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
  };

  // Tabs each role is allowed to see. Admin and vedouci see everything;
  // kuchařka focuses on daily kitchen operations, not financial/compliance
  // reporting or settings (matches the Sprint 2 role definition).
  const TAB_PERMISSIONS = {
    admin:    ['menu', 'attendance', 'offers', 'warehouse', 'finance', 'norms', 'settings'],
    vedouci:  ['menu', 'attendance', 'offers', 'warehouse', 'finance', 'norms', 'settings'],
    kucharka: ['menu', 'attendance', 'offers', 'warehouse'],
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
