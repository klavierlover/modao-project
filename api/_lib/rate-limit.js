const { getSupabaseAdmin } = require('./supabase');

// 内存兜底（仅当 Supabase 不可用/未建表时使用；Serverless 多实例下不精确）
const memMap = new Map();
function memCheck(key, limit, windowMs) {
  const now = Date.now();
  const e = memMap.get(key);
  if (!e || now - e.windowStart > windowMs) {
    memMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (e.count >= limit) return false;
  e.count += 1;
  return true;
}

/**
 * 全局限流（跨实例）：优先用 Supabase 原子 RPC，失败回退内存。
 * 需在 Supabase 执行 supabase/rate_limit.sql 创建表与函数。
 * @returns {Promise<boolean>} true=允许，false=超限
 */
async function checkRateLimit(key, limit, windowSeconds) {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (_e) {
    return memCheck(key, limit, windowSeconds * 1000);
  }
}

module.exports = { checkRateLimit };
