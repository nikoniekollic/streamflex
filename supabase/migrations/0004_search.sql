-- 0004_search.sql — recherche plein texte insensible aux accents + tolérance aux fautes (trigram)
create extension if not exists unaccent with schema extensions;

create or replace function public.f_unaccent(text)
returns text language sql immutable parallel safe strict set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- Vecteur de recherche recalculé sans accents (titre A, titre original B, synopsis C)
drop index if exists public.titles_search_idx;
drop index if exists public.titles_title_trgm;
alter table public.titles drop column if exists search;
alter table public.titles add column search tsvector generated always as (
  setweight(to_tsvector('simple', public.f_unaccent(coalesce(title, ''))), 'A') ||
  setweight(to_tsvector('simple', public.f_unaccent(coalesce(original_title, ''))), 'B') ||
  setweight(to_tsvector('simple', public.f_unaccent(coalesce(synopsis, ''))), 'C')
) stored;

create index titles_search_idx on public.titles using gin (search);
create index titles_title_unaccent_trgm on public.titles
  using gin ((lower(public.f_unaccent(title))) extensions.gin_trgm_ops);

create or replace function public.search_titles(
  p_q text default null,
  p_type public.title_type default null,
  p_genre text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint,
  runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text,
  published_at timestamptz, genres jsonb, rank real, total_count bigint
)
language sql stable security invoker set search_path = '' as $$
  with params as (
    select
      nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '') as q,
      least(greatest(coalesce(p_limit, 30), 1), 100) as lim,
      greatest(coalesce(p_offset, 0), 0) as off
  ),
  base as (
    select t.*, p.q,
      case when p.q is null then null else websearch_to_tsquery('simple', p.q) end as tsq,
      lower(public.f_unaccent(t.title)) as t_norm
    from public.titles t, params p
    where t.is_published
      and (p_type is null or t.type = p_type)
      and (p_genre is null or exists (
        select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id
        where tg.title_id = t.id and g.slug = p_genre))
  ),
  matched as (
    select b.*,
      case when b.q is null then 0::real else (
        ts_rank_cd(b.search, b.tsq) * 2
        + extensions.similarity(b.t_norm, b.q)
        + case when b.t_norm = b.q then 3 when b.t_norm like b.q || '%' then 1.5 when b.t_norm like '%' || b.q || '%' then 0.75 else 0 end
      )::real end as rank
    from base b
    where b.q is null
       or b.search @@ b.tsq
       or b.t_norm like '%' || b.q || '%'
       or lower(public.f_unaccent(coalesce(b.synopsis, ''))) like '%' || b.q || '%'
       or extensions.similarity(b.t_norm, b.q) > 0.3
       or extensions.word_similarity(b.q, b.t_norm) > 0.5
  )
  select m.id, m.type, m.slug, m.title, m.synopsis, m.release_year, m.runtime_minutes, m.maturity_rating,
         m.poster_url, m.backdrop_url, m.logo_url, m.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name) order by g.name)
                   from public.title_genres tg join public.genres g on g.id = tg.genre_id
                   where tg.title_id = m.id), '[]'::jsonb) as genres,
         m.rank,
         count(*) over () as total_count
  from matched m, params p
  order by m.rank desc, m.published_at desc nulls last, m.title
  limit (select lim from params) offset (select off from params);
$$;

grant execute on function public.search_titles(text, public.title_type, text, integer, integer) to authenticated;
revoke execute on function public.search_titles(text, public.title_type, text, integer, integer) from anon, public;
grant execute on function public.f_unaccent(text) to authenticated;
