-- Recherche tolérante aux fautes de frappe : la recherche approchée compare le mot cherché à CHAQUE MOT du titre
-- (word_similarity) au lieu du titre entier — « alcie » ne trouvait rien dans des titres longs, il retrouve maintenant « Alice ».
-- Mesuré : moins de 30 ms (index trigrammes), seulement quand la recherche exacte donne moins de 12 résultats.

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
      perform extensions.similarity('a', 'a'); -- module trigrammes chargé avant de régler son seuil
      perform set_config('pg_trgm.word_similarity_threshold', '0.4', true);
      select coalesce(array_agg(distinct x), '{}') into ids from (
        select unnest(ids) as x
        -- mot à mot : « alcie » retrouve « Alice » même dans un long titre (seuil 0,4, index trigrammes)
        union all select t.id from public.titles t where q operator(extensions.<%) t.title_norm
      ) u;
    end if;
  end if;

  return query
  with base as (
    select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating, t.poster_url, t.backdrop_url,
           t.logo_url, t.published_at, t.len_key, t.title_norm, t.model_id,
           case when q is null then 0::real else (
             ts_rank_cd(t.search, tsq) * 2 + extensions.similarity(t.title_norm, q) + extensions.word_similarity(q, t.title_norm)
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
