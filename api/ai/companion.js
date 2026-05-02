const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEFAULT_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';

// 速率限制：登录用户每分钟 20 次，游客（IP）每分钟 5 次
const RATE_LIMIT_USER = 20;
const RATE_LIMIT_GUEST = 5;
const RATE_WINDOW_MS = 60 * 1000;
const rateLimitMap = new Map(); // key -> { count, windowStart }

function checkRateLimit(key, limit) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    // 尝试获取登录用户，未登录则以 IP 兜底（游客也能用慧明）
    const auth = await requireUser(req);
    const isLoggedIn = auth.ok;
    const rateLimitKey = isLoggedIn ? `user:${auth.user.id}` : `ip:${getClientIp(req)}`;
    const rateLimit = isLoggedIn ? RATE_LIMIT_USER : RATE_LIMIT_GUEST;

    if (!checkRateLimit(rateLimitKey, rateLimit)) {
      res.setHeader('Retry-After', '60');
      return sendJson(res, 429, { ok: false, error: '请求过于频繁，请稍候再试' });
    }

    const key = process.env.DEEPSEEK_API_KEY || '';
    if (!key) return sendJson(res, 500, { ok: false, error: 'Missing DEEPSEEK_API_KEY' });

    const body = await readJsonBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return sendJson(res, 400, { ok: false, error: 'messages is required' });
    if (messages.length > 40) return sendJson(res, 400, { ok: false, error: 'Too many messages (max 40)' });

    const model = body.model || DEFAULT_MODEL;
    const temperature = Number(body.temperature ?? 0.7);

    const resp = await fetch(DEFAULT_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, temperature, stream: false }),
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
