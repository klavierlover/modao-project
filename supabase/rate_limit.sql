-- AI 接口全局限流（跨 Serverless 实例）
-- 在 Supabase SQL Editor 执行一次即可。未执行时后端会自动回退到内存限流。

create table if not exists public.ai_rate_limits (
  key          text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);

-- 原子检查并自增：同一窗口内累加，窗口过期则重置。返回是否未超限。
create or replace function public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql
as $$
declare
  v_count int;
begin
  insert into public.ai_rate_limits(key, count, window_start)
    values (p_key, 1, now())
  on conflict (key) do update set
    count = case
      when public.ai_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then 1
      else public.ai_rate_limits.count + 1
    end,
    window_start = case
      when public.ai_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then now()
      else public.ai_rate_limits.window_start
    end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;
