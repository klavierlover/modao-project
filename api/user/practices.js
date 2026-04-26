const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const content = String(body.content || '').trim();
      if (!content) return sendJson(res, 400, { ok: false, error: 'content is required' });
      const row = {
        user_id: userId,
        content,
        progress: 0,
        status: 'active',
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('user_practice_tasks')
        .insert(row)
        .select('*')
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, practice: data });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const id = body.id;
      if (!id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const patch = { updated_at: new Date().toISOString() };
      if (body.content !== undefined) patch.content = String(body.content || '').trim();
      if (body.progress !== undefined) patch.progress = Math.max(0, Number(body.progress || 0));
      if (body.status !== undefined) patch.status = String(body.status);
      const { data, error } = await supabase
        .from('user_practice_tasks')
        .update(patch)
        .eq('id', id)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, practice: data });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://localhost');
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const { error } = await supabase
        .from('user_practice_tasks')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
