const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function getSupabaseAdmin() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getSupabaseAnon() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = {
  getSupabaseAdmin,
  getSupabaseAnon,
};
