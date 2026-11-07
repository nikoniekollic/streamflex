-- Jaquette de modèle : en plus de la photo, on renvoie un film du modèle (le plus récent) et son moment enregistré,
-- pour afficher l'image CAPTURÉE de sa vidéo (distingue les modèles entre eux, même sans photo).
drop function if exists public.catalog_models(int, int);
create or replace function public.catalog_models(p_limit int default 48, p_offset int default 0)
returns table (id uuid, name text, image_url text, titles_count bigint, total bigint, cover_title_id uuid, cover_pos real)
language sql stable security definer set search_path = public as $$
  with m as (
    select md.id, md.name, md.image_url, count(t.id) as n,
           (array_agg(t.id order by t.published_at desc nulls last, t.id))[1] as cover_title_id
    from public.models md
    join public.titles t on t.model_id = md.id and t.is_published
    group by md.id
  ), page as (
    select m.*, count(*) over () as total from m
    order by m.n desc, m.name
    limit greatest(least(p_limit, 200), 1) offset greatest(p_offset, 0)
  )
  select p.id, p.name, p.image_url, p.n, p.total, p.cover_title_id, (select t.cover_pos from public.titles t where t.id = p.cover_title_id)
  from page p
$$;
revoke all on function public.catalog_models(int, int) from public, anon;
grant execute on function public.catalog_models(int, int) to authenticated;
