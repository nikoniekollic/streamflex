-- 0016_reviews_bookmarks.sql — avis communautaires (1–5 ★) & marque-pages vidéo partagés
-- movie_id de la spec → title_id (films ET séries) ; profile_id = profil de visionnage auteur (nom affiché)

-- ═════════════ Avis
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id  uuid not null,
  title_id    uuid not null references public.titles (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (comment is null or char_length(btrim(comment)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.viewer_profiles (id, user_id) on delete cascade,
  unique (profile_id, title_id)                       -- un avis par profil et par titre
);
create index reviews_title_recent_idx on public.reviews (title_id, created_at desc);
create trigger reviews_updated_at before update on public.reviews for each row execute function public.set_updated_at();

-- ═════════════ Marque-pages
create table public.video_bookmarks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id        uuid not null,
  title_id          uuid not null,
  episode_id        uuid,                             -- séries : marque-page lié à l'épisode
  timestamp_seconds integer not null check (timestamp_seconds between 0 and 86400),
  label             text not null check (char_length(btrim(label)) between 1 and 120),
  is_public         boolean not null default true,    -- partagé avec la communauté
  created_at        timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.viewer_profiles (id, user_id) on delete cascade,
  foreign key (title_id) references public.titles (id) on delete cascade,
  foreign key (episode_id, title_id) references public.episodes (id, title_id) on delete cascade
);
create index video_bookmarks_target_idx on public.video_bookmarks (title_id, episode_id, timestamp_seconds);

-- ═════════════ RLS : lecture pour tous les utilisateurs connectés (titres publiés), écriture propriétaire
alter table public.reviews enable row level security;
alter table public.video_bookmarks enable row level security;
revoke all on public.reviews, public.video_bookmarks from anon, authenticated;
grant select, delete on public.reviews, public.video_bookmarks to authenticated;
grant insert (profile_id, title_id, rating, comment) on public.reviews to authenticated;
grant update (rating, comment) on public.reviews to authenticated;
grant insert (profile_id, title_id, episode_id, timestamp_seconds, label, is_public) on public.video_bookmarks to authenticated;
grant update (label, is_public) on public.video_bookmarks to authenticated;

create policy reviews_read on public.reviews for select to authenticated
  using (exists (select 1 from public.titles t where t.id = title_id and t.is_published) or (select public.is_admin()));
create policy reviews_insert_own on public.reviews for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.titles t where t.id = title_id and t.is_published));
create policy reviews_update_own on public.reviews for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reviews_delete on public.reviews for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));   -- modération admin

create policy bookmarks_read on public.video_bookmarks for select to authenticated
  using (user_id = (select auth.uid())
         or (is_public and exists (select 1 from public.titles t where t.id = title_id and t.is_published))
         or (select public.is_admin()));
create policy bookmarks_insert_own on public.video_bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.titles t where t.id = title_id and t.is_published));
create policy bookmarks_update_own on public.video_bookmarks for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy bookmarks_delete on public.video_bookmarks for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ═════════════ RPC (noms d'auteurs = profils de visionnage, non lisibles directement)
create or replace function public.title_rating_summary(p_title_id uuid)
returns table (average numeric, total bigint, r1 bigint, r2 bigint, r3 bigint, r4 bigint, r5 bigint)
language sql stable security invoker set search_path = '' as $$
  select round(avg(rating)::numeric, 1), count(*),
         count(*) filter (where rating = 1), count(*) filter (where rating = 2), count(*) filter (where rating = 3),
         count(*) filter (where rating = 4), count(*) filter (where rating = 5)
  from public.reviews where title_id = p_title_id
$$;

create or replace function public.title_reviews(p_title_id uuid, p_profile_id uuid default null, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, rating smallint, comment text, created_at timestamptz, updated_at timestamptz,
  author_name text, author_avatar text, is_mine boolean, total_count bigint
) language sql stable security definer set search_path = '' as $$
  select r.id, r.rating, r.comment, r.created_at, r.updated_at, v.name, v.avatar_url,
         r.user_id = (select auth.uid()) and r.profile_id = p_profile_id, count(*) over ()
  from public.reviews r
  join public.viewer_profiles v on v.id = r.profile_id
  join public.titles t on t.id = r.title_id
  where r.title_id = p_title_id
    and (select auth.uid()) is not null
    and (t.is_published or public.is_admin())
  order by (r.user_id = (select auth.uid()) and r.profile_id = p_profile_id) desc,
           (r.comment is not null) desc, r.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.upsert_review(p_profile_id uuid, p_title_id uuid, p_rating smallint, p_comment text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.reviews (profile_id, title_id, rating, comment)
  values (p_profile_id, p_title_id, p_rating, nullif(btrim(p_comment), ''))
  on conflict (profile_id, title_id) do update set rating = excluded.rating, comment = excluded.comment
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.title_bookmarks(p_title_id uuid, p_episode_id uuid default null, p_profile_id uuid default null)
returns table (
  id uuid, timestamp_seconds integer, label text, is_public boolean, created_at timestamptz,
  author_name text, author_avatar text, is_mine boolean
) language sql stable security definer set search_path = '' as $$
  select b.id, b.timestamp_seconds, b.label, b.is_public, b.created_at, v.name, v.avatar_url,
         b.user_id = (select auth.uid()) and b.profile_id = p_profile_id
  from public.video_bookmarks b
  join public.viewer_profiles v on v.id = b.profile_id
  join public.titles t on t.id = b.title_id
  where b.title_id = p_title_id
    and b.episode_id is not distinct from p_episode_id
    and (select auth.uid()) is not null
    and (b.user_id = (select auth.uid()) or (b.is_public and t.is_published))
  order by b.timestamp_seconds, b.created_at
  limit 500
$$;

revoke all on function public.title_rating_summary(uuid), public.title_reviews(uuid, uuid, integer, integer),
  public.upsert_review(uuid, uuid, smallint, text), public.title_bookmarks(uuid, uuid, uuid) from public, anon;
grant execute on function public.title_rating_summary(uuid), public.title_reviews(uuid, uuid, integer, integer),
  public.upsert_review(uuid, uuid, smallint, text), public.title_bookmarks(uuid, uuid, uuid) to authenticated;
