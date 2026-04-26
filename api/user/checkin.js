const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

function dateStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;
    const today = dateStr();
    const yesterday = dateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const { data: profile } = await supabase
      .from('user_companion_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const prevDate = profile?.last_checkin_date || null;
    const prevStreak = Number(profile?.checkin_streak || 0);
    let nextStreak = 1;
    let alreadyCheckedIn = false;
    if (prevDate === today) {
      nextStreak = prevStreak || 1;
      alreadyCheckedIn = true;
    } else if (prevDate === yesterday) {
      nextStreak = prevStreak + 1;
    }

    const upsertRow = {
      user_id: userId,
      companion_id: profile?.companion_id || 'hui-ming',
      onboarding_completed: profile?.onboarding_completed || false,
      onboarding_skipped: profile?.onboarding_skipped || false,
      checkin_streak: nextStreak,
      last_checkin_date: today,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('user_companion_profiles').upsert(upsertRow, { onConflict: 'user_id' });
    if (error) throw error;
    return sendJson(res, 200, { ok: true, streak: nextStreak, alreadyCheckedIn });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
