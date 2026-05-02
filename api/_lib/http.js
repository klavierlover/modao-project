function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// 允许的源白名单：生产域名 + 本地开发
const ALLOWED_ORIGINS = new Set([
  'https://muodao.com',
  'https://www.muodao.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://modao.test',
]);

function cors(req, res) {
  const origin = req?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://muodao.com';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw || '{}');
  } catch (_e) {
    throw new Error('Invalid JSON in request body');
  }
}

function parseBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

module.exports = {
  sendJson,
  cors,
  readJsonBody,
  parseBearerToken,
};
