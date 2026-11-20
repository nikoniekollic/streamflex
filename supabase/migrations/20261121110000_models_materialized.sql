-- Liste des modèles : le planificateur recalculait les comptes de tous les titres pour CHAQUE modèle (150 ×, ~2 s).
-- Les comptes sont maintenant calculés une seule fois.

create or replace function public.catalog_models(p_limit integer default 48, p_offset integer default 0, p_sort text default null, p_q text default null)
 RETURNS TABLE(id uuid, name text, image_url text, titles_count bigint, total bigint, cover_title_id uuid, cover_pos real, total_minutes real, last_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with qn as (select nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '') as q),
  st as materialized (
    -- index couvrant, calculé UNE fois (sans « materialized », le planificateur le recalculait pour chaque modèle : 150 ×)
    select t.model_id, count(*) as n, sum(t.len_key)::real as mins, max(t.published_at) as last_at
      from public.titles t
     where t.is_published and t.model_id is not null
     group by t.model_id
  ), m as (
    select md.id, md.name, md.image_url, md.cover_pos as mpos, md.cover_title_id as chosen, st.n, st.mins, st.last_at
      from st join public.models md on md.id = st.model_id
     where (select q from qn) is null or lower(public.f_unaccent(md.name)) like '%' || (select q from qn) || '%'
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
  ), cov as (
    -- jaquette : celle choisie dans l'admin si elle est toujours publiée, sinon la vidéo la plus récente (seulement pour la page)
    select p.*,
           coalesce(
             (select t2.id from public.titles t2 where t2.id = p.chosen and t2.model_id = p.id and t2.is_published),
             (select t3.id from public.titles t3 where t3.model_id = p.id and t3.is_published order by t3.published_at desc nulls last, t3.id limit 1)
           ) as cover_id
      from page p
  )
  select c.id, c.name, c.image_url, c.n, c.total, c.cover_id,
         coalesce(c.mpos, (select t.cover_pos from public.titles t where t.id = c.cover_id)), c.mins, c.last_at
  from cov c
  order by
    case when p_sort = 'least' then c.n end asc,
    case when p_sort = 'az' then lower(c.name) end asc,
    case when p_sort = 'za' then lower(c.name) end desc,
    case when p_sort = 'recent' then c.last_at end desc nulls last,
    case when p_sort = 'longest' then c.mins end desc nulls last,
    c.n desc, c.name
$function$;
revoke all on function public.catalog_models(integer, integer, text, text) from public, anon;
grant execute on function public.catalog_models(integer, integer, text, text) to authenticated, service_role;
