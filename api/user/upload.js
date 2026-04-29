const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireRole } = require('../_lib/auth');

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });

    const body = await readJsonBody(req);
    const { fileName = `img-${Date.now()}.jpg`, mimeType = 'image/jpeg', base64Data = '' } = body;

    if (!base64Data) return sendJson(res, 400, { ok: false, error: 'base64Data is required' });
    if (!ALLOWED_MIME.has(mimeType)) return sendJson(res, 400, { ok: false, error: 'Only images allowed' });

    const clean  = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > MAX_BYTES) return sendJson(res, 400, { ok: false, error: 'File must be ≤5 MB' });

    const path   = `ugc/${auth.user.id}/${Date.now()}-${fileName}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'modao-assets';
    const supabase = getSupabaseAdmin();

    const { error: uploadErr } = await supabase.storage
      .from(bucket).upload(path, buffer, { contentType: mimeType, upsert: false });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    return sendJson(res, 200, { ok: true, publicUrl: pub.publicUrl });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Upload failed' });
  }
};
