-- Marquage des fichiers disparus par lots de 1 000 : un dossier vidé d'un coup (racine : 3 870 fichiers) dépassait la limite
-- de 8 s du serveur (mise à jour en une fois ≈ 20 s) et l'appel échouait. La fonction 1fichier rappelle tant que `more` = vrai.
create or replace function public.sync_onefichier_missing(p_folder bigint, p_ids text[], p_trusted boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_known int; v_miss int; v_done int;
begin
  select count(*) into v_known from public.media_sources where provider = 'onefichier' and folder_id = p_folder and removed_at is null;
  select count(*) into v_miss from public.media_sources ms
   where ms.provider = 'onefichier' and ms.folder_id = p_folder and ms.removed_at is null and not (ms.file_id = any (p_ids));
  -- plus de la moitié d'un gros dossier qui disparaît d'un coup, sans confirmation de 1fichier : réponse partielle probable
  if not p_trusted and v_miss > 20 and v_miss * 2 > v_known then
    return jsonb_build_object('missing', 0, 'suspect', true, 'would_miss', v_miss);
  end if;
  with todo as (
    select ms.id from public.media_sources ms
     where ms.provider = 'onefichier' and ms.folder_id = p_folder and ms.removed_at is null and ms.missing_since is null
       and not (ms.file_id = any (p_ids))
     limit 1000
  )
  update public.media_sources ms set missing_since = now() from todo where ms.id = todo.id;
  get diagnostics v_done = row_count;
  return jsonb_build_object('missing', v_miss, 'suspect', false, 'marked', v_done, 'more', v_done = 1000);
end $$;
