const { cors, sendJson } = require('../_lib/http');
const { requireRole } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  const auth = await requireRole(req, ['owner', 'editor', 'viewer']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
  return sendJson(res, 200, { ok: true, user: auth.user, profile: auth.profile });
};
