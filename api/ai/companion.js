const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEFAULT_DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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

/**
 * 将 OpenAI 格式的 messages 转换为 Gemini contents 格式
 * system 消息提取为 systemInstruction
 */
function toGeminiContents(messages) {
  const systemParts = [];
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push({ text: msg.content || '' });
    } else {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: msg.content || '' }] });
    }
  }

  return { systemParts, contents };
}

/**
 * 调用 Gemini API，返回文本字符串（失败时 throw）
 */
async function callGemini(messages, temperature, apiKey) {
  const { systemParts, contents } = toGeminiContents(messages);
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents,
    generationConfig: { temperature },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: systemParts };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errMsg = data?.error?.message || `Gemini HTTP ${resp.status}`;
    throw new Error(errMsg);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Gemini 返回格式异常');
  return text.trim();
}

/**
 * 调用 DeepSeek API，返回文本字符串（失败时 throw）
 */
async function callDeepSeek(messages, temperature, apiKey) {
  const model = DEFAULT_DEEPSEEK_MODEL;
  const resp = await fetch(DEFAULT_DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || `DeepSeek HTTP ${resp.status}`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('DeepSeek 返回格式异常');
  return text.trim();
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

    const body = await readJsonBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return sendJson(res, 400, { ok: false, error: 'messages is required' });
    if (messages.length > 40) return sendJson(res, 400, { ok: false, error: 'Too many messages (max 40)' });

    const temperature = Number(body.temperature ?? 0.7);

    const geminiKey = process.env.GEMINI_API_KEY || '';
    const deepseekKey = process.env.DEEPSEEK_API_KEY || '';

    // 优先使用 Gemini（免费），失败时降级到 DeepSeek
    if (geminiKey) {
      try {
        const text = await callGemini(messages, temperature, geminiKey);
        return sendJson(res, 200, { ok: true, text, provider: 'gemini' });
      } catch (geminiErr) {
        console.error('[companion] Gemini failed, falling back to DeepSeek:', geminiErr.message);
        // 继续尝试 DeepSeek
      }
    }

    if (!deepseekKey) {
      return sendJson(res, 500, { ok: false, error: '暂无可用的 AI 服务，请稍候再试' });
    }

    const text = await callDeepSeek(messages, temperature, deepseekKey);
    return sendJson(res, 200, { ok: true, text, provider: 'deepseek' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
