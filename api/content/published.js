const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const supabase = getSupabaseAdmin();

    // 先取所有不重复的 module_key
    const { data: keys, error: keysErr } = await supabase
      .from('publish_versions')
      .select('module_key')
      .order('id', { ascending: false })
      .limit(100);
    if (keysErr) throw keysErr;

    const moduleKeys = [...new Set((keys || []).map(r => r.module_key))];

    // 每个 module 只取 id 最大（最新）的一条，避免全表扫描
    const results = await Promise.all(
      moduleKeys.map(mk =>
        supabase
          .from('publish_versions')
          .select('module_key, snapshot, published_at, id')
          .eq('module_key', mk)
          .order('id', { ascending: false })
          .limit(1)
          .single()
      )
    );

    const latestByModule = {};
    for (const { data: row } of results) {
      if (row) latestByModule[row.module_key] = row;
    }

    return sendJson(res, 200, { ok: true, modules: latestByModule });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Failed to fetch published data' });
  }
};
