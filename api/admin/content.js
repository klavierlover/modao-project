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
      const url = new URL(req.url, 'http://localhost');
      const moduleKey = url.searchParams.get('module');
      if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'module is required' });

      const { data: draft, error: draftErr } = await supabase
        .from('content_blocks')
        .select('*')
        .eq('module_key', moduleKey)
        .eq('status', 'draft');
      if (draftErr) throw draftErr;

      const { data: articles, error: articleErr } = await supabase
        .from('articles')
        .select('*')
        .eq('module_key', moduleKey)
        .eq('status', 'draft')
        .order('sort_order', { ascending: true })
        .limit(200);
      if (articleErr) throw articleErr;

      return sendJson(res, 200, { ok: true, module: moduleKey, blocks: draft || [], articles: articles || [] });
    }

    if (req.method === 'PUT') {
      if (!['owner', 'editor'].includes(auth.profile.role)) {
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can modify content' });
      }
      const body = await readJsonBody(req);
      const moduleKey = body.moduleKey;
      if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'moduleKey is required' });
      const payload = body.payload || {};
      const blockKey = body.blockKey || 'module_root';

      const { error } = await supabase
        .from('content_blocks')
        .upsert({
          module_key: moduleKey,
          block_key: blockKey,
          payload,
          title: body.title || null,
          body: body.body || null,
          status: 'draft',
          updated_by: auth.user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'module_key,block_key,status' });
      if (error) throw error;

      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
