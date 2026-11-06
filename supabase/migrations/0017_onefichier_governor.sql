-- Régulateur d'appels vers l'API 1fichier (partagé par toutes les instances d'Edge Functions)
-- + cache court des liens de téléchargement. Accès service_role uniquement.
create table public.api_governor (
  name text primary key,
  last_call_at timestamptz,
  window_start timestamptz not null default now(),
  window_count int not null default 0,
  paused_until timestamptz,
  pause_reason text
);
create table public.onefichier_links (
  file_id text primary key,
  url text not null,
  expires_at timestamptz not null
);
alter table public.api_governor enable row level security;
alter table public.onefichier_links enable row level security;
revoke all on public.api_governor, public.onefichier_links from anon, authenticated;

-- Réserve un créneau d'appel. ok=false : ne PAS appeler l'API. ok=true : attendre wait_ms puis appeler.
create or replace function public.onefichier_acquire(p_min_gap_ms int, p_hourly_cap int, p_max_wait_ms int default 9000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.api_governor; v_now timestamptz := clock_timestamp(); v_slot timestamptz; v_wait int;
begin
  insert into public.api_governor (name) values ('onefichier') on conflict do nothing;
  select * into g from public.api_governor where name = 'onefichier' for update;
  if g.paused_until is not null and g.paused_until > v_now then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'retry_s', ceil(extract(epoch from g.paused_until - v_now)));
  end if;
  if g.window_start < v_now - interval '1 hour' then
    g.window_start := v_now; g.window_count := 0;
  end if;
  if g.window_count >= p_hourly_cap then
    update public.api_governor set window_start = g.window_start, window_count = g.window_count where name = 'onefichier';
    return jsonb_build_object('ok', false, 'reason', 'hourly_cap', 'retry_s', ceil(extract(epoch from g.window_start + interval '1 hour' - v_now)));
  end if;
  v_slot := greatest(v_now, coalesce(g.last_call_at, v_now - interval '1 day') + make_interval(secs => p_min_gap_ms / 1000.0));
  v_wait := ceil(extract(epoch from v_slot - v_now) * 1000);
  if v_wait > p_max_wait_ms then
    return jsonb_build_object('ok', false, 'reason', 'busy', 'retry_s', ceil(v_wait / 1000.0));
  end if;
  update public.api_governor
    set last_call_at = v_slot, window_start = g.window_start, window_count = g.window_count + 1
    where name = 'onefichier';
  return jsonb_build_object('ok', true, 'wait_ms', v_wait);
end $$;

-- Disjoncteur : aucun appel pendant p_hours (blocage de compte, clé invalide, flood).
create or replace function public.onefichier_trip(p_hours int, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.api_governor (name, paused_until, pause_reason)
  values ('onefichier', now() + make_interval(hours => p_hours), left(p_reason, 300))
  on conflict (name) do update
    set paused_until = greatest(coalesce(api_governor.paused_until, now()), excluded.paused_until),
        pause_reason = excluded.pause_reason;
$$;

revoke all on function public.onefichier_acquire(int, int, int), public.onefichier_trip(int, text) from public, anon, authenticated;
grant execute on function public.onefichier_acquire(int, int, int), public.onefichier_trip(int, text) to service_role;
