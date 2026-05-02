const { getSupabaseAdmin, getSupabaseAnon } = require('./supabase');
const { parseBearerToken } = require('./http');

async function requireUser(req) {
  const token = parseBearerToken(req);
  if (!token) return { ok: false, status: 401, message: 'Missing bearer token' };
  const anon = getSupabaseAnon();
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, message: 'Invalid token' };
  }
  return { ok: true, user: userData.user, token };
}

async function requireRole(req, roles = ['owner', 'editor']) {
  const authUser = await requireUser(req);
  if (!authUser.ok) return authUser;

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileErr } = await admin
    .from('app_users_profile')
    .select('id, role, status')
    .eq('id', authUser.user.id)
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

  return { ok: true, user: authUser.user, profile };
}

module.exports = {
  requireUser,
  requireRole,
};
