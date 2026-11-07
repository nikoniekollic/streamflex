-- Plusieurs « voies » d'appels 1fichier (lecture, admin/import) avec leur propre cadence et plafond,
-- mais un disjoncteur commun : un blocage de compte met TOUTES les voies en pause.
drop function if exists public.onefichier_acquire(int, int, int);
drop function if exists public.onefichier_trip(int, text);

create or replace function public.onefichier_acquire(
  p_min_gap_ms int, p_hourly_cap int, p_max_wait_ms int default 9000, p_name text default 'onefichier')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.api_governor; v_shared timestamptz; v_now timestamptz := clock_timestamp(); v_slot timestamptz; v_wait int;
begin
  if p_name not in ('onefichier', 'onefichier_admin') then raise exception 'unknown_lane' using errcode = '22023'; end if;
  insert into public.api_governor (name) values ('onefichier') on conflict do nothing;
  insert into public.api_governor (name) values (p_name) on conflict do nothing;
  select paused_until into v_shared from public.api_governor where name = 'onefichier';
  select * into g from public.api_governor where name = p_name for update;
  if v_shared is not null and v_shared > v_now then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'retry_s', ceil(extract(epoch from v_shared - v_now)));
  end if;
  if g.window_start < v_now - interval '1 hour' then g.window_start := v_now; g.window_count := 0; end if;
  if g.window_count >= p_hourly_cap then
    update public.api_governor set window_start = g.window_start, window_count = g.window_count where name = p_name;
    return jsonb_build_object('ok', false, 'reason', 'hourly_cap', 'retry_s', ceil(extract(epoch from g.window_start + interval '1 hour' - v_now)));
  end if;
  v_slot := greatest(v_now, coalesce(g.last_call_at, v_now - interval '1 day') + make_interval(secs => p_min_gap_ms / 1000.0));
  v_wait := ceil(extract(epoch from v_slot - v_now) * 1000);
  if v_wait > p_max_wait_ms then
    return jsonb_build_object('ok', false, 'reason', 'busy', 'retry_s', ceil(v_wait / 1000.0));
  end if;
  update public.api_governor set last_call_at = v_slot, window_start = g.window_start, window_count = g.window_count + 1 where name = p_name;
  return jsonb_build_object('ok', true, 'wait_ms', v_wait);
end $$;

create or replace function public.onefichier_trip(p_hours int, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.api_governor (name, paused_until, pause_reason)
  values ('onefichier', now() + make_interval(hours => p_hours), left(p_reason, 300))
  on conflict (name) do update
    set paused_until = greatest(coalesce(api_governor.paused_until, now()), excluded.paused_until),
        pause_reason = excluded.pause_reason;
$$;

revoke all on function public.onefichier_acquire(int, int, int, text), public.onefichier_trip(int, text) from public, anon, authenticated;
grant execute on function public.onefichier_acquire(int, int, int, text), public.onefichier_trip(int, text) to service_role;
