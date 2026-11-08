-- La recapture d'une image de modèle ne doit jamais toucher aux aperçus des vidéos (titles.cover_pos) :
-- le modèle a désormais SON propre moment d'image (models.cover_pos). Tant qu'il est vide, l'image reprend celui de la vidéo.
alter table public.models add column if not exists cover_pos real check (cover_pos is null or (cover_pos >= 0 and cover_pos <= 0.95));

drop function if exists public.admin_list_models();
create or replace function public.admin_list_models()
returns table (id uuid, name text, image_url text, titles_count bigint, cover_title_id uuid, cover_pos real)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with base as (
      select m.id, m.name, m.image_url, m.cover_pos as mpos, count(t.id) as n,
             (select t2.id from public.titles t2 where t2.id = m.cover_title_id and t2.model_id = m.id) as chosen,
             (array_agg(t.id order by t.published_at desc nulls last, t.id) filter (where t.is_published))[1] as latest
      from public.models m left join public.titles t on t.model_id = m.id
      group by m.id
    )
    select b.id, b.name, b.image_url, b.n, coalesce(b.chosen, b.latest),
           coalesce(b.mpos, (select x.cover_pos from public.titles x where x.id = coalesce(b.chosen, b.latest)))
    from base b order by lower(b.name);
end $$;
revoke all on function public.admin_list_models() from public, anon;
grant execute on function public.admin_list_models() to authenticated;

drop function if exists public.catalog_models(int, int);
create or replace function public.catalog_models(p_limit int default 48, p_offset int default 0)
returns table (id uuid, name text, image_url text, titles_count bigint, total bigint, cover_title_id uuid, cover_pos real)
language sql stable security definer set search_path = public as $$
  with m as (
    select md.id, md.name, md.image_url, md.cover_pos as mpos, count(t.id) as n,
           coalesce(
             (select t2.id from public.titles t2 where t2.id = md.cover_title_id and t2.model_id = md.id and t2.is_published),
             (array_agg(t.id order by t.published_at desc nulls last, t.id))[1]
           ) as cover_title_id
    from public.models md
    join public.titles t on t.model_id = md.id and t.is_published
    group by md.id
  ), page as (
    select m.*, count(*) over () as total from m
    order by m.n desc, m.name
    limit greatest(least(p_limit, 200), 1) offset greatest(p_offset, 0)
  )
  select p.id, p.name, p.image_url, p.n, p.total, p.cover_title_id,
         coalesce(p.mpos, (select t.cover_pos from public.titles t where t.id = p.cover_title_id))
  from page p
$$;
revoke all on function public.catalog_models(int, int) from public, anon;
grant execute on function public.catalog_models(int, int) to authenticated;

-- Recapture d'image de modèle : une autre vidéo que l'actuelle (jamais deux fois la même d'affilée) et un autre moment,
-- enregistrés sur le MODÈLE seulement. Les vidéos et leurs aperçus ne sont pas modifiés.
-- Un modèle qui n'a qu'une vidéo garde cette vidéo, avec un autre moment (écart d'au moins 10 % de la durée).
create or replace function public.admin_recapture_models(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with cur as (
    select m.id as model_id,
           coalesce(
             (select t.id from public.titles t where t.id = m.cover_title_id and t.model_id = m.id and t.is_published),
             (select t.id from public.titles t where t.model_id = m.id and t.is_published order by t.published_at desc nulls last, t.id limit 1)
           ) as cur_id,
           m.cover_pos as mpos
    from public.models m where p_ids is null or m.id = any (p_ids)
  ), pick as (
    select c.model_id,
           coalesce(
             (select t.id from public.titles t where t.model_id = c.model_id and t.is_published and t.id is distinct from c.cur_id order by random() limit 1),
             c.cur_id
           ) as title_id,
           coalesce(c.mpos, (select x.cover_pos from public.titles x where x.id = c.cur_id)) as old_pos,
           random() as r
    from cur c
  ), upd as (
    update public.models m
       set cover_title_id = p.title_id,
           cover_pos = case
             when p.old_pos is null or abs((0.12 + p.r * 0.55) - p.old_pos) >= 0.1 then 0.12 + p.r * 0.55
             else 0.12 + mod((p.r * 0.55 + 0.25)::numeric, 0.55::numeric)
           end
      from pick p
     where m.id = p.model_id and p.title_id is not null returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end $$;
revoke all on function public.admin_recapture_models(uuid[]) from public, anon;
grant execute on function public.admin_recapture_models(uuid[]) to authenticated;
