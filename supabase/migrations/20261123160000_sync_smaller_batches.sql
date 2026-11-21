-- Lots plus petits : un dossier vidé d'un coup (3 870 fichiers) dépassait encore la limite de 8 s quand la base était occupée
-- pendant la passe de surveillance. Marquage par 250, retrait par 500 ; la fonction 1fichier enchaîne les appels (`more`).
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
     limit 250
  )
  update public.media_sources ms set missing_since = now() from todo where ms.id = todo.id;
  get diagnostics v_done = row_count;
  return jsonb_build_object('missing', v_miss, 'suspect', false, 'marked', v_done, 'more', v_done = 250);
end $$;


create or replace function public.sync_onefichier_sweep(p_grace_min integer default 20)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_cut timestamptz := now() - make_interval(mins => greatest(p_grace_min, 5)); v_folders int := 0; v_removed int := 0; v_legacy int := 0;
        v_pending boolean := exists (select 1 from public.watch_folders w where w.active and w.missing_since is null and w.folder_id <> 0
                                       and (w.force_full or w.full_at is null or w.parent_files is distinct from w.files_count or w.parent_size is distinct from w.size_bytes));
        v_left boolean := false;
begin
  -- dossiers disparus (absents de leur parent depuis le délai de grâce) : eux et tout ce qu'ils contenaient
  with recursive g as (
    select folder_id from public.watch_folders where active and folder_id <> 0 and missing_since is not null and missing_since < v_cut
    union
    select w.folder_id from public.watch_folders w join g on w.parent_id = g.folder_id where w.active
  ), off as (
    update public.watch_folders set active = false where folder_id in (select folder_id from g) returning folder_id
  ), mark as (
    update public.media_sources set missing_since = coalesce(missing_since, v_cut - interval '1 minute')
     where provider = 'onefichier' and removed_at is null and folder_id in (select folder_id from off) returning 1
  )
  select count(*) into v_folders from off;

  -- fichiers d'avant le suivi (dossier inconnu) jamais revus dans un relevé complet : disparus aussi, une fois tous les dossiers relevés
  if not exists (select 1 from public.watch_folders where active and (full_at is null or capped)) then
    update public.media_sources set missing_since = coalesce(missing_since, now())
     where provider = 'onefichier' and folder_id is null and removed_at is null and missing_since is null;
    get diagnostics v_legacy = row_count;
  end if;

  -- retrait par lots de 500 (limite de 8 s) ; lignes verrouillées par un import : plus tard
  with cand as (
    select ms.id from public.media_sources ms
     where ms.provider = 'onefichier' and ms.removed_at is null and ms.missing_since is not null
       and (
         ms.suspect_at > now() - interval '1 day'
         or (ms.missing_since < v_cut and (ms.missing_since < now() - interval '45 minutes' or not v_pending))
       )
     order by ms.missing_since
     limit 500
     for update skip locked
  ), gone as (
    update public.media_sources m set removed_at = now(), is_active = false
      from cand where m.id = cand.id
    returning m.id, m.title_id
  ), hide as (
    update public.titles t set is_published = false
      from (select distinct title_id from gone where title_id is not null) g
     where t.id = g.title_id and t.is_published
       and not exists (select 1 from public.media_sources m2 where m2.title_id = t.id and m2.is_active
                         and not exists (select 1 from gone x where x.id = m2.id))
    returning 1
  )
  select count(*) into v_removed from gone;
  v_left := v_removed >= 500;
  return jsonb_build_object('folders_gone', v_folders, 'files_removed', v_removed, 'legacy_flagged', v_legacy, 'more', v_left);
end $function$;
