-- Fichiers disparus d'un dossier : la sécurité « plus de la moitié disparaît d'un coup = réponse partielle de 1fichier »
-- empêchait de voir un dossier vidé pour de bon (ex. la racine vidée : 0 fichier chez 1fichier, 3 870 encore sur le site).
-- p_trusted : le relevé est confirmé par 1fichier lui-même (le nombre de fichiers qu'il annonce pour le dossier = le nombre
-- reçu, dossier non tronqué) ; les disparitions sont alors prises en compte quelle que soit leur proportion.
drop function if exists public.sync_onefichier_missing(bigint, text[]);
create or replace function public.sync_onefichier_missing(p_folder bigint, p_ids text[], p_trusted boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_known int; v_miss int;
begin
  select count(*) into v_known from public.media_sources where provider = 'onefichier' and folder_id = p_folder and removed_at is null;
  select count(*) into v_miss from public.media_sources ms
   where ms.provider = 'onefichier' and ms.folder_id = p_folder and ms.removed_at is null and not (ms.file_id = any (p_ids));
  -- plus de la moitié d'un gros dossier qui disparaît d'un coup, sans confirmation de 1fichier : réponse partielle probable
  if not p_trusted and v_miss > 20 and v_miss * 2 > v_known then
    return jsonb_build_object('missing', 0, 'suspect', true, 'would_miss', v_miss);
  end if;
  update public.media_sources ms set missing_since = coalesce(ms.missing_since, now())
   where ms.provider = 'onefichier' and ms.folder_id = p_folder and ms.removed_at is null and not (ms.file_id = any (p_ids));
  return jsonb_build_object('missing', v_miss, 'suspect', false);
end $$;
revoke all on function public.sync_onefichier_missing(bigint, text[], boolean) from public, anon, authenticated;
grant execute on function public.sync_onefichier_missing(bigint, text[], boolean) to service_role;
