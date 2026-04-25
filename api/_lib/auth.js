const { getSupabaseAdmin, getSupabaseAnon } = require('./supabase');
const { parseBearerToken } = require('./http');

async function requireRole(req, roles = ['owner', 'editor']) {
  const token = parseBearerToken(req);
  if (!token) return { ok: false, status: 401, message: 'Missing bearer token' };

  const anon = getSupabaseAnon();
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, message: 'Invalid token' };
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileErr } = await admin
    .from('app_users_profile')
    .select('id, role, status')
    .eq('id', userData.user.id)
    .single();

  if (profileErr || !profile) {
    return { ok: false, status: 403, message: 'Profile not found' };
  }
  if (profile.status !== 'active') {
    return { ok: false, status: 403, message: 'Account disabled' };
  }
  if (!roles.includes(profile.role)) {
    return { ok: false, status: 403, message: 'Insufficient role' };
  }

  return { ok: true, user: userData.user, profile };
}

module.exports = {
  requireRole,
};
