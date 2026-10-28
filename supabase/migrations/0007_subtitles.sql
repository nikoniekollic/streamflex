-- 0007_subtitles.sql — sous-titres (.vtt / .srt) par film ou épisode + bucket Storage
create table public.subtitles (
  id           uuid primary key default gen_random_uuid(),
  title_id     uuid references public.titles (id) on delete cascade,
  episode_id   uuid references public.episodes (id) on delete cascade,
  language     text not null check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),   -- BCP 47 : fr, en, pt-BR…
  label        text not null check (char_length(label) between 1 and 60),
  url          text not null check (url ~* '^https?://'),
  format       text not null check (format in ('vtt', 'srt')),
  storage_path text,                                                              -- si uploadé dans le bucket
  is_default   boolean not null default false,
  is_forced    boolean not null default false,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (num_nonnulls(title_id, episode_id) = 1)
);
create index subtitles_title_idx on public.subtitles (title_id) where title_id is not null;
create index subtitles_episode_idx on public.subtitles (episode_id) where episode_id is not null;
create unique index subtitles_unique_label on public.subtitles
  (coalesce(episode_id, title_id), language, lower(label));
create unique index subtitles_one_default on public.subtitles (coalesce(episode_id, title_id)) where is_default;

create trigger subtitles_movie_only before insert or update of title_id on public.subtitles
  for each row execute function public.assert_title_type('movie');

alter table public.subtitles enable row level security;
revoke all on public.subtitles from anon, authenticated;
grant select, insert, update, delete on public.subtitles to authenticated;

create policy subtitles_read on public.subtitles for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.titles t
      left join public.episodes e on e.id = subtitles.episode_id
      where t.id = coalesce(subtitles.title_id, e.title_id) and t.is_published
    )
  );
create policy subtitles_admin on public.subtitles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Bucket public en lecture (fichiers non sensibles), écriture admin uniquement
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('subtitles', 'subtitles', true, 2097152,
        array['text/vtt', 'application/x-subrip', 'text/plain', 'application/octet-stream'])
on conflict (id) do nothing;

create policy subtitles_bucket_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'subtitles' and (select public.is_admin()));
create policy subtitles_bucket_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'subtitles' and (select public.is_admin()));
create policy subtitles_bucket_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'subtitles' and (select public.is_admin()));
