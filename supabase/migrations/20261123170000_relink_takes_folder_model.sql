-- Fichier ré-envoyé (même contenu qu'une vidéo dont le fichier a disparu) : la vidéo reprend le nouveau fichier, et maintenant
-- AUSSI le modèle du dossier où il se trouve et son nom (si le titre n'avait pas été modifié à la main). Avant, elle gardait
-- l'ancien modèle : les copies de la racine retirées (titres aléatoires, modèle « Racine ») seraient revenues telles quelles
-- au lieu d'aller chez dreddxxx & co. Correctif appliqué sur la définition en place (seule l'étape 2a change).
do $m$
declare d text; n text;
begin
  d := pg_get_functiondef('public.sync_onefichier_folder'::regproc);
  n := replace(d,
$a$           last_status = null
      from _sf_new n join _sf_src s on s.fid = n.fid
     where n.match_id is not null and n.match_gone and ms.id = n.match_id
    returning ms.title_id
  ), pub as (
    update public.titles t set is_published = true from rel where t.id = rel.title_id and not t.is_published and p_publish
    returning 1
  )$a$,
$b$           last_status = null, remote_title = s.title
      from _sf_new n join _sf_src s on s.fid = n.fid
     where n.match_id is not null and n.match_gone and ms.id = n.match_id
    returning ms.title_id, s.title as new_title, (select x.remote_title from public.media_sources x where x.id = ms.id) as old_rt
  ), pub as (
    -- 2a bis (relinked_model) : modèle et nom du dossier où se trouve le nouveau fichier
    update public.titles t
       set is_published = case when p_publish then true else t.is_published end,
           model_id = case when p_model_id is not null then p_model_id when p_detach then null else t.model_id end,
           poster_url = case when p_model_id is not null and t.model_id is distinct from p_model_id
                               then coalesce(p_poster, case when t.poster_url like '%#model' then null else t.poster_url end)
                             when p_model_id is null and p_detach and t.poster_url like '%#model' then null
                             else t.poster_url end,
           title = case when rel.old_rt is not null and t.title = rel.old_rt and rel.new_title is not null then rel.new_title else t.title end
      from rel where t.id = rel.title_id
    returning 1
  )$b$);
  if n = d or position('relinked_model' in n) = 0 then
    raise exception 'sync_onefichier_folder : étape 2a introuvable, correctif non appliqué';
  end if;
  execute n;
end $m$;
