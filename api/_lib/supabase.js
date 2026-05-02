const { createClient } = require('@supabase/supabase-js');

function env(name) {
  return process.env[name] || '';
}

// 模块级单例缓存，避免每次请求重复创建客户端连接
let _adminClient = null;
let _anonClient = null;

function getSupabaseAdmin() {
  if (_adminClient) return _adminClient;
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  _adminClient = createClient(url, key, { auth: { persistSession: false } });
  return _adminClient;
}

function getSupabaseAnon() {
  if (_anonClient) return _anonClient;
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  _anonClient = createClient(url, key, { auth: { persistSession: false } });
  return _anonClient;
}

module.exports = {
  getSupabaseAdmin,
  getSupabaseAnon,
};
