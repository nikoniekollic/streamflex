-- Scan 1fichier plus fiable + métadonnées des fichiers
--  • collision d'adresse (slug) : un fichier dont l'adresse existait déjà n'était JAMAIS importé (insertion ignorée à chaque
--    relevé). L'adresse reçoit maintenant un suffixe unique en cas de collision.
--  • métadonnées 1fichier conservées (empreinte, type, date d'envoi) : un fichier ré-envoyé (nouvel identifiant) reprend sa vidéo
--    existante (durée, image, vues, favoris) au lieu de créer un doublon ; une copie identique déjà présente n'est pas ré-importée.
--  • dossiers de plus de 5 000 fichiers : relevés par tranches de dates (colonnes win_*), pour voir les fichiers au-delà de la limite.
--  • recherche : le nom du modèle et la date du fichier comptent aussi.

alter table public.media_sources
  add column if not exists remote_checksum text,  -- empreinte donnée par 1fichier (la colonne checksum est un sha256 binaire)
  add column if not exists content_type text,
  add column if not exists remote_date timestamptz;
create index if not exists media_sources_remote_checksum_idx on public.media_sources (remote_checksum) where remote_checksum is not null;
create index if not exists media_sources_size_name_idx on public.media_sources (size_bytes, remote_name) where provider = 'onefichier';

alter table public.titles add column if not exists file_date timestamptz;

alter table public.watch_folders
  add column if not exists win_turn boolean not null default false,       -- prochain passage : relevé par tranche de dates
  add column if not exists win_unsupported boolean not null default false,
  add column if not exists win_cursor timestamptz,                         -- fin de la prochaine tranche à remonter (rattrapage)
  add column if not exists win_span_days int not null default 60,
  add column if not exists recent_at timestamptz;                          -- dernière tranche « fichiers récents »

-- ───────── Synchronisation d'un dossier (remplace la version précédente)
create or replace function public.sync_onefichier_folder(
  p_folder bigint, p_files jsonb, p_publish boolean, p_model_id uuid, p_poster text, p_reassign boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int := 0; v_renamed int := 0; v_moved int := 0; v_restored int := 0; v_relinked int := 0; v_dups int := 0;
        v_total int := coalesce(jsonb_array_length(p_files), 0);
begin
  create temp table if not exists _sf_src (fid text primary key, slug text, title text, name text, quality text, size bigint, container text,
                                           checksum text, ctype text, fdate timestamptz) on commit drop;
  truncate _sf_src;
  insert into _sf_src
  select distinct on (f->>'id') f->>'id', f->>'slug', f->>'title', coalesce(f->>'name', f->>'title'),
         coalesce(f->>'quality', '1080p'), nullif(f->>'size', '')::bigint, nullif(f->>'container', ''),
         nullif(btrim(coalesce(f->>'checksum', '')), ''), nullif(left(coalesce(f->>'ctype', ''), 80), ''),
         case when f->>'date' ~ '^\d{4}-\d{2}-\d{2}' then (f->>'date')::timestamptz end
    from jsonb_array_elements(p_files) f
   where f->>'id' ~ '^[A-Za-z0-9]{4,32}$';

  -- 1. Fichiers déjà connus (même identifiant) : renommés, déplacés, revenus ; métadonnées complétées
  with ex as (
    select ms.id as ms_id, ms.title_id, ms.folder_id as old_folder, ms.remote_name as old_name, ms.remote_title as old_title, ms.removed_at,
           t.title as cur_title, t.model_id as cur_model, t.file_date, s.*
      from _sf_src s
      join public.media_sources ms on ms.provider = 'onefichier' and ms.file_id = s.fid
      join public.titles t on t.id = ms.title_id
  ), flags as (
    select e.*,
           (e.old_name is not null and e.old_name <> e.name and e.old_title is not null and e.cur_title = e.old_title and e.title <> e.cur_title) as do_rename,
           ((p_reassign or (e.old_folder is not null and e.old_folder <> p_folder)) and p_model_id is not null and e.cur_model is distinct from p_model_id) as do_move
      from ex e
  ), upd_t as (
    update public.titles t
       set title = case when f.do_rename then f.title else t.title end,
           model_id = case when f.do_move then p_model_id else t.model_id end,
           poster_url = case when f.do_move then (case when p_poster is not null then p_poster when t.poster_url like '%#model' then null else t.poster_url end) else t.poster_url end,
           is_published = case when f.removed_at is not null then true else t.is_published end,
           file_date = coalesce(t.file_date, f.fdate)
      from flags f
     where t.id = f.title_id and (f.do_rename or f.do_move or f.removed_at is not null or (t.file_date is null and f.fdate is not null))
    returning 1
  ), upd_s as (
    update public.media_sources ms
       set folder_id = p_folder, remote_name = f.name,
           remote_title = case when f.do_rename then f.title when f.old_title is null then (case when f.cur_title = f.title then f.title else f.cur_title end) else f.old_title end,
           missing_since = null, removed_at = null, is_active = (ms.is_active or f.removed_at is not null),
           remote_checksum = coalesce(f.checksum, ms.remote_checksum), content_type = coalesce(f.ctype, ms.content_type), remote_date = coalesce(f.fdate, ms.remote_date),
           size_bytes = coalesce(ms.size_bytes, f.size)
      from flags f
     where ms.id = f.ms_id
       and (ms.folder_id is distinct from p_folder or ms.remote_name is distinct from f.name or ms.remote_title is null
            or ms.missing_since is not null or ms.removed_at is not null
            or (ms.remote_checksum is null and f.checksum is not null) or (ms.remote_date is null and f.fdate is not null) or (ms.content_type is null and f.ctype is not null))
    returning 1
  )
  select (select count(*) from flags where do_rename),
         (select count(*) from flags where do_move and old_folder is not null and old_folder <> p_folder),
         (select count(*) from flags where removed_at is not null)
    into v_renamed, v_moved, v_restored;

  -- 2. Nouveaux identifiants : même contenu déjà connu ? (empreinte, sinon taille + nom exacts)
  create temp table if not exists _sf_new (fid text primary key, match_id uuid, match_gone boolean) on commit drop;
  truncate _sf_new;
  insert into _sf_new
  select s.fid, m.id, (m.missing_since is not null or m.removed_at is not null or not coalesce(m.is_active, true))
    from _sf_src s
    left join lateral (
      select ms.id, ms.missing_since, ms.removed_at, ms.is_active
        from public.media_sources ms
       where ms.provider = 'onefichier' and ms.file_id <> s.fid
         and ((s.checksum is not null and ms.remote_checksum = s.checksum)
              or (s.size is not null and s.size > 1048576 and ms.size_bytes = s.size and ms.remote_name = s.name))
       order by (ms.missing_since is not null or ms.removed_at is not null) desc, ms.created_at desc
       limit 1
    ) m on true
   where not exists (select 1 from public.media_sources x where x.provider = 'onefichier' and x.file_id = s.fid);

  -- 2a. ré-envoi d'un fichier disparu : la vidéo existante reprend le nouveau fichier (durée, image, vues conservées)
  with rel as (
    update public.media_sources ms
       set file_id = s.fid, folder_id = p_folder, remote_name = s.name, missing_since = null, removed_at = null, is_active = true,
           remote_checksum = coalesce(s.checksum, ms.remote_checksum), content_type = coalesce(s.ctype, ms.content_type), remote_date = coalesce(s.fdate, ms.remote_date),
           last_status = null
      from _sf_new n join _sf_src s on s.fid = n.fid
     where n.match_id is not null and n.match_gone and ms.id = n.match_id
    returning ms.title_id
  ), pub as (
    update public.titles t set is_published = true from rel where t.id = rel.title_id and not t.is_published and p_publish
    returning 1
  )
  select count(*) into v_relinked from rel;
  select count(*) into v_dups from _sf_new where match_id is not null and not match_gone;

  -- 2b. vrais nouveaux fichiers : adresse unique garantie (suffixe en cas de collision)
  with fresh as (
    select s.*, case
             when exists (select 1 from public.titles t where t.slug = s.slug) or count(*) over (partition by s.slug) > 1
             then left(s.slug, 70) || '-' || left(md5(s.fid), 8) else s.slug end as slug2
      from _sf_src s join _sf_new n on n.fid = s.fid
     where n.match_id is null
  ), ins_t as (
    insert into public.titles (type, slug, title, is_published, published_at, model_id, poster_url, size_bytes, file_date)
    select 'movie', slug2, title, p_publish, case when p_publish then now() end, p_model_id, p_poster, size, fdate from fresh
    on conflict do nothing
    returning id, slug
  ), ins_s as (
    insert into public.media_sources (title_id, provider, file_id, quality, size_bytes, container, priority, is_active, folder_id, remote_name, remote_title, remote_checksum, content_type, remote_date)
    select t.id, 'onefichier', f.fid, f.quality::public.video_quality, f.size, left(f.container, 8), 10, true, p_folder, f.name, f.title, f.checksum, f.ctype, f.fdate
      from ins_t t join fresh f on f.slug2 = t.slug
    on conflict do nothing
    returning 1
  )
  select count(*) into v_new from ins_s;

  return jsonb_build_object('total', v_total, 'imported', v_new + v_relinked, 'ignored', v_total - v_new - v_relinked, 'renamed', v_renamed,
                            'moved', v_moved, 'restored', v_restored + v_relinked, 'fixed', v_moved, 'relinked', v_relinked, 'duplicates', v_dups);
end $$;

-- ───────── Recherche : le nom du modèle compte aussi (« alice » trouve toutes les vidéos du modèle Alice)
create or replace function public.search_titles(p_q text DEFAULT NULL::text, p_type public.title_type DEFAULT NULL::public.title_type, p_genre text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_kids boolean DEFAULT false, p_sort text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint, runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamp with time zone, genres jsonb, rank real, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (
    select nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '') as q,
           least(greatest(coalesce(p_limit, 30), 1), 600) as lim, greatest(coalesce(p_offset, 0), 0) as off
  ),
  mdl as (
    select md.id from public.models md, params p
     where p.q is not null and length(p.q) >= 2 and lower(public.f_unaccent(md.name)) like '%' || p.q || '%'
  ),
  base as (
    select t.*, p.q,
      case when p.q is null then null else websearch_to_tsquery('simple', p.q) end as tsq,
      lower(public.f_unaccent(t.title)) as t_norm,
      (t.model_id is not null and t.model_id in (select id from mdl)) as by_model
    from public.titles t, params p
    where t.is_published
      and (p_type is null or t.type = p_type)
      and (not coalesce(p_kids, false) or public.is_kids_safe(t.maturity_rating, t.id))
      and (p_genre is null or exists (
        select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id
        where tg.title_id = t.id and g.slug = p_genre))
  ),
  matched as (
    select b.*,
      case when b.q is null then 0::real else (
        ts_rank_cd(b.search, b.tsq) * 2 + extensions.similarity(b.t_norm, b.q)
        + case when b.t_norm = b.q then 3 when b.t_norm like b.q || '%' then 1.5 when b.t_norm like '%' || b.q || '%' then 0.75 else 0 end
        + case when b.by_model then 1.25 else 0 end
      )::real end as rank
    from base b
    where b.q is null or b.by_model or b.search @@ b.tsq or b.t_norm like '%' || b.q || '%'
       or lower(public.f_unaccent(coalesce(b.synopsis, ''))) like '%' || b.q || '%'
       or extensions.similarity(b.t_norm, b.q) > 0.3 or extensions.word_similarity(b.q, b.t_norm) > 0.5
  )
  select m.id, m.type, m.slug, m.title, m.synopsis, m.release_year, m.runtime_minutes, m.maturity_rating,
         m.poster_url, m.backdrop_url, m.logo_url, m.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name) order by g.name)
                   from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = m.id), '[]'::jsonb),
         m.rank, count(*) over ()
  from matched m
  order by
    case when p_sort = 'longest' then m.len_key end desc nulls last,
    case when p_sort = 'shortest' then m.len_key end asc nulls last,
    case when p_sort = 'old' then m.published_at end asc nulls last,
    case when p_sort = 'recent' then m.published_at end desc nulls last,
    case when p_sort = 'az' then lower(m.title) end asc,
    case when p_sort = 'za' then lower(m.title) end desc,
    m.rank desc, m.published_at desc nulls last, m.title, m.id
  limit (select lim from params) offset (select off from params);
$function$;
