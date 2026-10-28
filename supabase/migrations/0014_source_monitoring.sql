-- 0014_source_monitoring.sql — suivi d'inactivité des fichiers hébergés (risque de suppression / stockage froid)
-- (table `media_sources` = « video_sources » de la spec)

alter table public.media_sources add column if not exists last_streamed_at timestamptz;

-- Monitoring : fichiers actifs triés du plus ancien au plus récent (jamais lus en tête)
create index if not exists media_sources_last_streamed_idx
  on public.media_sources (last_streamed_at asc nulls first) where is_active;

-- Marquage silencieux à chaque lecture — au plus 1 écriture / heure / fichier (évite l'amplification d'écritures)
create or replace function public.mark_source_streamed(p_source_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.media_sources
  set last_streamed_at = now()
  where id = p_source_id
    and (last_streamed_at is null or last_streamed_at < now() - interval '1 hour');
$$;
revoke all on function public.mark_source_streamed(uuid) from public, anon, authenticated;
grant execute on function public.mark_source_streamed(uuid) to service_role;

-- Liste des fichiers à risque : inactifs depuis ≥ p_days jours, ou jamais lus
create or replace function public.admin_cold_sources(
  p_days integer default 25,
  p_provider public.video_provider default null,
  p_status text default null,          -- null | 'never' | 'offline'
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  id uuid, provider public.video_provider, file_id text, quality public.video_quality, size_bytes bigint,
  title_id uuid, title text, slug text, episode_label text,
  last_streamed_at timestamptz, created_at timestamptz, idle_days integer,
  last_checked_at timestamptz, last_status smallint, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare v_cut timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 25), 1), 3650));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select m.id, m.provider, m.file_id::text, m.quality, m.size_bytes,
         t.id, t.title, t.slug,
         case when e.id is not null then format('S%sE%s', lpad(s.season_number::text, 2, '0'), lpad(e.episode_number::text, 2, '0')) end,
         m.last_streamed_at, m.created_at,
         floor(extract(epoch from now() - coalesce(m.last_streamed_at, m.created_at)) / 86400)::integer,
         m.last_checked_at, m.last_status, count(*) over ()
  from public.media_sources m
  left join public.episodes e on e.id = m.episode_id
  left join public.seasons s on s.id = e.season_id
  join public.titles t on t.id = coalesce(m.title_id, e.title_id)
  where m.is_active
    and m.provider in ('pixeldrain', 'onefichier')
    and (m.last_streamed_at is null or m.last_streamed_at < v_cut)
    and (p_provider is null or m.provider = p_provider)
    and (p_status is null
      or (p_status = 'never' and m.last_streamed_at is null)
      or (p_status = 'offline' and m.last_status in (404, 410)))
  order by m.last_streamed_at asc nulls first, m.created_at asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Synthèse par hébergeur
create or replace function public.admin_cold_sources_summary(p_days integer default 25)
returns table (provider public.video_provider, active bigint, at_risk bigint, never_streamed bigint, offline bigint, critical bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := least(greatest(coalesce(p_days, 25), 1), 3650);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select m.provider,
         count(*),
         count(*) filter (where m.last_streamed_at is null or m.last_streamed_at < now() - make_interval(days => v_days)),
         count(*) filter (where m.last_streamed_at is null),
         count(*) filter (where m.last_status in (404, 410)),
         count(*) filter (where coalesce(m.last_streamed_at, m.created_at) < now() - make_interval(days => v_days + 20))
  from public.media_sources m
  where m.is_active and m.provider in ('pixeldrain', 'onefichier')
  group by m.provider
  order by m.provider;
end $$;

revoke all on function public.admin_cold_sources(integer, public.video_provider, text, integer, integer),
  public.admin_cold_sources_summary(integer) from public, anon;
grant execute on function public.admin_cold_sources(integer, public.video_provider, text, integer, integer),
  public.admin_cold_sources_summary(integer) to authenticated;
