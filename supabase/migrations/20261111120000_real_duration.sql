-- Durée réelle (en secondes) du fichier vidéo, remontée par le navigateur dès qu'il lit les métadonnées de la vidéo.
-- Remplace l'estimation d'après la taille du fichier (affichée « ≈ ») : seule la durée réelle est montrée.
alter table public.titles add column if not exists duration_s integer check (duration_s is null or duration_s between 1 and 86400);

-- Tri par durée : durée réelle d'abord, puis minutes enregistrées, puis estimation par la taille (tri seulement)
create or replace function public.titles_set_len_key() returns trigger language plpgsql as $$
begin
  new.len_key := coalesce(new.duration_s / 60.0, new.runtime_minutes::real, new.size_bytes / 31000000.0);
  return new;
end $$;
drop trigger if exists titles_len_key_biu on public.titles;
create trigger titles_len_key_biu before insert or update of runtime_minutes, size_bytes, duration_s on public.titles
  for each row execute function public.titles_set_len_key();

-- Une seule fois par titre ; valeurs plausibles seulement
create or replace function public.report_title_duration(p_title uuid, p_seconds numeric)
returns void language sql security definer set search_path = public as $$
  update public.titles
     set duration_s = round(p_seconds)::int,
         runtime_minutes = coalesce(runtime_minutes, least(round(p_seconds / 60.0), 1440)::smallint)
   where id = p_title and duration_s is null and p_seconds between 5 and 86400
$$;
revoke all on function public.report_title_duration(uuid, numeric) from public, anon;
grant execute on function public.report_title_duration(uuid, numeric) to authenticated;

-- Recapture : jamais la même vidéo deux fois d'affilée (celle qui illustre déjà le modèle est écartée) ;
-- si le modèle n'a qu'une vidéo, c'est le moment de l'image qui change (d'au moins 10 % de la durée).
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
           ) as cur_id
    from public.models m where p_ids is null or m.id = any (p_ids)
  ), pick as (
    select c.model_id,
           coalesce(
             (select t.id from public.titles t where t.model_id = c.model_id and t.is_published and t.id is distinct from c.cur_id order by random() limit 1),
             c.cur_id
           ) as title_id,
           random() as r
    from cur c
  ), upd as (
    update public.models m set cover_title_id = p.title_id from pick p
     where m.id = p.model_id and p.title_id is not null returning p.title_id, p.r
  ), pos as (
    update public.titles t
       set cover_pos = case
             when t.cover_pos is null or abs((0.12 + u.r * 0.55) - t.cover_pos) >= 0.1 then 0.12 + u.r * 0.55
             else 0.12 + mod((u.r * 0.55 + 0.25)::numeric, 0.55::numeric)
           end
      from upd u where t.id = u.title_id returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end $$;
revoke all on function public.admin_recapture_models(uuid[]) from public, anon;
grant execute on function public.admin_recapture_models(uuid[]) to authenticated;
