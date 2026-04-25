const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('publish_versions')
      .select('module_key, snapshot, published_at, id')
      .order('id', { ascending: false });

    if (error) throw error;
    const latestByModule = {};
    for (const row of data || []) {
      if (!latestByModule[row.module_key]) {
        latestByModule[row.module_key] = row;
      }
    }
    return sendJson(res, 200, { ok: true, modules: latestByModule });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Failed to fetch published data' });
  }
};
