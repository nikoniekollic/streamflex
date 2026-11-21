-- Copies identiques : le site compte désormais chaque fichier de 1fichier (dreddxxx : 6 051 fichiers sur 1fichier, 6 028
-- sur le site — 23 copies au contenu identique à une vidéo déjà présente étaient ignorées).
-- Un nouveau fichier dont le contenu correspond à une vidéo ENCORE présente devient une vidéo à part (son nom, son dossier,
-- son modèle). Inchangé : un fichier qui remplace une vidéo disparue (déplacé, renvoyé) reprend toujours cette vidéo (2a).
do $mig$
declare
  def text := pg_get_functiondef('public.sync_onefichier_folder'::regproc);
  old_where text := E'      from _sf_src s join _sf_new n on n.fid = s.fid\n     where n.match_id is null\n';
  new_where text := E'      from _sf_src s join _sf_new n on n.fid = s.fid\n     where n.match_id is null or not n.match_gone -- identical_copies : copie d''une vidéo encore présente = vidéo à part\n';
begin
  if position('identical_copies' in def) > 0 then return; end if;
  if position(old_where in def) = 0 then raise exception 'sync_onefichier_folder : bloc 2b introuvable'; end if;
  execute replace(def, old_where, new_where);
end
$mig$;

-- dossiers de dreddxxx relus en entier au prochain passage de la surveillance (les copies y sont importées)
update public.watch_folders set force_full = true, next_scan_at = now() where folder_id in (23512044, 23530984);
