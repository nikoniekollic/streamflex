-- 0011_history.sql — historique & « Reprendre la lecture »
-- Table existante (0001) : watch_progress (user_id, title_id [= film ou série], episode_id, position_seconds,
-- duration_seconds, completed, updated_at) — RLS propriétaire déjà active (select/insert/update/delete).
-- Correspondance avec la spec : movie_id → title_id, progress_seconds → position_seconds, total_duration → duration_seconds.

-- Garde-fou idempotent : RLS + policies propriétaire
alter table public.watch_progress enable row level security;
grant select, delete on public.watch_progress to authenticated;

-- Historique : 1 ligne par titre (dernier épisode/visionnage), tri par dernière lecture
create or replace function public.my_watch_history(p_limit integer default 60, p_offset integer default 0)
returns table (
  title_id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint,
  runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz,
  episode_id uuid, season_number smallint, episode_number smallint, episode_name text,
  position_seconds integer, duration_seconds integer, ratio real, updated_at timestamptz, total_count bigint
) language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (wp.title_id) wp.*
    from public.watch_progress wp
    where wp.user_id = (select auth.uid())
    order by wp.title_id, wp.updated_at desc
  )
  select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating,
         t.poster_url, t.backdrop_url, t.logo_url, t.published_at,
         l.episode_id, s.season_number, e.episode_number, e.name,
         l.position_seconds, l.duration_seconds,
         case when l.duration_seconds > 0 then least(1, l.position_seconds::real / l.duration_seconds) else 0 end,
         l.updated_at, count(*) over ()
  from latest l
  join public.titles t on t.id = l.title_id            -- RLS : titres publiés uniquement
  left join public.episodes e on e.id = l.episode_id
  left join public.seasons s on s.id = e.season_id
  order by l.updated_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Reprendre la lecture : progression strictement entre 2 % et 95 %
create or replace function public.my_continue_watching(p_limit integer default 20)
returns table (
  title_id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint,
  runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz,
  episode_id uuid, season_number smallint, episode_number smallint, episode_name text,
  position_seconds integer, duration_seconds integer, ratio real, updated_at timestamptz, total_count bigint
) language sql stable security invoker set search_path = '' as $$
  select h.* from public.my_watch_history(200, 0) h
  where h.duration_seconds > 0 and h.ratio >= 0.02 and h.ratio <= 0.95
  order by h.updated_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.my_watch_history(integer, integer), public.my_continue_watching(integer) from public, anon;
grant execute on function public.my_watch_history(integer, integer), public.my_continue_watching(integer) to authenticated;
