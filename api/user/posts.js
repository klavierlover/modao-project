const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireRole } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  const supabase = getSupabaseAdmin();

  /* ── GET: 读取用户发帖（公开） ── */
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const moduleKey = url.searchParams.get('module') || 'forum';
      const limit  = Math.min(Number(url.searchParams.get('limit')  || 50), 100);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0),  0);

      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('module_key', moduleKey)
        .eq('status', 'published')
        .contains('tags', ['ugc'])
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return sendJson(res, 200, { ok: true, posts: data || [] });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  /* ── POST: 发布新帖（需要登录） ── */
  if (req.method === 'POST') {
    try {
      // viewer 及以上权限都可以发帖
      const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
      if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });

      const body = await readJsonBody(req);
      const { title, section, content, cover_url, post_type = 'forum' } = body;

      if (!title?.trim()) {
        return sendJson(res, 400, { ok: false, error: '标题不能为空' });
      }

      const authorName = auth.profile?.display_name
        || auth.user.email?.split('@')[0]
        || '同修';

      // module_key 映射
      const moduleKeyMap = {
        forum:      'forum',
        recipe:     'user-recipe',
        pilgrimage: 'user-pilgrimage',
        restaurant: 'user-restaurant',
      };
      const moduleKey = moduleKeyMap[post_type] || 'forum';

      // 生成唯一 slug
      const slug = `ugc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const row = {
        module_key:  moduleKey,
        slug,
        title:       title.trim(),
        summary:     (content || '').trim().slice(0, 300),
        cover_url:   cover_url || '',
        content_md:  `---\nauthor: ${authorName}\nsection: ${section || '同修分享'}\n---\n\n${content || ''}`,
        tags:        ['ugc', section || '同修分享', authorName],
        sort_order:  0,
        status:      'published',   // 直接上线，无需审核
        updated_by:  auth.user.id,
        updated_at:  new Date().toISOString(),
      };

      const { error } = await supabase.from('articles').insert(row);
      if (error) throw error;

      return sendJson(res, 200, { ok: true, slug, author: authorName });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || 'Post failed' });
    }
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
};
