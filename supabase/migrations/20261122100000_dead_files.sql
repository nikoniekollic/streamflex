-- Fichiers effacés chez 1fichier mais toujours affichés sur le site (lecteur noir)
-- Avant : un fichier supprimé n'était retiré qu'après
--   • le relevé complet de son dossier (jusqu'à 6 h pour un dossier sans sous-dossier),
--   • 90 min de délai de grâce,
--   • puis jusqu'à 6 h d'attente tant qu'UN dossier quelconque restait à relire (presque toujours le cas sur 512 dossiers),
-- et JAMAIS dans un dossier de plus de 5 000 fichiers (la racine : liste tronquée par 1fichier, aucune absence détectable).
-- Maintenant :
--   1. le navigateur qui tombe sur un fichier mort (Alldebrid : lien supprimé) le signale (report_dead_titles) ; son dossier est
--      relu en entier au passage suivant de la surveillance (≤ 5 min), ou, pour un gros dossier, le fichier est vérifié un par un
--      auprès de l'API 1fichier ;
--   2. absent du relevé ET signalé mort = deux preuves indépendantes : retiré tout de suite, sans délai de grâce (un fichier
--      simplement déplacé chez 1fichier garde son lien et se lit toujours : il n'est jamais signalé mort) ;
--   3. sinon délai de grâce de 20 min, et 45 min au plus d'attente des dossiers restant à relire (avant : 6 h).
-- Le retrait ne fait que dépublier : si le fichier réapparaît, le relevé suivant le republie.

alter table public.media_sources add column if not exists suspect_at timestamptz;
create index if not exists media_sources_suspect_idx on public.media_sources (suspect_at)
  where suspect_at is not null and removed_at is null and provider = 'onefichier';

-- Signalement par le navigateur d'un abonné : 30 titres au plus par appel, une fois par fichier toutes les 6 h.
-- Rien n'est retiré sur sa seule parole : la surveillance vérifie auprès de 1fichier avant de retirer.
create or replace function public.report_dead_titles(p_titles uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or p_titles is null or cardinality(p_titles) = 0 then return 0; end if;
  with t as (select distinct x from unnest(p_titles[1:30]) x),
  s as (
    update public.media_sources ms set suspect_at = now()
     where ms.title_id in (select x from t) and ms.provider = 'onefichier' and ms.removed_at is null
       and (ms.suspect_at is null or ms.suspect_at < now() - interval '6 hours')
    returning ms.folder_id
  ), f as (
    -- dossier ordinaire : relu en entier en priorité au prochain passage (un gros dossier tronqué est vérifié fichier par fichier)
    update public.watch_folders w set force_full = true, next_scan_at = least(w.next_scan_at, now())
     where w.folder_id in (select distinct folder_id from s where folder_id is not null)
       and w.active and w.missing_since is null and not coalesce(w.capped, false)
    returning 1
  )
  select count(*) into n from s;
  return n;
end $$;
revoke all on function public.report_dead_titles(uuid[]) from public, anon;
grant execute on function public.report_dead_titles(uuid[]) to authenticated;

create or replace function public.sync_onefichier_sweep(p_grace_min integer default 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- retrait par lots de 2 000 ; lignes verrouillées par un import : plus tard
  with cand as (
    select ms.id from public.media_sources ms
     where ms.provider = 'onefichier' and ms.removed_at is null and ms.missing_since is not null
       and (
         -- absent ET signalé mort par un lecteur (lien supprimé) : tout de suite
         ms.suspect_at > now() - interval '1 day'
         -- sinon après le délai de grâce ; un fichier peut-être simplement déplacé vers un dossier pas encore relu : 45 min au plus
         or (ms.missing_since < v_cut and (ms.missing_since < now() - interval '45 minutes' or not v_pending))
       )
     order by ms.missing_since
     limit 2000
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
  v_left := v_removed >= 2000;
  return jsonb_build_object('folders_gone', v_folders, 'files_removed', v_removed, 'legacy_flagged', v_legacy, 'more', v_left);
end $function$;
revoke all on function public.sync_onefichier_sweep(integer) from public, anon, authenticated;
grant execute on function public.sync_onefichier_sweep(integer) to service_role;
