-- Tri des vidéos fiable sur toutes les pages :
--  1. durée estimée (fichiers dont la durée n'est pas encore lue) calibrée sur les vraies durées connues : débit médian du
--     modèle (octets / seconde), sinon débit médian global. L'ancienne estimation (taille / 31 Mo par minute) gonflait les
--     durées d'environ 1,5× : les vidéos sans durée connue passaient devant des vidéos réellement plus longues.
--  2. recherche par mot-clé : le tri choisi (plus long, plus récent, A→Z…) est fait par la base sur TOUS les résultats,
--     plus seulement sur la page affichée.

-- ───────── 1. Débit par modèle
create table if not exists public.model_bitrates (
  model_id uuid primary key references public.models(id) on delete cascade,
  bps double precision not null,
  samples int not null
);
alter table public.model_bitrates enable row level security; -- lu seulement par les fonctions ci-dessous

create or replace function public.global_bitrate()
returns double precision language sql stable security definer set search_path = public as $$
  select coalesce(
    (select percentile_cont(0.5) within group (order by size_bytes::double precision / duration_s)
       from public.titles where duration_s > 30 and size_bytes > 0),
    772000)
$$;

create or replace function public.titles_set_len_key()
returns trigger language plpgsql security definer set search_path = public as $$
declare b double precision;
begin
  if new.duration_s is not null then
    new.len_key := new.duration_s / 60.0;
  elsif new.runtime_minutes is not null then
    new.len_key := new.runtime_minutes::real;
  elsif new.size_bytes is not null and new.size_bytes > 0 then
    select bps into b from public.model_bitrates where model_id = new.model_id;
    new.len_key := new.size_bytes / (coalesce(b, 772000) * 60.0);
  else
    new.len_key := null;
  end if;
  return new;
end $$;

-- Recalcule les débits (≥ 3 vidéos de durée connue par modèle) puis les durées estimées. Sans effet sur « Modifié le ».
create or replace function public.refresh_len_estimates()
returns int language plpgsql security definer set search_path = public as $$
declare g double precision := public.global_bitrate(); n int;
begin
  delete from public.model_bitrates;
  insert into public.model_bitrates (model_id, bps, samples)
  select model_id, percentile_cont(0.5) within group (order by size_bytes::double precision / duration_s), count(*)
    from public.titles
   where model_id is not null and duration_s > 30 and size_bytes > 0
   group by model_id
  having count(*) >= 3;

  perform set_config('sf.keep_updated', '1', true);
  update public.titles t
     set len_key = t.size_bytes / (coalesce(mb.bps, g) * 60.0)
    from public.titles t2
    left join public.model_bitrates mb on mb.model_id = t2.model_id
   where t2.id = t.id and t.duration_s is null and t.runtime_minutes is null and t.size_bytes > 0
     and t.len_key is distinct from t.size_bytes / (coalesce(mb.bps, g) * 60.0);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.refresh_len_estimates() from public, anon, authenticated;

-- Les modèles sans débit connu prennent le débit global (le déclencheur n'a pas la valeur globale : on la pose ici)
select public.refresh_len_estimates();

-- Recalcul chaque nuit (les durées lues au fil de l'eau affinent les débits)
select cron.unschedule(jobid) from cron.job where jobname = 'refresh-len-estimates';
select cron.schedule('refresh-len-estimates', '17 4 * * *', $$select public.refresh_len_estimates()$$);

-- ───────── 2. Recherche avec tri
drop function if exists public.search_titles(text, public.title_type, text, integer, integer, boolean);

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
  base as (
    select t.*, p.q,
      case when p.q is null then null else websearch_to_tsquery('simple', p.q) end as tsq,
      lower(public.f_unaccent(t.title)) as t_norm
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
      )::real end as rank
    from base b
    where b.q is null or b.search @@ b.tsq or b.t_norm like '%' || b.q || '%'
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
grant execute on function public.search_titles(text, public.title_type, text, integer, integer, boolean, text) to anon, authenticated;
