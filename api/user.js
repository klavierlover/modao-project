/**
 * 合并后的 User 路由分发器
 * 将原来 5 个独立 Function 合并为 1 个，节省 Vercel Hobby 配额
 *
 * 路由规则（vercel.json rewrite 将 /api/user/:path* → /api/user）:
 *   POST      /api/user/checkin    → handleCheckin
 *   GET/POST  /api/user/posts      → handlePosts
 *   POST/PATCH/DELETE /api/user/practices → handlePractices
 *   GET/PUT   /api/user/settings   → handleSettings
 *   POST      /api/user/upload     → handleUpload
 */

const { getSupabaseAdmin } = require('./_lib/supabase');
const { cors, sendJson, readJsonBody } = require('./_lib/http');
const { requireRole, requireUser } = require('./_lib/auth');

/* ─── 子路由提取 ─── */
function getSubRoute(req) {
  const url = new URL(req.url, 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);
  return segments[2] || '';
}

/* ══════════════════════════════════════════
   /api/user/checkin  — POST
══════════════════════════════════════════ */
function dateStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function handleCheckin(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;
    const today = dateStr();
    const yesterday = dateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const { data: profile } = await supabase.from('user_companion_profiles').select('*').eq('user_id', userId).maybeSingle();
    const prevDate = profile?.last_checkin_date || null;
    const prevStreak = Number(profile?.checkin_streak || 0);
    let nextStreak = 1;
    let alreadyCheckedIn = false;
    if (prevDate === today) { nextStreak = prevStreak || 1; alreadyCheckedIn = true; }
    else if (prevDate === yesterday) { nextStreak = prevStreak + 1; }

    const { error } = await supabase.from('user_companion_profiles').upsert({
      user_id: userId,
      companion_id: profile?.companion_id || 'hui-ming',
      onboarding_completed: profile?.onboarding_completed || false,
      onboarding_skipped: profile?.onboarding_skipped || false,
      checkin_streak: nextStreak,
      last_checkin_date: today,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return sendJson(res, 200, { ok: true, streak: nextStreak, alreadyCheckedIn });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
}

/* ══════════════════════════════════════════
   /api/user/posts  — GET / POST
══════════════════════════════════════════ */
async function handlePosts(req, res) {
  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const moduleKey = url.searchParams.get('module') || 'forum';
      const limit  = Math.min(Number(url.searchParams.get('limit') || 50), 100);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
      const { data, error } = await supabase.from('articles').select('*')
        .eq('module_key', moduleKey).eq('status', 'published').contains('tags', ['ugc'])
        .order('updated_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      return sendJson(res, 200, { ok: true, posts: data || [] });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
      if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });

      const body = await readJsonBody(req);
      const { title, section, content, cover_url, post_type = 'forum' } = body;
      if (!title?.trim()) return sendJson(res, 400, { ok: false, error: '标题不能为空' });

      const authorName = auth.profile?.display_name || auth.user.email?.split('@')[0] || '同修';
      const moduleKeyMap = { forum: 'forum', recipe: 'user-recipe', pilgrimage: 'user-pilgrimage', restaurant: 'user-restaurant' };
      const moduleKey = moduleKeyMap[post_type] || 'forum';
      const slug = `ugc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const row = {
        module_key: moduleKey, slug, title: title.trim(),
        summary: (content || '').trim().slice(0, 300),
        cover_url: cover_url || '',
        content_md: `---\nauthor: ${authorName}\nsection: ${section || '同修分享'}\n---\n\n${content || ''}`,
        tags: ['ugc', section || '同修分享', authorName],
        sort_order: 0, status: 'published',
        updated_by: auth.user.id, updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('articles').insert(row);
      if (error) throw error;
      return sendJson(res, 200, { ok: true, slug, author: authorName });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || 'Post failed' });
    }
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}

/* ══════════════════════════════════════════
   /api/user/practices  — POST / PATCH / DELETE
══════════════════════════════════════════ */
async function handlePractices(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const content = String(body.content || '').trim();
      if (!content) return sendJson(res, 400, { ok: false, error: 'content is required' });
      if (content.length > 500) return sendJson(res, 400, { ok: false, error: 'content must be ≤500 characters' });
      const { data, error } = await supabase.from('user_practice_tasks')
        .insert({ user_id: userId, content, progress: 0, status: 'active', updated_at: new Date().toISOString() })
        .select('*').single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, practice: data });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const patch = { updated_at: new Date().toISOString() };
      if (body.content !== undefined) {
        const c = String(body.content || '').trim();
        if (c.length > 500) return sendJson(res, 400, { ok: false, error: 'content must be ≤500 characters' });
        patch.content = c;
      }
      if (body.progress !== undefined) patch.progress = Math.min(Math.max(0, Number(body.progress || 0)), 100000);
      if (body.status !== undefined) {
        if (!['active', 'archived'].includes(body.status))
          return sendJson(res, 400, { ok: false, error: 'status must be active or archived' });
        patch.status = body.status;
      }
      const { data, error } = await supabase.from('user_practice_tasks').update(patch)
        .eq('id', body.id).eq('user_id', userId).select('*').single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, practice: data });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://localhost');
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const { error } = await supabase.from('user_practice_tasks').delete().eq('id', id).eq('user_id', userId);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
}

/* ══════════════════════════════════════════
   /api/user/settings  — GET / PUT
══════════════════════════════════════════ */
async function handleSettings(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;

    if (req.method === 'GET') {
      const [{ data: profile, error: profileErr }, { data: practices, error: practiceErr }] = await Promise.all([
        supabase.from('user_companion_profiles').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('user_practice_tasks').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      ]);
      if (profileErr) throw profileErr;
      if (practiceErr) throw practiceErr;
      return sendJson(res, 200, { ok: true, profile: profile || null, practices: practices || [] });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const companionId = String(body.companion_id || '').trim();
      if (!companionId) return sendJson(res, 400, { ok: false, error: 'companion_id is required' });

      const { data: existingProfile } = await supabase.from('user_companion_profiles').select('*').eq('user_id', userId).maybeSingle();
      const { error } = await supabase.from('user_companion_profiles').upsert({
        user_id: userId,
        companion_id: companionId,
        onboarding_skipped: Boolean(body.onboarding_skipped),
        onboarding_completed: Boolean(body.onboarding_completed),
        checkin_streak: body.checkin_streak === undefined ? Number(existingProfile?.checkin_streak || 0) : Number(body.checkin_streak || 0),
        last_checkin_date: body.last_checkin_date === undefined ? (existingProfile?.last_checkin_date || null) : (body.last_checkin_date || null),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
}

/* ══════════════════════════════════════════
   /api/user/upload  — POST
══════════════════════════════════════════ */
async function handleUpload(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  try {
    const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });

    const body = await readJsonBody(req);
    const { fileName = `img-${Date.now()}.jpg`, mimeType = 'image/jpeg', base64Data = '' } = body;
    if (!base64Data) return sendJson(res, 400, { ok: false, error: 'base64Data is required' });

    const ALLOWED_MIME = new Set(['image/jpeg','image/png','image/gif','image/webp','image/avif']);
    if (!ALLOWED_MIME.has(mimeType)) return sendJson(res, 400, { ok: false, error: 'Only images allowed' });

    const clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > 5 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'File must be ≤5 MB' });

    const path = `ugc/${auth.user.id}/${Date.now()}-${fileName}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'modao-assets';
    const supabase = getSupabaseAdmin();

    const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: mimeType, upsert: false });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    return sendJson(res, 200, { ok: true, publicUrl: pub.publicUrl });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Upload failed' });
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
    case 'checkin':   return handleCheckin(req, res);
    case 'posts':     return handlePosts(req, res);
    case 'practices': return handlePractices(req, res);
    case 'settings':  return handleSettings(req, res);
    case 'upload':    return handleUpload(req, res);
    default:          return sendJson(res, 404, { ok: false, error: `Unknown user route: ${sub}` });
  }
};
