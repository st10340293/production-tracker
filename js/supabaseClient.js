// ============================================================
// Supabase client — fill in your project URL + anon key below.
// Get these from: Supabase dashboard → Project Settings → API
// ============================================================
const SUPABASE_URL = 'https://rtslcnuierkzdzcssdzq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KgJwOiqYxns9XuqgiwRl3A_VoPDLoTu';

// Loaded via CDN script tag in each HTML page (see <head>).
// Exposes a single shared client instance on window.sb
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
