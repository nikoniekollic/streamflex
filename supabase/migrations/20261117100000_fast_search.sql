-- Recherche rapide + filtres (durée, modèle, correspondance exacte) + tri des modèles
--  • l'ancienne recherche examinait les 60 000 titres un par un (OU entre plusieurs conditions, accents retirés à la volée,
--    ressemblance calculée sur chaque titre et chaque résumé) : ~7 s. Les candidats viennent maintenant des index
--    (texte intégral, trigrammes sur le titre normalisé, modèle), la recherche approchée n'intervient que si peu de résultats.
--  • titre normalisé (minuscules, sans accents) stocké : plus de recalcul à chaque comparaison.
--  • search_catalog : filtres de durée (secondes), modèle, correspondance exacte ; search_titles en devient un simple relais.
--  • catalog_models : tri (plus / moins de vidéos, nom, nouveautés, durée totale) et filtre par nom ; search_models pour la recherche.

alter table public.titles add column if not exists title_norm text generated always as (lower(public.f_unaccent(coalesce(title, '')))) stored;
create index if not exists titles_title_norm_trgm on public.titles using gin (title_norm extensions.gin_trgm_ops);
drop index if exists public.titles_title_unaccent_trgm;
create index if not exists titles_pub_len_idx on public.titles (len_key desc nulls last, id) where is_published;
create index if not exists titles_pub_date_idx on public.titles (published_at desc nulls last, id) where is_published;
create index if not exists titles_model_pub_idx on public.titles (model_id, published_at desc) where is_published and model_id is not null;

create or replace function public.search_catalog(
  p_q text default null, p_sort text default null, p_limit integer default 30, p_offset integer default 0,
  p_model uuid default null, p_min_s integer default null, p_max_s integer default null, p_exact boolean default false,
  p_kids boolean default false, p_type public.title_type default null, p_genre text default null)
returns table(id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint, runtime_minutes smallint,
              maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz, genres jsonb,
              rank real, total_count bigint)
language plpgsql stable set search_path to '' as $$
#variable_conflict use_column
declare
  q text := nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '');
  tsq tsquery;
  lim int := least(greatest(coalesce(p_limit, 30), 1), 600);
  off int := greatest(coalesce(p_offset, 0), 0);
  min_m real := case when p_min_s > 0 then p_min_s / 60.0 end;
  max_m real := case when p_max_s > 0 then p_max_s / 60.0 end;
  ids uuid[];
  mdl uuid[];
begin
  if q is not null then
    tsq := websearch_to_tsquery('simple', q);
    select coalesce(array_agg(md.id), '{}') into mdl from public.models md
     where length(q) >= 2 and (case when p_exact then lower(public.f_unaccent(md.name)) = q else lower(public.f_unaccent(md.name)) like '%' || q || '%' end);
    -- candidats par les index
    select coalesce(array_agg(distinct c.id), '{}') into ids from (
      select t.id from public.titles t where not p_exact and t.search @@ tsq
      union all select t.id from public.titles t where t.title_norm like '%' || q || '%'
      union all select t.id from public.titles t where t.model_id = any(mdl)
    ) c;
    -- peu de résultats : recherche approchée (fautes de frappe), seulement alors
    if not p_exact and length(q) >= 3 and cardinality(ids) < 12 then
      select coalesce(array_agg(distinct x), '{}') into ids from (
        select unnest(ids) as x
        union all select t.id from public.titles t where t.title_norm operator(extensions.%) q and extensions.similarity(t.title_norm, q) > 0.35
      ) u;
    end if;
  end if;

  return query
  with base as (
    select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating, t.poster_url, t.backdrop_url,
           t.logo_url, t.published_at, t.len_key, t.title_norm, t.model_id,
           case when q is null then 0::real else (
             ts_rank_cd(t.search, tsq) * 2 + extensions.similarity(t.title_norm, q)
             + case when t.title_norm = q then 3 when t.title_norm like q || '%' then 1.5 when t.title_norm like '%' || q || '%' then 0.75 else 0 end
             + case when t.model_id = any(mdl) then 1.25 else 0 end)::real end as rk
      from public.titles t
     where t.is_published
       and (q is null or t.id in (select unnest(ids)))  -- sous-requête hachée : rapide même avec des milliers de candidats
       and (p_type is null or t.type = p_type)
       and (p_model is null or t.model_id = p_model)
       and (min_m is null or t.len_key >= min_m)
       and (max_m is null or t.len_key <= max_m)
       and (not coalesce(p_kids, false) or public.is_kids_safe(t.maturity_rating, t.id))
       and (p_genre is null or exists (select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = t.id and g.slug = p_genre))
  ), page as (
    select b.*, count(*) over () as n from base b
     order by
       case when p_sort = 'longest' then b.len_key end desc nulls last,
       case when p_sort = 'shortest' then b.len_key end asc nulls last,
       case when p_sort = 'old' then b.published_at end asc nulls last,
       case when p_sort = 'recent' or (p_sort is null and q is null) then b.published_at end desc nulls last,
       case when p_sort = 'az' then lower(b.title) end asc,
       case when p_sort = 'za' then lower(b.title) end desc,
       b.rk desc, b.published_at desc nulls last, b.id
     limit lim offset off
  )
  select p.id, p.type, p.slug, p.title, p.synopsis, p.release_year, p.runtime_minutes, p.maturity_rating, p.poster_url, p.backdrop_url,
         p.logo_url, p.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name) order by g.name)
                     from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = p.id), '[]'::jsonb),
         p.rk, p.n
    from page p
   order by
     case when p_sort = 'longest' then p.len_key end desc nulls last,
     case when p_sort = 'shortest' then p.len_key end asc nulls last,
     case when p_sort = 'old' then p.published_at end asc nulls last,
     case when p_sort = 'recent' or (p_sort is null and q is null) then p.published_at end desc nulls last,
     case when p_sort = 'az' then lower(p.title) end asc,
     case when p_sort = 'za' then lower(p.title) end desc,
     p.rk desc, p.published_at desc nulls last, p.id;
end $$;

-- ancienne signature conservée (cache du catalogue, anciennes versions du site) : relais vers la recherche rapide
create or replace function public.search_titles(p_q text DEFAULT NULL::text, p_type public.title_type DEFAULT NULL::public.title_type, p_genre text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_kids boolean DEFAULT false, p_sort text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint, runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamp with time zone, genres jsonb, rank real, total_count bigint)
 LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  select * from public.search_catalog(p_q, p_sort, p_limit, p_offset, null, null, null, false, p_kids, p_type, p_genre);
$function$;

grant execute on function public.search_catalog(text, text, integer, integer, uuid, integer, integer, boolean, boolean, public.title_type, text) to anon, authenticated, service_role;

-- ───────── Modèles : tri et filtre par nom
drop function if exists public.catalog_models(integer, integer);
create or replace function public.catalog_models(p_limit integer default 48, p_offset integer default 0, p_sort text default null, p_q text default null)
 RETURNS TABLE(id uuid, name text, image_url text, titles_count bigint, total bigint, cover_title_id uuid, cover_pos real, total_minutes real, last_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with qn as (select nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '') as q),
  m as (
    select md.id, md.name, md.image_url, md.cover_pos as mpos, count(t.id) as n, sum(t.len_key)::real as mins, max(t.published_at) as last_at,
           coalesce(
             (select t2.id from public.titles t2 where t2.id = md.cover_title_id and t2.model_id = md.id and t2.is_published),
             (array_agg(t.id order by t.published_at desc nulls last, t.id))[1]
           ) as cover_title_id
    from public.models md
    join public.titles t on t.model_id = md.id and t.is_published
    where (select q from qn) is null or lower(public.f_unaccent(md.name)) like '%' || (select q from qn) || '%'
    group by md.id
  ), page as (
    select m.*, count(*) over () as total from m
    order by
      case when p_sort = 'least' then m.n end asc,
      case when p_sort = 'az' then lower(m.name) end asc,
      case when p_sort = 'za' then lower(m.name) end desc,
      case when p_sort = 'recent' then m.last_at end desc nulls last,
      case when p_sort = 'longest' then m.mins end desc nulls last,
      m.n desc, m.name
    limit greatest(least(p_limit, 200), 1) offset greatest(p_offset, 0)
  )
  select p.id, p.name, p.image_url, p.n, p.total, p.cover_title_id,
         coalesce(p.mpos, (select t.cover_pos from public.titles t where t.id = p.cover_title_id)), p.mins, p.last_at
  from page p
  order by
    case when p_sort = 'least' then p.n end asc,
    case when p_sort = 'az' then lower(p.name) end asc,
    case when p_sort = 'za' then lower(p.name) end desc,
    case when p_sort = 'recent' then p.last_at end desc nulls last,
    case when p_sort = 'longest' then p.mins end desc nulls last,
    p.n desc, p.name
$function$;
revoke all on function public.catalog_models(integer, integer, text, text) from public, anon;
grant execute on function public.catalog_models(integer, integer, text, text) to authenticated, service_role;
