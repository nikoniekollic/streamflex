-- Liste des modèles (admin) : 9 s → ~0,5 s. L'ancienne version triait les 95 000 titres pour trouver la dernière vidéo de
-- chaque modèle et dépassait la limite de 8 s : la liste revenait vide (listes déroulantes « Modèle » / « Déplacer »).
-- Comptage en un seul passage sur l'index, dernière vidéo publiée lue par l'index (une ligne par modèle).
create or replace function public.admin_list_models()
returns table(id uuid, name text, image_url text, titles_count bigint, cover_title_id uuid, cover_pos real)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with cnt as (
      select t.model_id, count(*) as n from public.titles t where t.model_id is not null group by t.model_id
    )
    select m.id, m.name, m.image_url, coalesce(cnt.n, 0)::bigint,
           coalesce(c.id, l.id),
           coalesce(m.cover_pos, (select x.cover_pos from public.titles x where x.id = coalesce(c.id, l.id)))
    from public.models m
    left join cnt on cnt.model_id = m.id
    left join lateral (select t2.id from public.titles t2 where t2.id = m.cover_title_id and t2.model_id = m.id) c on true
    left join lateral (
      select t.id from public.titles t
      where t.model_id = m.id and t.is_published
      order by t.published_at desc nulls last, t.id limit 1
    ) l on true
    order by lower(m.name);
end $$;
