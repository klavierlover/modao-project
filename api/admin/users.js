const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireRole } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('app_users_profile')
        .select('id, email, role, status, display_name, last_seen_at, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return sendJson(res, 200, { ok: true, users: data || [] });
    }

    if (req.method === 'PATCH') {
      if (!['owner', 'editor'].includes(auth.profile.role)) {
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can update users' });
      }
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const patch = {};
      if (body.role !== undefined) {
        if (!['owner', 'editor', 'viewer'].includes(body.role)) {
          return sendJson(res, 400, { ok: false, error: 'role must be owner, editor, or viewer' });
        }
        // 只有 owner 才能提升角色至 owner
        if (body.role === 'owner' && auth.profile.role !== 'owner') {
          return sendJson(res, 403, { ok: false, error: 'Only owner can assign owner role' });
        }
        patch.role = body.role;
      }
      if (body.status !== undefined) {
        if (!['active', 'disabled'].includes(body.status)) {
          return sendJson(res, 400, { ok: false, error: 'status must be active or disabled' });
        }
        patch.status = body.status;
      }
      if (typeof body.display_name === 'string') patch.display_name = body.display_name.slice(0, 100);
      if (!Object.keys(patch).length) return sendJson(res, 400, { ok: false, error: 'No valid fields to update' });
      patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from('app_users_profile').update(patch).eq('id', body.id);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
