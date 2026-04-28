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
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), 200);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('module_key', moduleKey)
        .eq('status', 'draft')
        .order('sort_order', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return sendJson(res, 200, { ok: true, articles: data || [], limit, offset });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      if (!['owner', 'editor'].includes(auth.profile.role)) {
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can modify articles' });
      }
      const body = await readJsonBody(req);
      const moduleKey = body.module_key;
      const slug = body.slug;
      const title = body.title;
      if (!moduleKey || !slug || !title) {
        return sendJson(res, 400, { ok: false, error: 'module_key, slug, title are required' });
      }

      const row = {
        module_key: moduleKey,
        slug,
        title,
        summary: body.summary || '',
        cover_url: body.cover_url || '',
        article_url: body.article_url || '',
        content_md: body.content_md || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        sort_order: Number(body.sort_order || 0),
        status: 'draft',
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('articles')
        .upsert(row, { onConflict: 'module_key,slug,status' });
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      if (!['owner', 'editor'].includes(auth.profile.role)) {
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can delete articles' });
      }
      const body = await readJsonBody(req);
      if (!body.module_key || !body.slug) {
        return sendJson(res, 400, { ok: false, error: 'module_key and slug are required' });
      }
      const { error } = await supabase
        .from('articles')
        .delete()
        .eq('module_key', body.module_key)
        .eq('slug', body.slug)
        .eq('status', 'draft');
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
