const { cors, sendJson, readJsonBody } = require('../_lib/http');

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEFAULT_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const key = process.env.DEEPSEEK_API_KEY || '';
    if (!key) return sendJson(res, 500, { ok: false, error: 'Missing DEEPSEEK_API_KEY' });
    const body = await readJsonBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return sendJson(res, 400, { ok: false, error: 'messages is required' });
    const model = body.model || DEFAULT_MODEL;
    const temperature = Number(body.temperature ?? 0.7);

    const resp = await fetch(DEFAULT_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: false,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return sendJson(res, resp.status, { ok: false, error: data?.error?.message || `DeepSeek HTTP ${resp.status}` });
    }
    const text = data?.choices?.[0]?.message?.content || '';
    return sendJson(res, 200, { ok: true, text: String(text).trim() });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
