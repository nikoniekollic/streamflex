-- Voie d'appels 1fichier (lecture / admin) : remplace onefichier_acquire (surcharge non trouvée par PostgREST).
create or replace function public.onefichier_take_slot(p_lane text, p_gap_ms int, p_cap int, p_max_wait_ms int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.api_governor; v_shared timestamptz; v_now timestamptz := clock_timestamp(); v_slot timestamptz; v_wait int;
begin
  if p_lane not in ('onefichier', 'onefichier_admin') then raise exception 'unknown_lane' using errcode = '22023'; end if;
  insert into public.api_governor (name) values ('onefichier') on conflict do nothing;
  insert into public.api_governor (name) values (p_lane) on conflict do nothing;
  select paused_until into v_shared from public.api_governor where name = 'onefichier';
  select * into g from public.api_governor where name = p_lane for update;
  if v_shared is not null and v_shared > v_now then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'retry_s', ceil(extract(epoch from v_shared - v_now)));
  end if;
  if g.window_start < v_now - interval '1 hour' then g.window_start := v_now; g.window_count := 0; end if;
  if g.window_count >= p_cap then
    update public.api_governor set window_start = g.window_start, window_count = g.window_count where name = p_lane;
    return jsonb_build_object('ok', false, 'reason', 'hourly_cap', 'retry_s', ceil(extract(epoch from g.window_start + interval '1 hour' - v_now)));
  end if;
  v_slot := greatest(v_now, coalesce(g.last_call_at, v_now - interval '1 day') + make_interval(secs => p_gap_ms / 1000.0));
  v_wait := ceil(extract(epoch from v_slot - v_now) * 1000);
  if v_wait > p_max_wait_ms then
    return jsonb_build_object('ok', false, 'reason', 'busy', 'retry_s', ceil(v_wait / 1000.0));
  end if;
  update public.api_governor set last_call_at = v_slot, window_start = g.window_start, window_count = g.window_count + 1 where name = p_lane;
  return jsonb_build_object('ok', true, 'wait_ms', v_wait);
end $$;

revoke all on function public.onefichier_take_slot(text, int, int, int) from public, anon, authenticated;
grant execute on function public.onefichier_take_slot(text, int, int, int) to service_role;
notify pgrst, 'reload schema';
