-- Catalogue : « canceling statement due to statement timeout » (11 s pour la 1re page sans filtre).
-- Après quelques appels, PL/pgSQL garde un plan générique : le tri (CASE sur p_sort) n'y est pas connu, donc les 95 000
-- vidéos étaient triées en entier, en plus du count(*) over () qui empêche de s'arrêter aux 30 premières.
-- Ici la requête est construite avec le tri écrit en clair (EXECUTE : plan propre à chaque appel, index utilisés) et le
-- total est compté à part (parcours d'index seulement).
-- index des tris qui n'en avaient pas (A→Z / Z→A, plus courtes d'abord)
create index if not exists titles_pub_title_idx on public.titles (lower(title), id) where is_published;
create index if not exists titles_pub_len_asc_idx on public.titles (len_key asc nulls last, id) where is_published;

create or replace function public.search_catalog(p_q text default null, p_sort text default null, p_limit integer default 30,
  p_offset integer default 0, p_model uuid default null, p_min_s integer default null, p_max_s integer default null,
  p_exact boolean default false, p_kids boolean default false, p_type public.title_type default null, p_genre text default null)
returns table(id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint, runtime_minutes smallint,
  maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz, genres jsonb, rank real, total_count bigint)
language plpgsql stable set search_path to ''
as $function$
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
  w text;
  ord text;
  total bigint;
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
        union all select t.id from public.titles t where q operator(extensions.<%) t.title_norm
      ) u;
    end if;
  end if;

  -- filtres : seuls ceux demandés sont écrits (le planificateur choisit l'index adapté)
  -- $1 ids, $2 type, $3 modèle, $4 min, $5 max, $6 genre, $7 q, $8 tsq, $9 mdl, $10 lim, $11 off
  w := 't.is_published'
    || case when q is not null then ' and t.id = any($1)' else '' end
    || case when p_type is not null then ' and t.type = $2' else '' end
    || case when p_model is not null then ' and t.model_id = $3' else '' end
    || case when min_m is not null then ' and t.len_key >= $4' else '' end
    || case when max_m is not null then ' and t.len_key <= $5' else '' end
    || case when coalesce(p_kids, false) then ' and public.is_kids_safe(t.maturity_rating, t.id)' else '' end
    || case when p_genre is not null then ' and exists (select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = t.id and g.slug = $6)' else '' end;

  -- chaque tri suit exactement un index (départage par id dans le même sens : parcours d'index direct ou inverse)
  ord := case
      when p_sort = 'longest' then 't.len_key desc nulls last, t.id'
      when p_sort = 'shortest' then 't.len_key asc nulls last, t.id'
      when p_sort = 'old' then 't.published_at asc nulls first, t.id desc'
      when p_sort = 'az' then 'lower(t.title) asc, t.id'
      when p_sort = 'za' then 'lower(t.title) desc, t.id desc'
      when q is null then 't.published_at desc nulls last, t.id'
      when p_sort = 'recent' then 't.published_at desc nulls last, rk desc, t.id'
      else 'rk desc, t.published_at desc nulls last, t.id' end;

  execute 'select count(*) from public.titles t where ' || w
    into total using ids, p_type, p_model, min_m, max_m, p_genre;
  if total = 0 then return; end if;

  -- page : sous-requête triée + limitée (s'arrête aux N premières), puis genres pour ces N lignes seulement
  return query execute
    'select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating, t.poster_url,
            t.backdrop_url, t.logo_url, t.published_at,
            coalesce((select jsonb_agg(jsonb_build_object(''slug'', g.slug, ''name'', g.name) order by g.name)
                        from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = t.id), ''[]''::jsonb),
            t.rk, $12::bigint
       from (select t.*, ' || case when q is null then '0::real' else
              '(ts_rank_cd(t.search, $8) * 2 + extensions.similarity(t.title_norm, $7) + extensions.word_similarity($7, t.title_norm)
               + case when t.title_norm = $7 then 3 when t.title_norm like $7 || ''%'' then 1.5 when t.title_norm like ''%'' || $7 || ''%'' then 0.75 else 0 end
               + case when t.model_id = any($9) then 1.25 else 0 end)::real' end || ' as rk
               from public.titles t where ' || w || '
              order by ' || ord || ' limit $10 offset $11) t
      order by ' || ord
    using ids, p_type, p_model, min_m, max_m, p_genre, q, tsq, mdl, lim, off, total;
end $function$;
