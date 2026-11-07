-- Jaquette = image de la vidéo à un moment PRÉCIS et STABLE (au lieu d'un instant tiré au hasard à chaque affichage).
-- cover_pos : position dans la vidéo, de 0 à 0,95 (fraction de la durée). Le navigateur se place à ce moment ; aucune
-- lecture de pixels n'est nécessaire (l'hébergeur n'envoie pas d'en-têtes CORS : une capture en fichier est impossible).
alter table public.titles add column if not exists cover_pos real check (cover_pos is null or (cover_pos >= 0 and cover_pos <= 0.95));

-- Moment au hasard pour les films existants (≈ 25 s pour 33 000 lignes : fait ici, hors des délais de l'API).
-- Le déclencheur updated_at est suspendu : l'ordre « dernière modification » de l'admin ne doit pas être bouleversé.
alter table public.titles disable trigger titles_updated_at;
update public.titles set cover_pos = 0.12 + random() * 0.55 where type = 'movie' and cover_pos is null;
alter table public.titles enable trigger titles_updated_at;

-- Tout nouveau film importé reçoit un moment automatiquement
alter table public.titles alter column cover_pos set default (0.12 + random() * 0.55);

-- Admin : attribue un moment aux films qui n'en ont pas, par paquets (l'API coupe les requêtes longues : le client répète jusqu'à 0)
create or replace function public.admin_randomize_cover_pos(p_limit int default 2000)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.titles set cover_pos = 0.12 + random() * 0.55
   where id in (select id from public.titles where type = 'movie' and cover_pos is null limit greatest(least(p_limit, 5000), 1));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.admin_randomize_cover_pos(int) from public, anon;
grant execute on function public.admin_randomize_cover_pos(int) to authenticated;
