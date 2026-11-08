-- Synchronisation automatique avec 1fichier : fichiers et dossiers supprimés, déplacés ou renommés se mettent à jour tout seuls.
--  • chaque fichier mémorise son dossier 1fichier, son nom d'origine et le titre qui en avait été tiré ;
--  • un fichier absent de son dossier est « manquant » ; s'il ne réapparaît nulle part (déplacement) au bout du délai de grâce,
--    il est retiré du site (source désactivée, vidéo dépubliée — jamais effacée : elle revient seule si le fichier revient) ;
--  • un dossier renommé renomme son modèle ; un dossier déplacé suit sous son nouveau parent ; un dossier supprimé retire ses fichiers.
alter table public.media_sources
  add column if not exists folder_id bigint,
  add column if not exists remote_name text,
  add column if not exists remote_title text,
  add column if not exists missing_since timestamptz,
  add column if not exists removed_at timestamptz;
create index if not exists media_sources_folder_idx on public.media_sources (folder_id) where folder_id is not null;
create index if not exists media_sources_missing_idx on public.media_sources (missing_since) where missing_since is not null and removed_at is null;

-- Dossiers surveillés : signature (nombre de fichiers, taille) pour ne relire que ce qui a changé
alter table public.watch_folders
  add column if not exists files_count int,            -- signature au dernier relevé complet
  add column if not exists size_bytes bigint,
  add column if not exists parent_files int,           -- signature annoncée par le dossier parent (ou le dossier lui-même pour la racine)
  add column if not exists parent_size bigint,
  add column if not exists full_at timestamptz,        -- dernier relevé complet (liste des fichiers)
  add column if not exists force_full boolean not null default false,
  add column if not exists has_children boolean not null default false,
  add column if not exists capped boolean not null default false,
  add column if not exists missing_since timestamptz;
create index if not exists watch_folders_due2_idx on public.watch_folders (next_scan_at) where active and missing_since is null;

-- Plus de dossiers par passage (l'API autorise 3 requêtes/s)
alter table public.watch_config drop constraint if exists watch_config_folders_per_tick_check;
alter table public.watch_config add constraint watch_config_folders_per_tick_check check (folders_per_tick between 1 and 120);
alter table public.watch_config alter column folders_per_tick set default 40;
update public.watch_config set folders_per_tick = 40 where id = 1;

-- ───────── Un lot de fichiers d'un dossier : nouveaux, renommés, déplacés, revenus
create or replace function public.sync_onefichier_folder(
  p_folder bigint, p_files jsonb, p_publish boolean, p_model_id uuid, p_poster text, p_reassign boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int := 0; v_renamed int := 0; v_moved int := 0; v_restored int := 0; v_known int := 0; v_total int := coalesce(jsonb_array_length(p_files), 0);
begin
  with src as (
    select distinct on (f->>'id') f->>'id' as fid, f->>'slug' as slug, f->>'title' as title, coalesce(f->>'name', f->>'title') as name,
           coalesce(f->>'quality', '1080p') as quality, nullif(f->>'size', '')::bigint as size, nullif(f->>'container', '') as container
    from jsonb_array_elements(p_files) f
  ), ex as (
    select ms.id as ms_id, ms.title_id, ms.folder_id as old_folder, ms.remote_name as old_name, ms.remote_title as old_title, ms.removed_at,
           ms.missing_since, ms.is_active, t.title as cur_title, t.model_id as cur_model, s.fid, s.title, s.name
    from src s
    join public.media_sources ms on ms.provider = 'onefichier' and ms.file_id = s.fid
    join public.titles t on t.id = ms.title_id
  ), flags as (
    select e.*,
           (e.old_name is not null and e.old_name <> e.name and e.old_title is not null and e.cur_title = e.old_title and e.title <> e.cur_title) as do_rename,
           ((p_reassign or (e.old_folder is not null and e.old_folder <> p_folder)) and p_model_id is not null and e.cur_model is distinct from p_model_id) as do_move
    from ex e
  ), fresh as (
    select s.* from src s
    where not exists (select 1 from public.media_sources m where m.provider = 'onefichier' and m.file_id = s.fid)
  ), ins_t as (
    insert into public.titles (type, slug, title, is_published, published_at, model_id, poster_url, size_bytes)
    select 'movie', slug, title, p_publish, case when p_publish then now() end, p_model_id, p_poster, size from fresh
    on conflict do nothing
    returning id, slug
  ), ins_s as (
    insert into public.media_sources (title_id, provider, file_id, quality, size_bytes, container, priority, is_active, folder_id, remote_name, remote_title)
    select t.id, 'onefichier', f.fid, f.quality::public.video_quality, f.size, left(f.container, 8), 10, true, p_folder, f.name, f.title
    from ins_t t join fresh f on f.slug = t.slug
    on conflict do nothing
    returning 1
  ), upd_t as (
    update public.titles t
       set title = case when f.do_rename then f.title else t.title end,
           model_id = case when f.do_move then p_model_id else t.model_id end,
           poster_url = case when f.do_move then (case when p_poster is not null then p_poster when t.poster_url like '%#model' then null else t.poster_url end) else t.poster_url end,
           is_published = case when f.removed_at is not null then true else t.is_published end
      from flags f
     where t.id = f.title_id and (f.do_rename or f.do_move or f.removed_at is not null)
    returning 1
  ), upd_s as (
    update public.media_sources ms
       set folder_id = p_folder, remote_name = f.name,
           remote_title = case when f.do_rename then f.title when f.old_title is null then (case when f.cur_title = f.title then f.title else f.cur_title end) else f.old_title end,
           missing_since = null, removed_at = null, is_active = (ms.is_active or f.removed_at is not null)
      from flags f
     where ms.id = f.ms_id
       and (ms.folder_id is distinct from p_folder or ms.remote_name is distinct from f.name or ms.remote_title is null
            or ms.missing_since is not null or ms.removed_at is not null)
    returning 1
  )
  select (select count(*) from ins_s), (select count(*) from flags where do_rename),
         (select count(*) from flags where do_move and old_folder is not null and old_folder <> p_folder),
         (select count(*) from flags where removed_at is not null), (select count(*) from ex)
    into v_new, v_renamed, v_moved, v_restored, v_known;
  return jsonb_build_object('total', v_total, 'imported', v_new, 'ignored', v_total - v_new, 'renamed', v_renamed, 'moved', v_moved, 'restored', v_restored, 'fixed', v_moved);
end $$;

-- ───────── Fichiers du dossier absents de la liste complète → « manquants » (jamais si la liste est douteuse)
create or replace function public.sync_onefichier_missing(p_folder bigint, p_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_known int; v_miss int;
begin
  select count(*) into v_known from public.media_sources where provider = 'onefichier' and folder_id = p_folder and removed_at is null;
  select count(*) into v_miss from public.media_sources ms
   where ms.provider = 'onefichier' and ms.folder_id = p_folder and ms.removed_at is null and not (ms.file_id = any (p_ids));
  -- plus de la moitié d'un gros dossier qui disparaît d'un coup : réponse partielle probable, on ne touche à rien
  if v_miss > 20 and v_miss * 2 > v_known then
    return jsonb_build_object('missing', 0, 'suspect', true, 'would_miss', v_miss);
  end if;
  update public.media_sources ms set missing_since = coalesce(ms.missing_since, now())
   where ms.provider = 'onefichier' and ms.folder_id = p_folder and ms.removed_at is null and not (ms.file_id = any (p_ids));
  return jsonb_build_object('missing', v_miss, 'suspect', false);
end $$;

-- ───────── Balayage : retire du site ce qui manque depuis plus de p_grace_min minutes
create or replace function public.sync_onefichier_sweep(p_grace_min int default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cut timestamptz := now() - make_interval(mins => greatest(p_grace_min, 10)); v_folders int := 0; v_removed int := 0; v_legacy int := 0;
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

  with gone as (
    update public.media_sources set removed_at = now(), is_active = false
     where provider = 'onefichier' and removed_at is null and missing_since is not null and missing_since < v_cut
    returning id, title_id
  ), hide as (
    update public.titles t set is_published = false
      from (select distinct title_id from gone) g
     where t.id = g.title_id
       and not exists (select 1 from public.media_sources m where m.title_id = t.id and m.is_active and m.id not in (select id from gone))
    returning 1
  )
  select count(*) into v_removed from gone;
  return jsonb_build_object('folders_gone', v_folders, 'files_removed', v_removed, 'legacy_flagged', v_legacy);
end $$;

-- ───────── Sous-dossiers d'un dossier relevé : nouveaux, renommés (→ le modèle suit), déplacés, disparus ; signatures à jour
create or replace function public.watch_apply_children(p_parent bigint, p_children jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_root boolean; v_model text; r record; v_fresh int := 0; v_flag int := 0; v_ren int := 0; v_gone int := 0;
begin
  select (w.folder_id = 0 or w.parent_id is null), w.model_name into v_root, v_model from public.watch_folders w where w.folder_id = p_parent;
  if not found then v_root := (p_parent = 0); end if;

  -- dossier de modèle renommé sur 1fichier : le modèle est renommé aussi (si le nouveau nom est libre)
  for r in
    select w.folder_id, w.name as old_name, w.model_name as old_model, c.name as new_name
      from jsonb_to_recordset(p_children) as c(id bigint, name text, files int, size bigint)
      join public.watch_folders w on w.folder_id = c.id and w.name is distinct from c.name
  loop
    if v_root and r.old_model is not null and r.old_model = r.old_name and not public.is_generic_folder(trim(r.new_name))
       and not exists (select 1 from public.models where name = left(trim(r.new_name), 80)) then
      update public.models set name = left(trim(r.new_name), 80) where name = left(trim(r.old_model), 80);
      update public.watch_folders set model_name = r.new_name where model_name = r.old_model;
      v_ren := v_ren + 1;
    end if;
  end loop;

  with c as (select * from jsonb_to_recordset(p_children) as c(id bigint, name text, files int, size bigint)),
  up as (
    insert into public.watch_folders (folder_id, parent_id, name, model_name, parent_files, parent_size)
    select c.id, p_parent, c.name,
           case when v_root then (case when public.is_generic_folder(trim(c.name)) then null else c.name end) else v_model end,
           c.files, c.size
      from c
    on conflict (folder_id) do update
       set parent_id = excluded.parent_id, name = excluded.name, model_name = excluded.model_name,
           parent_files = excluded.parent_files, parent_size = excluded.parent_size, missing_since = null, active = true
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into v_fresh from up;

  -- dossiers dont la signature a changé : relevé complet dès que possible
  update public.watch_folders w set force_full = true, next_scan_at = least(w.next_scan_at, now())
   where w.parent_id = p_parent and w.active and w.missing_since is null
     and (w.full_at is null or w.parent_files is distinct from w.files_count or w.parent_size is distinct from w.size_bytes);
  get diagnostics v_flag = row_count;

  -- dossiers qui ne figurent plus sous ce parent (supprimés, ou déplacés ailleurs : ils reviennent alors sous leur nouveau parent)
  update public.watch_folders w set missing_since = coalesce(w.missing_since, now())
   where w.parent_id = p_parent and w.missing_since is null
     and w.folder_id not in (select (x->>'id')::bigint from jsonb_array_elements(p_children) x);
  get diagnostics v_gone = row_count;

  return jsonb_build_object('fresh', v_fresh, 'changed', v_flag, 'renamed', v_ren, 'gone', v_gone);
end $$;

revoke all on function public.sync_onefichier_folder(bigint, jsonb, boolean, uuid, text, boolean), public.sync_onefichier_missing(bigint, text[]),
  public.sync_onefichier_sweep(int), public.watch_apply_children(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.sync_onefichier_folder(bigint, jsonb, boolean, uuid, text, boolean), public.sync_onefichier_missing(bigint, text[]),
  public.sync_onefichier_sweep(int), public.watch_apply_children(bigint, jsonb) to service_role;
