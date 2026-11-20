-- « canceling statement due to statement timeout » (limite de 8 s des requêtes du site)
-- Le catalogue a dépassé 87 000 titres et la base lit souvent sur disque : trois requêtes parcouraient TOUTE la table.
--  1. Liste du catalogue (admin), triée par « Modifié le » : aucun index → tri des 87 000 titres, genres / sources / modèle
--     joints à chacun AVANT de garder la page. Index sur updated_at : seules les lignes de la page sont lues.
--  2. Liste des modèles (catalog_models) : agrégation de tous les titres + tableau de tous les identifiants par modèle pour
--     choisir la jaquette. Maintenant : comptes lus dans un index couvrant, jaquette cherchée seulement pour la page affichée.
--  3. Nettoyage 1fichier (sync_onefichier_sweep) : un gros lot de fichiers disparus (milliers) dépassait le délai et
--     l'opération entière était annulée, à chaque passage. Traitement par lots de 2 000, sans attendre les lignes verrouillées
--     par un import en cours ; le reste part au passage suivant.

create index if not exists titles_updated_idx on public.titles (updated_at desc);
create index if not exists titles_model_stats_idx on public.titles (model_id) include (len_key, published_at) where is_published and model_id is not null;
-- vidéo la plus récente d'un modèle (jaquette par défaut) : une seule ligne lue au lieu de parcourir tout le catalogue
create index if not exists titles_model_cover_idx on public.titles (model_id, published_at desc nulls last, id) where is_published;

create or replace function public.catalog_models(p_limit integer default 48, p_offset integer default 0, p_sort text default null, p_q text default null)
 RETURNS TABLE(id uuid, name text, image_url text, titles_count bigint, total bigint, cover_title_id uuid, cover_pos real, total_minutes real, last_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with qn as (select nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '') as q),
  st as (
    -- index couvrant : aucune lecture de la table
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

create or replace function public.sync_onefichier_sweep(p_grace_min integer default 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cut timestamptz := now() - make_interval(mins => greatest(p_grace_min, 10)); v_folders int := 0; v_removed int := 0; v_legacy int := 0;
        v_pending boolean := exists (select 1 from public.watch_folders w where w.active and w.missing_since is null and w.folder_id <> 0
                                       and (w.force_full or w.full_at is null or w.parent_files is distinct from w.files_count or w.parent_size is distinct from w.size_bytes));
        v_left boolean := false;
begin
  -- dossiers disparus (absents de leur parent depuis le délai de grâce) : eux et tout ce qu'ils contenaient
  with recursive g as (
    select folder_id from public.watch_folders where active and folder_id <> 0 and missing_since is not null and missing_since < v_cut
    union
    select w.folder_id from public.watch_folders w join g on w.parent_id = g.folder_id where w.active
  ), off as (
    update public.watch_folders set active = false where folder_id in (select folder_id from g) returning folder_id
  ), mark as (
    update public.media_sources set missing_since = coalesce(missing_since, v_cut - interval '1 minute')
     where provider = 'onefichier' and removed_at is null and folder_id in (select folder_id from off) returning 1
  )
  select count(*) into v_folders from off;

  -- fichiers d'avant le suivi (dossier inconnu) jamais revus dans un relevé complet : disparus aussi, une fois tous les dossiers relevés
  if not exists (select 1 from public.watch_folders where active and (full_at is null or capped)) then
    update public.media_sources set missing_since = coalesce(missing_since, now())
     where provider = 'onefichier' and folder_id is null and removed_at is null and missing_since is null;
    get diagnostics v_legacy = row_count;
  end if;

  -- retrait par lots de 2 000 (un lot énorme dépassait le délai et TOUT était annulé) ; lignes verrouillées par un import : plus tard
  with cand as (
    select ms.id from public.media_sources ms
     where ms.provider = 'onefichier' and ms.removed_at is null and ms.missing_since is not null and ms.missing_since < v_cut
       -- fichier peut-être simplement déplacé vers un autre dossier pas encore relu : on attend ce relevé (6 h au plus)
       and (ms.missing_since < now() - interval '6 hours' or not v_pending)
     order by ms.missing_since
     limit 2000
     for update skip locked
  ), gone as (
    update public.media_sources m set removed_at = now(), is_active = false
      from cand where m.id = cand.id
    returning m.id, m.title_id
  ), hide as (
    update public.titles t set is_published = false
      from (select distinct title_id from gone where title_id is not null) g
     where t.id = g.title_id and t.is_published
       and not exists (select 1 from public.media_sources m2 where m2.title_id = t.id and m2.is_active
                         and not exists (select 1 from gone x where x.id = m2.id))
    returning 1
  )
  select count(*) into v_removed from gone;
  v_left := v_removed >= 2000;
  return jsonb_build_object('folders_gone', v_folders, 'files_removed', v_removed, 'legacy_flagged', v_legacy, 'more', v_left);
end $function$;
