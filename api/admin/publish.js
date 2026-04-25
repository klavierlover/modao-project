const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireRole } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const auth = await requireRole(req, ['owner', 'editor']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const body = await readJsonBody(req);
    const moduleKey = body.moduleKey;
    const notes = body.notes || '';
    if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'moduleKey is required' });

    const supabase = getSupabaseAdmin();
    const [{ data: blocks, error: blocksErr }, { data: articles, error: articleErr }] = await Promise.all([
      supabase.from('content_blocks').select('*').eq('module_key', moduleKey).eq('status', 'draft'),
      supabase.from('articles').select('*').eq('module_key', moduleKey).eq('status', 'draft').order('sort_order', { ascending: true }),
    ]);
    if (blocksErr) throw blocksErr;
    if (articleErr) throw articleErr;

    const snapshot = {
      moduleKey,
      blocks: blocks || [],
      articles: articles || [],
      publishedAt: new Date().toISOString(),
    };

    const { data: inserted, error: versionErr } = await supabase
      .from('publish_versions')
      .insert({
        module_key: moduleKey,
        status: 'published',
        notes,
        snapshot,
        published_by: auth.user.id,
      })
      .select('id')
      .single();
    if (versionErr) throw versionErr;

    const version = inserted.id;
    await Promise.all([
      supabase.from('content_blocks')
        .update({ published_version: version, updated_at: new Date().toISOString() })
        .eq('module_key', moduleKey)
        .eq('status', 'draft'),
      supabase.from('articles')
        .update({ published_version: version, updated_at: new Date().toISOString() })
        .eq('module_key', moduleKey)
        .eq('status', 'draft'),
    ]);

    return sendJson(res, 200, { ok: true, moduleKey, version });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Publish failed' });
  }
};
