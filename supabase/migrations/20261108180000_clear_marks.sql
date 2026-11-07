-- Effacer les vidéos « déjà vues » ou les favoris d'un profil, pour tout le catalogue ou pour un seul modèle.
-- SECURITY INVOKER : les règles RLS existantes vérifient que le profil appartient bien à l'utilisateur.
create or replace function public.clear_my_marks(p_profile uuid, p_what text, p_model uuid default null)
returns int language plpgsql security invoker set search_path = public as $$
declare v_n int;
begin
  if p_what = 'watched' then
    delete from public.watch_progress w
     where w.profile_id = p_profile
       and (p_model is null or w.title_id in (select t.id from public.titles t where t.model_id = p_model));
  elsif p_what = 'favorites' then
    delete from public.user_favorites f
     where f.profile_id = p_profile
       and (p_model is null or f.title_id in (select t.id from public.titles t where t.model_id = p_model));
  else
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.clear_my_marks(uuid, text, uuid) from public, anon;
grant execute on function public.clear_my_marks(uuid, text, uuid) to authenticated;
