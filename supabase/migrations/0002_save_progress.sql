-- 0002_save_progress.sql — upsert de progression sans exposer user_id/title_id en UPDATE
create or replace function public.save_progress(
  p_title_id uuid,
  p_episode_id uuid,
  p_position_seconds integer,
  p_duration_seconds integer default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.watch_progress (title_id, episode_id, position_seconds, duration_seconds)
  values (p_title_id, p_episode_id, greatest(0, p_position_seconds), nullif(p_duration_seconds, 0))
  on conflict (user_id, title_id, episode_id) do update
    set position_seconds = excluded.position_seconds,
        duration_seconds = coalesce(excluded.duration_seconds, public.watch_progress.duration_seconds);
$$;

revoke all on function public.save_progress(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_progress(uuid, uuid, integer, integer) to authenticated;

create index if not exists media_sources_lookup_idx
  on public.media_sources (coalesce(episode_id, title_id), priority) where is_active;
