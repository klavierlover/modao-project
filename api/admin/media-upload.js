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
    const moduleKey = body.moduleKey || 'common';
    const fileName = body.fileName || `asset-${Date.now()}.png`;
    const mimeType = body.mimeType || 'image/png';
    const base64Data = body.base64Data || '';
    if (!base64Data) return sendJson(res, 400, { ok: false, error: 'base64Data is required' });

    const clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(clean, 'base64');
    const path = `${moduleKey}/${Date.now()}-${fileName}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'modao-assets';

    const supabase = getSupabaseAdmin();
    const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { error: dbErr } = await supabase.from('media_assets').insert({
      module_key: moduleKey,
      file_name: fileName,
      file_path: path,
      public_url: publicUrl,
      mime_type: mimeType,
      size_bytes: buffer.length,
      created_by: auth.user.id,
    });
    if (dbErr) throw dbErr;

    return sendJson(res, 200, { ok: true, publicUrl, path });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Upload failed' });
  }
};
