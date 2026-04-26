const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;

    if (req.method === 'GET') {
      const { data: profile, error: profileErr } = await supabase
        .from('user_companion_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;

      const { data: practices, error: practiceErr } = await supabase
        .from('user_practice_tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (practiceErr) throw practiceErr;

      return sendJson(res, 200, {
        ok: true,
        profile: profile || null,
        practices: practices || [],
      });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const companionId = String(body.companion_id || '').trim();
      const onboardingSkipped = Boolean(body.onboarding_skipped);
      const onboardingCompleted = Boolean(body.onboarding_completed);
      if (!companionId) {
        return sendJson(res, 400, { ok: false, error: 'companion_id is required' });
      }

      const { data: existingProfile } = await supabase
        .from('user_companion_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const row = {
        user_id: userId,
        companion_id: companionId,
        onboarding_skipped: onboardingSkipped,
        onboarding_completed: onboardingCompleted,
        checkin_streak: body.checkin_streak === undefined
          ? Number(existingProfile?.checkin_streak || 0)
          : Number(body.checkin_streak || 0),
        last_checkin_date: body.last_checkin_date === undefined
          ? (existingProfile?.last_checkin_date || null)
          : (body.last_checkin_date || null),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('user_companion_profiles')
        .upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
const { getSupabaseAdmin } = require('../_lib/supabase');
const { cors, sendJson, readJsonBody } = require('../_lib/http');
const { requireUser } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message });
    const supabase = getSupabaseAdmin();
    const userId = auth.user.id;

    if (req.method === 'GET') {
      const { data: profile, error: profileErr } = await supabase
        .from('user_companion_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;

      const { data: practices, error: practiceErr } = await supabase
        .from('user_practice_tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (practiceErr) throw practiceErr;

      return sendJson(res, 200, {
        ok: true,
        profile: profile || null,
        practices: practices || [],
      });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const companionId = String(body.companion_id || '').trim();
      const onboardingSkipped = Boolean(body.onboarding_skipped);
      const onboardingCompleted = Boolean(body.onboarding_completed);

      if (!companionId) {
        return sendJson(res, 400, { ok: false, error: 'companion_id is required' });
      }

      const row = {
        user_id: userId,
        companion_id: companionId,
        onboarding_skipped: onboardingSkipped,
        onboarding_completed: onboardingCompleted,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('user_companion_profiles')
        .upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
  }
};
