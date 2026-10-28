-- 0009_stats.sql — temps de visionnage réel (agrégat journalier) + RPC statistiques admin

-- ═════════════ Agrégat journalier alimenté par save_progress (1 ligne / user / titre / jour)
create table public.watch_daily (
  user_id  uuid not null references auth.users (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete cascade,
  day      date not null default current_date,
  seconds  integer not null default 0 check (seconds >= 0),
  primary key (user_id, title_id, day)
);
create index watch_daily_day_idx on public.watch_daily (day);
create index watch_daily_title_day_idx on public.watch_daily (title_id, day);

alter table public.watch_daily enable row level security;
revoke all on public.watch_daily from anon, authenticated;  -- écrit uniquement par save_progress (definer), lu par les RPC admin

-- Reprise de l'historique : estimation = position atteinte (durée si terminé), datée du dernier visionnage
insert into public.watch_daily (user_id, title_id, day, seconds)
select user_id, title_id, updated_at::date,
       sum(case when completed and duration_seconds is not null then duration_seconds else position_seconds end)::integer
from public.watch_progress
group by user_id, title_id, updated_at::date
on conflict do nothing;

-- ═════════════ save_progress v2 : security definer + comptage du temps réellement regardé
-- delta compté = progression positive, plafonnée au temps réel écoulé depuis la dernière sauvegarde (+5 s) :
-- un seek ou des appels forgés ne gonflent pas les statistiques.
create or replace function public.save_progress(
  p_title_id uuid,
  p_episode_id uuid,
  p_position_seconds integer,
  p_duration_seconds integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_prev integer;
  v_prev_at timestamptz;
  v_delta integer;
  v_pos integer := greatest(0, coalesce(p_position_seconds, 0));
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.titles where id = p_title_id and is_published) then
    raise exception 'title_not_available' using errcode = '42501';
  end if;

  select position_seconds, updated_at into v_prev, v_prev_at
  from public.watch_progress
  where user_id = v_uid and title_id = p_title_id and episode_id is not distinct from p_episode_id
  for update;

  insert into public.watch_progress (user_id, title_id, episode_id, position_seconds, duration_seconds)
  values (v_uid, p_title_id, p_episode_id, v_pos, nullif(p_duration_seconds, 0))
  on conflict (user_id, title_id, episode_id) do update
    set position_seconds = excluded.position_seconds,
        duration_seconds = coalesce(excluded.duration_seconds, public.watch_progress.duration_seconds);

  if v_prev is not null then
    v_delta := least(v_pos - v_prev, ceil(extract(epoch from now() - v_prev_at))::integer + 5);
    if v_delta > 0 then
      insert into public.watch_daily (user_id, title_id, day, seconds)
      values (v_uid, p_title_id, current_date, v_delta)
      on conflict (user_id, title_id, day) do update set seconds = public.watch_daily.seconds + excluded.seconds;
    end if;
  end if;
end $$;

revoke all on function public.save_progress(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_progress(uuid, uuid, integer, integer) to authenticated;

-- ═════════════ RPC statistiques (admin)
-- KPI + séries journalières sur p_days jours (fenêtre glissante incluant aujourd'hui)
create or replace function public.admin_stats_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from date := current_date - (v_days - 1);
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select jsonb_build_object(
    'days', v_days,
    'total_watch_seconds', (select coalesce(sum(seconds), 0) from public.watch_daily),
    'period_watch_seconds', (select coalesce(sum(seconds), 0) from public.watch_daily where day >= v_from),
    'prev_period_watch_seconds', (select coalesce(sum(seconds), 0) from public.watch_daily
                                  where day >= v_from - v_days and day < v_from),
    'active_viewers_7d', (select count(distinct user_id) from public.watch_daily where day >= current_date - 6),
    'active_viewers_prev_7d', (select count(distinct user_id) from public.watch_daily
                               where day >= current_date - 13 and day < current_date - 6),
    'active_signins_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'total_users', (select count(*) from auth.users),
    'active_subscriptions', (select count(*) from public.subscriptions where status = 'active' and ends_at > now()),
    'published_titles', (select count(*) from public.titles where is_published),
    'completions_period', (select count(*) from public.watch_progress where completed and updated_at >= v_from),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'seconds', coalesce(w.seconds, 0), 'viewers', coalesce(w.viewers, 0))
                                order by d.day), '[]'::jsonb)
      from generate_series(v_from, current_date, interval '1 day') as d(day)
      left join (
        select day, sum(seconds)::bigint as seconds, count(distinct user_id) as viewers
        from public.watch_daily where day >= v_from group by day
      ) w on w.day = d.day::date
    )
  ) into v_result;
  return v_result;
end $$;

-- Top contenus : spectateurs uniques, temps cumulé, complétions (p_days null = depuis toujours)
create or replace function public.admin_stats_top_titles(p_days integer default 30, p_limit integer default 10)
returns table (
  title_id uuid, title text, slug text, type public.title_type, poster_url text,
  viewers bigint, watch_seconds bigint, completions bigint
) language plpgsql stable security definer set search_path = '' as $$
declare v_from date := case when p_days is null then null else current_date - (least(greatest(p_days, 1), 365) - 1) end;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with w as (
    select wd.title_id, count(distinct wd.user_id) as viewers, sum(wd.seconds)::bigint as watch_seconds
    from public.watch_daily wd
    where v_from is null or wd.day >= v_from
    group by wd.title_id
  ), c as (
    select wp.title_id, count(*) filter (where wp.completed) as completions
    from public.watch_progress wp
    where v_from is null or wp.updated_at >= v_from
    group by wp.title_id
  )
  select t.id, t.title, t.slug, t.type, t.poster_url, w.viewers, w.watch_seconds, coalesce(c.completions, 0)
  from w
  join public.titles t on t.id = w.title_id
  left join c on c.title_id = w.title_id
  order by w.viewers desc, w.watch_seconds desc, t.title
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end $$;

-- Temps de visionnage par utilisateur (classement, ou un utilisateur précis via p_user)
create or replace function public.admin_stats_user_watch_time(
  p_days integer default 30, p_limit integer default 10, p_user uuid default null
) returns table (
  user_id uuid, email text, display_name text, watch_seconds bigint, titles_watched bigint, last_day date
) language plpgsql stable security definer set search_path = '' as $$
declare v_from date := case when p_days is null then null else current_date - (least(greatest(p_days, 1), 365) - 1) end;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select wd.user_id, u.email::text, p.display_name,
         sum(wd.seconds)::bigint, count(distinct wd.title_id), max(wd.day)
  from public.watch_daily wd
  join auth.users u on u.id = wd.user_id
  left join public.profiles p on p.id = wd.user_id
  where (v_from is null or wd.day >= v_from) and (p_user is null or wd.user_id = p_user)
  group by wd.user_id, u.email, p.display_name
  order by 4 desc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end $$;

revoke all on function public.admin_stats_overview(integer) from public, anon;
revoke all on function public.admin_stats_top_titles(integer, integer) from public, anon;
revoke all on function public.admin_stats_user_watch_time(integer, integer, uuid) from public, anon;
grant execute on function public.admin_stats_overview(integer) to authenticated;
grant execute on function public.admin_stats_top_titles(integer, integer) to authenticated;
grant execute on function public.admin_stats_user_watch_time(integer, integer, uuid) to authenticated;
