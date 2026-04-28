const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEFAULT_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';

// 简单内存速率限制：每用户每分钟最多 20 次请求
// 注意：Vercel 多实例时各实例独立计数，属于尽力而为的限制
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;
const rateLimitMap = new Map(); // userId -> { count, windowStart }

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    // 鉴权：只有已登录用户才能调用，防止 DeepSeek API 额度被滥用
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });

    // 速率限制
    if (!checkRateLimit(auth.user.id)) {
      res.setHeader('Retry-After', '60');
      return sendJson(res, 429, { ok: false, error: 'Too many requests, please wait a moment' });
    }

    const key = process.env.DEEPSEEK_API_KEY || '';
    if (!key) return sendJson(res, 500, { ok: false, error: 'Missing DEEPSEEK_API_KEY' });
    const body = await readJsonBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return sendJson(res, 400, { ok: false, error: 'messages is required' });
    // 限制 messages 数量，防止超大上下文
    if (messages.length > 40) return sendJson(res, 400, { ok: false, error: 'Too many messages (max 40)' });
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
