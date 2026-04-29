/**
 * 合并后的 Admin 路由分发器
 * 将原来 7 个独立 Function 合并为 1 个，节省 Vercel Hobby 配额
 *
 * 路由规则（vercel.json rewrite 将 /api/admin/:path* → /api/admin）:
 *   GET/PUT   /api/admin/profile       → handleProfile
 *   GET/PUT   /api/admin/content       → handleContent
 *   GET/POST/PUT/DELETE /api/admin/articles  → handleArticles
 *   POST      /api/admin/media-upload  → handleMediaUpload
 *   GET/POST  /api/admin/publish       → handlePublish
 *   GET/PATCH /api/admin/users         → handleUsers
 *   POST      /api/admin/seed          → handleSeed
 */

const { getSupabaseAdmin } = require('./_lib/supabase');
const { cors, sendJson, readJsonBody } = require('./_lib/http');
const { requireRole } = require('./_lib/auth');
const { PILGRIMAGE_SITES, WUHAN_RESTAURANTS, VEGAN_RECIPES, FORUM_POSTS } = require('./_lib/seed-data');

/* ─── 子路由提取 ─── */
function getSubRoute(req) {
  const url = new URL(req.url, 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);
  // pathname 形如 /api/admin/articles 或 /api/admin/media-upload
  // segments: ['api','admin','articles']
  return segments[2] || '';
}

/* ══════════════════════════════════════════
   /api/admin/profile  — GET
══════════════════════════════════════════ */
async function handleProfile(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
  return sendJson(res, 200, { ok: true, user: auth.user, profile: auth.profile });
}

/* ══════════════════════════════════════════
   /api/admin/content  — GET / PUT
══════════════════════════════════════════ */
async function handleContent(req, res) {
  try {
    const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const moduleKey = url.searchParams.get('module');
      if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'module is required' });

      const [{ data: draft, error: draftErr }, { data: articles, error: articleErr }] = await Promise.all([
        supabase.from('content_blocks').select('*').eq('module_key', moduleKey).eq('status', 'draft'),
        supabase.from('articles').select('*').eq('module_key', moduleKey).eq('status', 'draft').order('sort_order', { ascending: true }).limit(200),
      ]);
      if (draftErr) throw draftErr;
      if (articleErr) throw articleErr;
      return sendJson(res, 200, { ok: true, module: moduleKey, blocks: draft || [], articles: articles || [] });
    }

    if (req.method === 'PUT') {
      if (!['owner', 'editor'].includes(auth.profile.role))
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can modify content' });
      const body = await readJsonBody(req);
      const moduleKey = body.moduleKey;
      if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'moduleKey is required' });
      const { error } = await supabase.from('content_blocks').upsert({
        module_key: moduleKey,
        block_key: body.blockKey || 'module_root',
        payload: body.payload || {},
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
}

/* ══════════════════════════════════════════
   /api/admin/articles  — GET / POST / PUT / DELETE
══════════════════════════════════════════ */
async function handleArticles(req, res) {
  try {
    const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const moduleKey = url.searchParams.get('module');
      const all = url.searchParams.get('all') === '1';
      const limit  = Math.min(Number(url.searchParams.get('limit') || 200), 500);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
      if (!moduleKey && !all) return sendJson(res, 400, { ok: false, error: 'module or all=1 is required' });
      let query = supabase.from('articles').select('*').eq('status', 'draft').order('sort_order', { ascending: true }).range(offset, offset + limit - 1);
      if (moduleKey) query = query.eq('module_key', moduleKey);
      const { data, error } = await query;
      if (error) throw error;
      return sendJson(res, 200, { ok: true, articles: data || [], limit, offset });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      if (!['owner', 'editor'].includes(auth.profile.role))
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can modify articles' });
      const body = await readJsonBody(req);
      if (!body.module_key || !body.slug || !body.title)
        return sendJson(res, 400, { ok: false, error: 'module_key, slug, title are required' });
      const row = {
        module_key: body.module_key,
        slug: body.slug,
        title: body.title,
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
      const { error } = await supabase.from('articles').upsert(row, { onConflict: 'module_key,slug,status' });
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      if (!['owner', 'editor'].includes(auth.profile.role))
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can delete articles' });
      const body = await readJsonBody(req);
      if (!body.module_key || !body.slug)
        return sendJson(res, 400, { ok: false, error: 'module_key and slug are required' });
      const { error } = await supabase.from('articles').delete().eq('module_key', body.module_key).eq('slug', body.slug).eq('status', 'draft');
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
}

/* ══════════════════════════════════════════
   /api/admin/media-upload  — POST
══════════════════════════════════════════ */
async function handleMediaUpload(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  try {
    const auth = await requireRole(req, ['owner', 'editor']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const body = await readJsonBody(req);
    const { moduleKey = 'common', fileName = `asset-${Date.now()}.png`, mimeType = 'image/png', base64Data = '' } = body;
    if (!base64Data) return sendJson(res, 400, { ok: false, error: 'base64Data is required' });

    const ALLOWED_MIME = new Set(['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','image/avif','video/mp4','video/webm']);
    if (!ALLOWED_MIME.has(mimeType)) return sendJson(res, 400, { ok: false, error: `Unsupported file type: ${mimeType}` });

    const clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > 5 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'File size must be ≤5 MB' });

    const path = `${moduleKey}/${Date.now()}-${fileName}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'modao-assets';
    const supabase = getSupabaseAdmin();

    const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: mimeType, upsert: false });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    const { error: dbErr } = await supabase.from('media_assets').insert({
      module_key: moduleKey, file_name: fileName, file_path: path,
      public_url: pub.publicUrl, mime_type: mimeType, size_bytes: buffer.length, created_by: auth.user.id,
    });
    if (dbErr) throw dbErr;
    return sendJson(res, 200, { ok: true, publicUrl: pub.publicUrl, path });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Upload failed' });
  }
}

/* ══════════════════════════════════════════
   /api/admin/publish  — GET / POST
══════════════════════════════════════════ */
async function handlePublish(req, res) {
  if (req.method === 'GET') {
    try {
      const auth = await requireRole(req, ['owner', 'editor']);
      if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
      const url = new URL(req.url, 'http://localhost');
      const moduleKey = url.searchParams.get('module');
      if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'module param required' });
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.from('publish_versions')
        .select('id, published_at: created_at, notes').eq('module_key', moduleKey).eq('status', 'published')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return sendJson(res, 200, { ok: true, version: null });
      return sendJson(res, 200, { ok: true, version: data.id, published_at: data.published_at, notes: data.notes });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const auth = await requireRole(req, ['owner', 'editor']);
      if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
      const body = await readJsonBody(req);
      const { moduleKey, notes = '' } = body;
      if (!moduleKey) return sendJson(res, 400, { ok: false, error: 'moduleKey is required' });

      const supabase = getSupabaseAdmin();
      const [{ data: blocks, error: blocksErr }, { data: articles, error: articleErr }] = await Promise.all([
        supabase.from('content_blocks').select('*').eq('module_key', moduleKey).eq('status', 'draft'),
        supabase.from('articles').select('*').eq('module_key', moduleKey).eq('status', 'draft').order('sort_order', { ascending: true }),
      ]);
      if (blocksErr) throw blocksErr;
      if (articleErr) throw articleErr;

      const snapshot = { moduleKey, blocks: blocks || [], articles: articles || [], publishedAt: new Date().toISOString() };
      const { data: inserted, error: versionErr } = await supabase.from('publish_versions')
        .insert({ module_key: moduleKey, status: 'published', notes, snapshot, published_by: auth.user.id })
        .select('id').single();
      if (versionErr) throw versionErr;

      const version = inserted.id;
      await Promise.all([
        supabase.from('content_blocks').update({ published_version: version, updated_at: new Date().toISOString() }).eq('module_key', moduleKey).eq('status', 'draft'),
        supabase.from('articles').update({ published_version: version, updated_at: new Date().toISOString() }).eq('module_key', moduleKey).eq('status', 'draft'),
      ]);
      return sendJson(res, 200, { ok: true, moduleKey, version });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || 'Publish failed' });
    }
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}

/* ══════════════════════════════════════════
   /api/admin/users  — GET / PATCH
══════════════════════════════════════════ */
async function handleUsers(req, res) {
  try {
    const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const { data, error } = await supabase.from('app_users_profile')
        .select('id, email, role, status, display_name, last_seen_at, created_at, updated_at')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return sendJson(res, 200, { ok: true, users: data || [] });
    }

    if (req.method === 'PATCH') {
      if (!['owner', 'editor'].includes(auth.profile.role))
        return sendJson(res, 403, { ok: false, error: 'Only owner/editor can update users' });
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const patch = {};
      if (body.role !== undefined) {
        if (!['owner', 'editor', 'viewer'].includes(body.role))
          return sendJson(res, 400, { ok: false, error: 'role must be owner, editor, or viewer' });
        if (body.role === 'owner' && auth.profile.role !== 'owner')
          return sendJson(res, 403, { ok: false, error: 'Only owner can assign owner role' });
        patch.role = body.role;
      }
      if (body.status !== undefined) {
        if (!['active', 'disabled'].includes(body.status))
          return sendJson(res, 400, { ok: false, error: 'status must be active or disabled' });
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
}

/* ══════════════════════════════════════════
   /api/admin/seed  — POST（一键导入初始数据）
══════════════════════════════════════════ */
async function publishModule(supabase, moduleKey, userId, notes) {
  const [{ data: blocks }, { data: articles }] = await Promise.all([
    supabase.from('content_blocks').select('*').eq('module_key', moduleKey).eq('status', 'draft'),
    supabase.from('articles').select('*').eq('module_key', moduleKey).eq('status', 'draft').order('sort_order', { ascending: true }),
  ]);
  const snapshot = { moduleKey, blocks: blocks || [], articles: articles || [], publishedAt: new Date().toISOString() };
  const { data: inserted, error } = await supabase.from('publish_versions')
    .insert({ module_key: moduleKey, status: 'published', notes, snapshot, published_by: userId })
    .select('id').single();
  if (error) throw new Error(`publish_versions[${moduleKey}] 失败: ${error.message}`);
  const version = inserted.id;
  await Promise.all([
    supabase.from('content_blocks').update({ published_version: version, updated_at: new Date().toISOString() }).eq('module_key', moduleKey).eq('status', 'draft'),
    supabase.from('articles').update({ published_version: version, updated_at: new Date().toISOString() }).eq('module_key', moduleKey).eq('status', 'draft'),
  ]);
  return version;
}

async function handleSeed(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  try {
    const auth = await requireRole(req, ['owner']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase.from('content_blocks').select('id')
      .eq('module_key', 'pilgrimage').eq('block_key', 'module_root').eq('status', 'draft').maybeSingle();
    if (existing) return sendJson(res, 409, { ok: false, error: '后台已存在朝圣数据，无需重复导入。若需强制重置，请直接在 Supabase 控制台操作。' });

    const now = new Date().toISOString();
    const userId = auth.user.id;
    const notes = '初始数据导入（从前端硬编码迁移）';

    const { error: pilgErr } = await supabase.from('content_blocks').upsert({
      module_key: 'pilgrimage', block_key: 'module_root',
      payload: { sites: PILGRIMAGE_SITES }, status: 'draft', updated_by: userId, updated_at: now,
    }, { onConflict: 'module_key,block_key,status' });
    if (pilgErr) throw new Error('朝圣数据写入失败: ' + pilgErr.message);

    const { error: veganErr } = await supabase.from('content_blocks').upsert({
      module_key: 'vegan', block_key: 'module_root',
      payload: { restaurants: WUHAN_RESTAURANTS, recipes: VEGAN_RECIPES }, status: 'draft', updated_by: userId, updated_at: now,
    }, { onConflict: 'module_key,block_key,status' });
    if (veganErr) throw new Error('素食数据写入失败: ' + veganErr.message);

    const forumArticles = FORUM_POSTS.map(post => ({
      module_key: 'forum', slug: post.slug, title: post.title, summary: post.excerpt,
      cover_url: post.cover, tags: [post.section], sort_order: post.sort, status: 'draft',
      updated_by: userId, updated_at: now,
      content_md: `# ${post.title}\n\n**作者：** ${post.author}  \n**版块：** ${post.section}\n\n${post.excerpt}`,
    }));
    const { error: forumErr } = await supabase.from('articles').upsert(forumArticles, { onConflict: 'module_key,slug,status' });
    if (forumErr) throw new Error('论坛帖子写入失败: ' + forumErr.message);

    await publishModule(supabase, 'pilgrimage', userId, notes);
    await publishModule(supabase, 'vegan', userId, notes);
    await publishModule(supabase, 'forum', userId, notes);

    return sendJson(res, 200, {
      ok: true,
      message: `成功导入并发布：${PILGRIMAGE_SITES.length} 个朝圣地点、${WUHAN_RESTAURANTS.length} 家素食餐厅、${VEGAN_RECIPES.length} 个菜谱、${FORUM_POSTS.length} 条论坛帖子`,
      counts: { sites: PILGRIMAGE_SITES.length, restaurants: WUHAN_RESTAURANTS.length, recipes: VEGAN_RECIPES.length, forum: FORUM_POSTS.length },
    });
  } catch (err) {
    console.error('[seed] error:', err);
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected error' });
  }
}

/* ══════════════════════════════════════════
   主入口 — 路由分发
══════════════════════════════════════════ */
module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  const sub = getSubRoute(req);
  switch (sub) {
    case 'profile':      return handleProfile(req, res);
    case 'content':      return handleContent(req, res);
    case 'articles':     return handleArticles(req, res);
    case 'media-upload': return handleMediaUpload(req, res);
    case 'publish':      return handlePublish(req, res);
    case 'users':        return handleUsers(req, res);
    case 'seed':         return handleSeed(req, res);
    default:             return sendJson(res, 404, { ok: false, error: `Unknown admin route: ${sub}` });
  }
};
