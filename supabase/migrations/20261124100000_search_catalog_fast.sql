-- Recherche : les mots courants (« video » : 75 000 titres) dépassaient la limite de 8 s.
--  • plus de liste d'identifiants (jusqu'à 90 000) dédupliquée puis comparée ligne à ligne : la condition est écrite
--    directement (index plein texte OU trigrammes OU modèle, combinés par le planificateur) ;
--  • recherche approchée (fautes de frappe) seulement s'il y a moins de 12 résultats, comme avant ;
--  • plus de 10 000 résultats (mot très courant) : on ne lit plus toute la table — sur l'offre gratuite, chaque page hors
--    mémoire se lit lentement (8 s au premier passage pour 75 000 titres). Le total renvoyé vaut alors 10 001 (le site
--    affiche « plus de 10 000 ») — sauf le catalogue entier sans filtre : nombre de titres d'après les statistiques de la
--    table — et les vidéos viennent dans l'ordre d'un index (les plus récentes par défaut) : la base s'arrête aux 30 premières.
create or replace function public.search_catalog(p_q text default null::text, p_sort text default null::text, p_limit integer default 30, p_offset integer default 0, p_model uuid default null::uuid, p_min_s integer default null::integer, p_max_s integer default null::integer, p_exact boolean default false, p_kids boolean default false, p_type title_type default null::title_type, p_genre text default null::text)
 returns table(id uuid, type title_type, slug text, title text, synopsis text, release_year smallint, runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamp with time zone, genres jsonb, rank real, total_count bigint)
 language plpgsql
 stable
 set search_path to ''
as $function$
#variable_conflict use_column
declare
  q text := nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '');
  tsq tsquery;
  pat text;
  lim int := least(greatest(coalesce(p_limit, 30), 1), 600);
  off int := greatest(coalesce(p_offset, 0), 0);
  min_m real := case when p_min_s > 0 then p_min_s / 60.0 end;
  max_m real := case when p_max_s > 0 then p_max_s / 60.0 end;
  ids uuid[];
  mdl uuid[] := '{}';
  w text;
  filt text;
  match text := '';
  rk text;
  ord text;
  total bigint;
  big boolean := false; -- plus de 10 000 résultats
  -- texte cherché écrit en clair (échappé) dans les requêtes : passé en paramètre, le planificateur ne connaissait pas le
  -- motif et choisissait un parcours d'index 20 fois plus lent qu'une simple lecture de la table pour un mot courant
  lq text;
  ltsq text;
  lpat text;
begin
  if q is not null then
    tsq := websearch_to_tsquery('simple', q);
    pat := '%' || q || '%';
    lq := quote_literal(q);
    ltsq := quote_literal(tsq::text) || '::tsquery';
    lpat := quote_literal(pat);
    select coalesce(array_agg(md.id), '{}') into mdl from public.models md
     where length(q) >= 2 and (case when p_exact then lower(public.f_unaccent(md.name)) = q else lower(public.f_unaccent(md.name)) like pat end);
    match := ' and (' || case when not p_exact then 't.search @@ ' || ltsq || ' or ' else '' end
          || 't.title_norm like ' || lpat || '' || case when cardinality(mdl) > 0 then ' or t.model_id = any($9)' else '' end || ')';
  end if;

  -- filtres : seuls ceux demandés sont écrits (le planificateur choisit l'index adapté)
  -- $1 ids, $2 type, $3 modèle, $4 min, $5 max, $6 genre, $9 mdl, $10 lim, $11 off, $12 total (texte cherché : écrit en clair)
  filt := case when p_type is not null then ' and t.type = $2' else '' end
    || case when p_model is not null then ' and t.model_id = $3' else '' end
    || case when min_m is not null then ' and t.len_key >= $4' else '' end
    || case when max_m is not null then ' and t.len_key <= $5' else '' end
    || case when coalesce(p_kids, false) then ' and public.is_kids_safe(t.maturity_rating, t.id)' else '' end
    || case when p_genre is not null then ' and exists (select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = t.id and g.slug = $6)' else '' end;
  w := 't.is_published' || match || filt;

  -- total compté jusqu'à 10 001 seulement
  execute 'select count(*) from (select 1 from public.titles t where ' || w || ' limit 10001) x'
    into total using ids, p_type, p_model, min_m, max_m, p_genre, q, tsq, mdl, lim, off, null::bigint, pat;
  if total > 10000 then
    big := true;
    if q is null and filt = '' then
      select greatest(10001, c.reltuples::bigint) into total from pg_catalog.pg_class c where c.oid = 'public.titles'::regclass;
    end if;
  end if;

  -- peu de résultats : recherche approchée (fautes de frappe), seulement alors
  if q is not null and not p_exact and length(q) >= 3 and total < 12 then
    perform extensions.similarity('a', 'a'); -- module trigrammes chargé avant de régler son seuil
    perform set_config('pg_trgm.word_similarity_threshold', '0.4', true);
    execute 'select coalesce(array_agg(distinct x), ''{}'') from (
               select t.id as x from public.titles t where t.is_published' || match || '
               union all select t.id from public.titles t where ' || lq || ' operator(extensions.<%) t.title_norm) u'
      into ids using ids, p_type, p_model, min_m, max_m, p_genre, q, tsq, mdl, lim, off, null::bigint, pat;
    w := 't.is_published and t.id = any($1)' || filt;
    execute 'select count(*) from public.titles t where ' || w
      into total using ids, p_type, p_model, min_m, max_m, p_genre, q, tsq, mdl, lim, off, null::bigint, pat;
  end if;
  if total = 0 then return; end if;

  rk := case
      when q is null then '0::real'
      when big then '0::real'
      else
        '(ts_rank_cd(t.search, ' || ltsq || ') * 2 + extensions.similarity(t.title_norm, ' || lq || ') + extensions.word_similarity(' || lq || ', t.title_norm)
          + case when t.title_norm = ' || lq || ' then 3 when t.title_norm like ' || lq || ' || ''%'' then 1.5 when t.title_norm like ' || lpat || ' then 0.75 else 0 end
          + case when t.model_id = any($9) then 1.25 else 0 end)::real' end;

  -- chaque tri suit exactement un index (départage par id dans le même sens : parcours d'index direct ou inverse)
  ord := case
      when p_sort = 'longest' then 't.len_key desc nulls last, t.id'
      when p_sort = 'shortest' then 't.len_key asc nulls last, t.id'
      when p_sort = 'old' then 't.published_at asc nulls first, t.id desc'
      when p_sort = 'az' then 'lower(t.title) asc, t.id'
      when p_sort = 'za' then 'lower(t.title) desc, t.id desc'
      when q is null or big then 't.published_at desc nulls last, t.id'
      when p_sort = 'recent' then 't.published_at desc nulls last, rk desc, t.id'
      else 'rk desc, t.published_at desc nulls last, t.id' end;

  -- page : sous-requête triée + limitée (s'arrête aux N premières), puis genres pour ces N lignes seulement
  return query execute
    'select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating, t.poster_url,
            t.backdrop_url, t.logo_url, t.published_at,
            coalesce((select jsonb_agg(jsonb_build_object(''slug'', g.slug, ''name'', g.name) order by g.name)
                        from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = t.id), ''[]''::jsonb),
            t.rk, $12::bigint
       from (select t.*, ' || rk || ' as rk
               from public.titles t where ' || w || '
              order by ' || ord || ' limit $10 offset $11) t
      order by ' || ord
    using ids, p_type, p_model, min_m, max_m, p_genre, q, tsq, mdl, lim, off, total, pat;
end $function$;
