-- 0001_initial_schema.sql — StreamFlex
-- profiles · genres · titles · title_genres · seasons · episodes · media_sources · watch_progress

-- ───────────────────────── Extensions
create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────── Enums
create type public.user_role      as enum ('user', 'admin');
create type public.title_type     as enum ('movie', 'series');
create type public.video_provider as enum ('pixeldrain', 'onefichier', 'alist', 'other');
create type public.video_quality  as enum ('480p', '720p', '1080p', '2160p');

-- ───────────────────────── Helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────── profiles
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique check (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  display_name text check (char_length(display_name) <= 60),
  avatar_url   text,
  role         public.user_role not null default 'user',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ───────────────────────── genres
create table public.genres (
  id   smallint generated always as identity primary key,
  slug text not null unique,
  name text not null
);

-- ───────────────────────── titles (films + séries)
create table public.titles (
  id              uuid primary key default gen_random_uuid(),
  type            public.title_type not null,
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title           text not null,
  original_title  text,
  synopsis        text,
  release_year    smallint check (release_year between 1880 and 2100),
  runtime_minutes smallint check (runtime_minutes > 0),
  maturity_rating text,
  poster_url      text,
  backdrop_url    text,
  logo_url        text,
  trailer_url     text,
  tmdb_id         integer,
  imdb_id         text,
  metadata        jsonb not null default '{}'::jsonb,
  is_published    boolean not null default false,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  search          tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(original_title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(synopsis, '')), 'C')
  ) stored,
  unique (type, tmdb_id)
);

create index titles_published_idx on public.titles (type, published_at desc) where is_published;
create index titles_search_idx    on public.titles using gin (search);
create index titles_title_trgm    on public.titles using gin (title extensions.gin_trgm_ops);

create trigger titles_updated_at before update on public.titles
  for each row execute function public.set_updated_at();

-- ───────────────────────── title_genres
create table public.title_genres (
  title_id uuid     not null references public.titles (id) on delete cascade,
  genre_id smallint not null references public.genres (id) on delete cascade,
  primary key (title_id, genre_id)
);
create index title_genres_genre_idx on public.title_genres (genre_id);

-- ───────────────────────── seasons
create table public.seasons (
  id            uuid primary key default gen_random_uuid(),
  title_id      uuid not null references public.titles (id) on delete cascade,
  season_number smallint not null check (season_number >= 0),
  name          text,
  overview      text,
  poster_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (title_id, season_number),
  unique (id, title_id)
);

create trigger seasons_updated_at before update on public.seasons
  for each row execute function public.set_updated_at();

-- ───────────────────────── episodes
create table public.episodes (
  id              uuid primary key default gen_random_uuid(),
  title_id        uuid not null,
  season_id       uuid not null,
  episode_number  smallint not null check (episode_number > 0),
  name            text,
  overview        text,
  runtime_minutes smallint check (runtime_minutes > 0),
  still_url       text,
  air_date        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (season_id, title_id) references public.seasons (id, title_id) on delete cascade,
  unique (season_id, episode_number),
  unique (id, title_id)
);
create index episodes_title_idx on public.episodes (title_id);

create trigger episodes_updated_at before update on public.episodes
  for each row execute function public.set_updated_at();

-- Une saison n'appartient qu'à une série
create or replace function public.assert_title_type()
returns trigger language plpgsql set search_path = '' as $$
declare
  t public.title_type;
  expected public.title_type := tg_argv[0]::public.title_type;
begin
  if new.title_id is null then return new; end if;
  select type into t from public.titles where id = new.title_id;
  if t is distinct from expected then
    raise exception '% requires title % to be of type %', tg_table_name, new.title_id, expected;
  end if;
  return new;
end $$;

create trigger seasons_series_only before insert or update of title_id on public.seasons
  for each row execute function public.assert_title_type('series');

-- ───────────────────────── media_sources (privé : jamais exposé aux clients)
create table public.media_sources (
  id              uuid primary key default gen_random_uuid(),
  title_id        uuid references public.titles (id) on delete cascade,
  episode_id      uuid references public.episodes (id) on delete cascade,
  provider        public.video_provider not null,
  external_id     text,
  raw_url         text,
  quality         public.video_quality not null default '1080p',
  container       text,
  video_codec     text,
  audio_languages text[] not null default '{}',
  subtitle_languages text[] not null default '{}',
  size_bytes      bigint check (size_bytes > 0),
  checksum        text,
  priority        smallint not null default 100,
  is_active       boolean not null default true,
  last_checked_at timestamptz,
  last_status     smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (num_nonnulls(title_id, episode_id) = 1),
  check (num_nonnulls(external_id, raw_url) >= 1)
);
create index media_sources_title_idx   on public.media_sources (title_id, priority)   where is_active;
create index media_sources_episode_idx on public.media_sources (episode_id, priority) where is_active;
create unique index media_sources_provider_uidx on public.media_sources (provider, external_id) where external_id is not null;

create trigger media_sources_updated_at before update on public.media_sources
  for each row execute function public.set_updated_at();

create trigger media_sources_movie_only before insert or update of title_id on public.media_sources
  for each row execute function public.assert_title_type('movie');

-- Qualités disponibles (sans identifiants bruts) pour un film ou un épisode publié
create or replace function public.get_available_qualities(p_title_id uuid default null, p_episode_id uuid default null)
returns table (quality public.video_quality, audio_languages text[], subtitle_languages text[])
language sql stable security definer set search_path = '' as $$
  select distinct on (ms.quality) ms.quality, ms.audio_languages, ms.subtitle_languages
  from public.media_sources ms
  left join public.episodes e on e.id = ms.episode_id
  join public.titles t on t.id = coalesce(ms.title_id, e.title_id)
  where (select auth.uid()) is not null
    and ms.is_active
    and t.is_published
    and ((p_episode_id is not null and ms.episode_id = p_episode_id)
      or (p_episode_id is null and ms.title_id = p_title_id))
  order by ms.quality, ms.priority;
$$;

-- ───────────────────────── watch_progress
create table public.watch_progress (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title_id         uuid not null references public.titles (id) on delete cascade,
  episode_id       uuid,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  duration_seconds integer check (duration_seconds > 0),
  completed        boolean generated always as (
    duration_seconds is not null and position_seconds >= duration_seconds * 0.92
  ) stored,
  updated_at       timestamptz not null default now(),
  foreign key (episode_id, title_id) references public.episodes (id, title_id) on delete cascade,
  unique nulls not distinct (user_id, title_id, episode_id)
);
create index watch_progress_user_recent_idx on public.watch_progress (user_id, updated_at desc);

create trigger watch_progress_updated_at before update on public.watch_progress
  for each row execute function public.set_updated_at();

-- ───────────────────────── Grants
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant select on public.genres, public.titles, public.title_genres, public.seasons, public.episodes to authenticated;
grant insert, update, delete on public.genres, public.titles, public.title_genres, public.seasons, public.episodes to authenticated;

revoke all on public.media_sources from authenticated;
grant select, insert, update, delete on public.media_sources to authenticated; -- filtré par RLS (admin)

revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

revoke all on public.watch_progress from authenticated;
grant select, delete on public.watch_progress to authenticated;
grant insert (title_id, episode_id, position_seconds, duration_seconds) on public.watch_progress to authenticated;
grant update (position_seconds, duration_seconds) on public.watch_progress to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_available_qualities(uuid, uuid) to authenticated;

-- ───────────────────────── RLS
alter table public.profiles       enable row level security;
alter table public.genres         enable row level security;
alter table public.titles         enable row level security;
alter table public.title_genres   enable row level security;
alter table public.seasons        enable row level security;
alter table public.episodes       enable row level security;
alter table public.media_sources  enable row level security;
alter table public.watch_progress enable row level security;

-- profiles : propriétaire uniquement (+ admin en lecture)
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- catalogue : lecture réservée aux connectés, contenu publié uniquement ; écriture admin
create policy genres_read on public.genres for select to authenticated using (true);
create policy genres_admin on public.genres for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy titles_read on public.titles for select to authenticated
  using (is_published or (select public.is_admin()));
create policy titles_admin on public.titles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy title_genres_read on public.title_genres for select to authenticated
  using (exists (select 1 from public.titles t where t.id = title_id and t.is_published) or (select public.is_admin()));
create policy title_genres_admin on public.title_genres for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy seasons_read on public.seasons for select to authenticated
  using (exists (select 1 from public.titles t where t.id = title_id and t.is_published) or (select public.is_admin()));
create policy seasons_admin on public.seasons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy episodes_read on public.episodes for select to authenticated
  using (exists (select 1 from public.titles t where t.id = title_id and t.is_published) or (select public.is_admin()));
create policy episodes_admin on public.episodes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- media_sources : admin uniquement (le resolver utilise service_role)
create policy media_sources_admin on public.media_sources for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- watch_progress : propriétaire uniquement, titre publié requis à l'écriture
create policy watch_progress_select_own on public.watch_progress for select to authenticated
  using (user_id = (select auth.uid()));
create policy watch_progress_insert_own on public.watch_progress for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.titles t where t.id = title_id and t.is_published)
  );
create policy watch_progress_update_own on public.watch_progress for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy watch_progress_delete_own on public.watch_progress for delete to authenticated
  using (user_id = (select auth.uid()));
