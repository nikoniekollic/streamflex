-- 0013_media_sources_compact.sql — table des sources vidéo compacte (cible : 500 000+ lignes en Free Tier)
-- Table conservée sous le nom `media_sources` (référencée partout) ; hébergeur = enum existant `video_provider`
-- ('pixeldrain', 'onefichier' = 1fichier, 'alist', 'other') — 4 octets, comme un nouvel enum.
-- Mesuré sur 500 000 lignes : voir MEMORY.md (étape 21).

-- ═════════════ Nouvelle table : colonnes ordonnées par alignement (16 → 8 → 4 → 2 → 1 → longueur variable)
create table public.media_sources_v2 (
  id              uuid primary key default gen_random_uuid(),
  title_id        uuid references public.titles (id) on delete cascade,
  episode_id      uuid references public.episodes (id) on delete cascade,
  size_bytes      bigint check (size_bytes > 0),
  created_at      timestamptz not null default now(),
  last_checked_at timestamptz,
  provider        public.video_provider not null,
  quality         public.video_quality not null default '1080p',
  priority        smallint not null default 100,
  last_status     smallint,
  is_active       boolean not null default true,
  -- identifiant hébergeur SEUL (Pixeldrain : 8 car., 1fichier : ~20) — l'URL est reconstruite à la lecture
  file_id         varchar(32) check (file_id ~ '^[A-Za-z0-9_-]{4,32}$'),
  container       varchar(8),
  video_codec     varchar(16),
  audio_languages    text[],          -- null plutôt que '{}' (0 octet)
  subtitle_languages text[],
  raw_url         text check (raw_url is null or (char_length(raw_url) <= 1000 and raw_url ~* '^https?://')),
  checksum        bytea check (checksum is null or octet_length(checksum) = 32),  -- sha256 binaire (32 o au lieu de 68)
  constraint media_sources_target_chk check (num_nonnulls(title_id, episode_id) = 1),
  -- hébergeurs à ID : file_id obligatoire et AUCUNE URL ; alist/other : URL obligatoire
  constraint media_sources_locator_chk check (
    (provider in ('pixeldrain', 'onefichier') and file_id is not null and raw_url is null)
    or (provider in ('alist', 'other') and raw_url is not null and file_id is null)
  )
);

-- ═════════════ Migration des données (extraction des ID depuis les anciennes URL)
insert into public.media_sources_v2 (
  id, title_id, episode_id, size_bytes, created_at, last_checked_at, provider, quality, priority, last_status, is_active,
  file_id, container, video_codec, audio_languages, subtitle_languages, raw_url, checksum
)
select
  m.id, m.title_id, m.episode_id, m.size_bytes, m.created_at, m.last_checked_at, m.provider, m.quality, m.priority, m.last_status,
  coalesce(m.is_active, true),
  case m.provider
    when 'pixeldrain' then coalesce(m.external_id, substring(m.raw_url from 'pixeldrain\.com/(?:u|api/file)/([A-Za-z0-9]+)'))
    when 'onefichier' then coalesce(m.external_id, substring(m.raw_url from '1fichier\.com/\?([A-Za-z0-9]+)'))
  end,
  left(nullif(m.container, ''), 8), left(nullif(m.video_codec, ''), 16),
  nullif(m.audio_languages, '{}'), nullif(m.subtitle_languages, '{}'),
  case when m.provider in ('alist', 'other') then m.raw_url end,
  case
    when m.checksum ~ '^qh1:[0-9a-f]{64}$' then decode(substr(m.checksum, 5), 'hex')
    when m.checksum ~ '^[0-9a-f]{64}$' then decode(m.checksum, 'hex')
  end
from public.media_sources m;

drop table public.media_sources cascade;  -- policies, triggers, index, grants de l'ancienne table
alter table public.media_sources_v2 rename to media_sources;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.media_sources'::regclass and conname like 'media\_sources\_v2\_%'
  loop
    execute format('alter table public.media_sources rename constraint %I to %I',
                   c.conname, replace(c.conname, 'media_sources_v2_', 'media_sources_'));
  end loop;
end $$;

-- ═════════════ Index B-tree (non partiels : utilisables quel que soit le filtre is_active)
-- lecture d'un film / d'un épisode, triée par priorité
create index media_sources_title_idx on public.media_sources (title_id, priority) where title_id is not null;
create index media_sources_episode_idx on public.media_sources (episode_id, priority) where episode_id is not null;
-- unicité + recherche par hébergeur (préfixe provider) : remplace un index provider seul (4 valeurs → inutile)
create unique index media_sources_provider_file_uidx on public.media_sources (provider, file_id);  -- non partiel : cible ON CONFLICT (import massif) ; NULL multiples autorisés (alist/other)
-- dédoublonnage pipeline (provider + empreinte)
create index media_sources_checksum_idx on public.media_sources (provider, checksum) where checksum is not null;

-- ═════════════ Intégrité, RLS, droits
create trigger media_sources_movie_only before insert or update of title_id on public.media_sources
  for each row execute function public.assert_title_type('movie');

alter table public.media_sources enable row level security;
revoke all on public.media_sources from anon, authenticated;
grant select, insert, update, delete on public.media_sources to authenticated;  -- filtré par RLS (admin)
grant all on public.media_sources to service_role;
create policy media_sources_admin on public.media_sources for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ═════════════ Fonctions dépendantes
create or replace function public.get_available_qualities(p_title_id uuid default null, p_episode_id uuid default null)
returns table (quality public.video_quality, audio_languages text[], subtitle_languages text[])
language sql stable security definer set search_path = '' as $$
  select distinct on (ms.quality) ms.quality, coalesce(ms.audio_languages, '{}'), coalesce(ms.subtitle_languages, '{}')
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

-- admin_save_title : sources [{id?, provider, file_id, raw_url, quality, priority, is_active}]
create or replace function public.admin_save_title(
  p_title jsonb,
  p_genre_ids smallint[] default '{}',
  p_sources jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_title ->> 'id', '')::uuid;
  v_type public.title_type := (p_title ->> 'type')::public.title_type;
  v_keep uuid[];
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.titles (type, slug, title, original_title, synopsis, release_year, runtime_minutes,
                               maturity_rating, poster_url, backdrop_url, logo_url, trailer_url, is_published)
    values (v_type, p_title ->> 'slug', p_title ->> 'title', nullif(p_title ->> 'original_title', ''),
            nullif(p_title ->> 'synopsis', ''), nullif(p_title ->> 'release_year', '')::smallint,
            nullif(p_title ->> 'runtime_minutes', '')::smallint, nullif(p_title ->> 'maturity_rating', ''),
            nullif(p_title ->> 'poster_url', ''), nullif(p_title ->> 'backdrop_url', ''),
            nullif(p_title ->> 'logo_url', ''), nullif(p_title ->> 'trailer_url', ''),
            coalesce((p_title ->> 'is_published')::boolean, false))
    returning id into v_id;
  else
    update public.titles set
      type            = v_type,
      slug            = p_title ->> 'slug',
      title           = p_title ->> 'title',
      original_title  = nullif(p_title ->> 'original_title', ''),
      synopsis        = nullif(p_title ->> 'synopsis', ''),
      release_year    = nullif(p_title ->> 'release_year', '')::smallint,
      runtime_minutes = nullif(p_title ->> 'runtime_minutes', '')::smallint,
      maturity_rating = nullif(p_title ->> 'maturity_rating', ''),
      poster_url      = nullif(p_title ->> 'poster_url', ''),
      backdrop_url    = nullif(p_title ->> 'backdrop_url', ''),
      logo_url        = nullif(p_title ->> 'logo_url', ''),
      trailer_url     = nullif(p_title ->> 'trailer_url', ''),
      is_published    = coalesce((p_title ->> 'is_published')::boolean, false)
    where id = v_id;
    if not found then
      raise exception 'title % not found', v_id using errcode = 'P0002';
    end if;
  end if;

  delete from public.title_genres where title_id = v_id and genre_id <> all (coalesce(p_genre_ids, '{}'));
  insert into public.title_genres (title_id, genre_id)
  select v_id, g from unnest(coalesce(p_genre_ids, '{}')) g
  on conflict do nothing;

  if p_sources is not null and v_type = 'movie' then
    select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_keep
    from jsonb_array_elements(p_sources) s where nullif(s ->> 'id', '') is not null;

    delete from public.media_sources where title_id = v_id and id <> all (v_keep);

    update public.media_sources m set
      provider  = (s ->> 'provider')::public.video_provider,
      file_id   = case when s ->> 'provider' in ('pixeldrain', 'onefichier') then nullif(s ->> 'file_id', '') end,
      raw_url   = case when s ->> 'provider' in ('alist', 'other') then nullif(s ->> 'raw_url', '') end,
      quality   = (s ->> 'quality')::public.video_quality,
      priority  = coalesce(nullif(s ->> 'priority', '')::smallint, 100),
      is_active = coalesce((s ->> 'is_active')::boolean, true)
    from jsonb_array_elements(p_sources) s
    where nullif(s ->> 'id', '') is not null and m.id = (s ->> 'id')::uuid and m.title_id = v_id;

    insert into public.media_sources (title_id, provider, file_id, raw_url, quality, priority, is_active)
    select v_id, (s ->> 'provider')::public.video_provider,
           case when s ->> 'provider' in ('pixeldrain', 'onefichier') then nullif(s ->> 'file_id', '') end,
           case when s ->> 'provider' in ('alist', 'other') then nullif(s ->> 'raw_url', '') end,
           (s ->> 'quality')::public.video_quality, coalesce(nullif(s ->> 'priority', '')::smallint, 100),
           coalesce((s ->> 'is_active')::boolean, true)
    from jsonb_array_elements(p_sources) s
    where nullif(s ->> 'id', '') is null;
  end if;

  return v_id;
end $$;
revoke all on function public.admin_save_title(jsonb, smallint[], jsonb) from public, anon;
grant execute on function public.admin_save_title(jsonb, smallint[], jsonb) to authenticated;

analyze public.media_sources;
