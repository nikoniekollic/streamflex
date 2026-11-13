-- Reclassement automatique des vidéos quand leur fichier change de modèle sur 1fichier
--  • fichier déplacé du dossier du modèle A vers celui du modèle B : la vidéo passe au modèle B (y compris les fichiers importés
--    avant le suivi des dossiers, dont le dossier d'origine était inconnu) ;
--  • fichier déplacé vers un dossier sans modèle (racine, dossier générique) : la vidéo n'est plus rattachée au modèle A ;
--  • dossier renommé avec le nom d'un modèle existant (ou déplacé sous un autre modèle) : toutes ses vidéos sont reclassées ;
--  • un fichier absent de son ancien dossier n'est plus retiré du site tant qu'un dossier modifié attend d'être relu
--    (il est probablement juste déplacé), 6 h au plus.

alter table public.watch_folders add column if not exists reassign_pending boolean not null default false;

drop function if exists public.sync_onefichier_folder(bigint, jsonb, boolean, uuid, text, boolean);

create or replace function public.sync_onefichier_folder(
  p_folder bigint, p_files jsonb, p_publish boolean, p_model_id uuid, p_poster text, p_reassign boolean default false, p_detach boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int := 0; v_renamed int := 0; v_moved int := 0; v_restored int := 0; v_relinked int := 0; v_dups int := 0;
        v_total int := coalesce(jsonb_array_length(p_files), 0);
begin
  create temp table if not exists _sf_src (fid text primary key, slug text, title text, name text, quality text, size bigint, container text,
                                           checksum text, ctype text, fdate timestamptz) on commit drop;
  truncate _sf_src;
  insert into _sf_src
  select distinct on (f->>'id') f->>'id', f->>'slug', f->>'title', coalesce(f->>'name', f->>'title'),
         coalesce(f->>'quality', '1080p'), nullif(f->>'size', '')::bigint, nullif(f->>'container', ''),
         nullif(btrim(coalesce(f->>'checksum', '')), ''), nullif(left(coalesce(f->>'ctype', ''), 80), ''),
         case when f->>'date' ~ '^\d{4}-\d{2}-\d{2}' then (f->>'date')::timestamptz end
    from jsonb_array_elements(p_files) f
   where f->>'id' ~ '^[A-Za-z0-9]{4,32}$';

  -- 1. Fichiers déjà connus (même identifiant) : renommés, déplacés, revenus ; métadonnées complétées
  with ex as (
    select ms.id as ms_id, ms.title_id, ms.folder_id as old_folder, ms.remote_name as old_name, ms.remote_title as old_title, ms.removed_at,
           t.title as cur_title, t.model_id as cur_model, t.file_date, s.*
      from _sf_src s
      join public.media_sources ms on ms.provider = 'onefichier' and ms.file_id = s.fid
      join public.titles t on t.id = ms.title_id
  ), flags as (
    select e.*,
           (e.old_name is not null and e.old_name <> e.name and e.old_title is not null and e.cur_title = e.old_title and e.title <> e.cur_title) as do_rename,
           (case when p_model_id is not null then (p_reassign or e.old_folder is null or e.old_folder <> p_folder)
                 when p_detach then (p_reassign or (e.old_folder is not null and e.old_folder <> p_folder))
                 else false end
            and e.cur_model is distinct from p_model_id) as do_move
      from ex e
  ), upd_t as (
    update public.titles t
       set title = case when f.do_rename then f.title else t.title end,
           model_id = case when f.do_move then p_model_id else t.model_id end,
           poster_url = case when f.do_move then (case when p_poster is not null then p_poster when t.poster_url like '%#model' then null else t.poster_url end) else t.poster_url end,
           is_published = case when f.removed_at is not null then true else t.is_published end,
           file_date = coalesce(t.file_date, f.fdate)
      from flags f
     where t.id = f.title_id and (f.do_rename or f.do_move or f.removed_at is not null or (t.file_date is null and f.fdate is not null))
    returning 1
  ), upd_s as (
    update public.media_sources ms
       set folder_id = p_folder, remote_name = f.name,
           remote_title = case when f.do_rename then f.title when f.old_title is null then (case when f.cur_title = f.title then f.title else f.cur_title end) else f.old_title end,
           missing_since = null, removed_at = null, is_active = (ms.is_active or f.removed_at is not null),
           remote_checksum = coalesce(f.checksum, ms.remote_checksum), content_type = coalesce(f.ctype, ms.content_type), remote_date = coalesce(f.fdate, ms.remote_date),
           size_bytes = coalesce(ms.size_bytes, f.size)
      from flags f
     where ms.id = f.ms_id
       and (ms.folder_id is distinct from p_folder or ms.remote_name is distinct from f.name or ms.remote_title is null
            or ms.missing_since is not null or ms.removed_at is not null
            or (ms.remote_checksum is null and f.checksum is not null) or (ms.remote_date is null and f.fdate is not null) or (ms.content_type is null and f.ctype is not null))
    returning 1
  )
  select (select count(*) from flags where do_rename),
         (select count(*) from flags where do_move),
         (select count(*) from flags where removed_at is not null)
    into v_renamed, v_moved, v_restored;

  -- 2. Nouveaux identifiants : même contenu déjà connu ? (empreinte, sinon taille + nom exacts)
  create temp table if not exists _sf_new (fid text primary key, match_id uuid, match_gone boolean) on commit drop;
  truncate _sf_new;
  insert into _sf_new
  select s.fid, m.id, (m.missing_since is not null or m.removed_at is not null or not coalesce(m.is_active, true))
    from _sf_src s
    left join lateral (
      select ms.id, ms.missing_since, ms.removed_at, ms.is_active
        from public.media_sources ms
       where ms.provider = 'onefichier' and ms.file_id <> s.fid
         and ((s.checksum is not null and ms.remote_checksum = s.checksum)
              or (s.size is not null and s.size > 1048576 and ms.size_bytes = s.size and ms.remote_name = s.name))
       order by (ms.missing_since is not null or ms.removed_at is not null) desc, ms.created_at desc
       limit 1
    ) m on true
   where not exists (select 1 from public.media_sources x where x.provider = 'onefichier' and x.file_id = s.fid);

  -- 2a. ré-envoi d'un fichier disparu : la vidéo existante reprend le nouveau fichier (durée, image, vues conservées)
  with rel as (
    update public.media_sources ms
       set file_id = s.fid, folder_id = p_folder, remote_name = s.name, missing_since = null, removed_at = null, is_active = true,
           remote_checksum = coalesce(s.checksum, ms.remote_checksum), content_type = coalesce(s.ctype, ms.content_type), remote_date = coalesce(s.fdate, ms.remote_date),
           last_status = null
      from _sf_new n join _sf_src s on s.fid = n.fid
     where n.match_id is not null and n.match_gone and ms.id = n.match_id
    returning ms.title_id
  ), pub as (
    update public.titles t set is_published = true from rel where t.id = rel.title_id and not t.is_published and p_publish
    returning 1
  )
  select count(*) into v_relinked from rel;
  select count(*) into v_dups from _sf_new where match_id is not null and not match_gone;

  -- 2b. vrais nouveaux fichiers : adresse unique garantie (suffixe en cas de collision)
  with fresh as (
    select s.*, case
             when exists (select 1 from public.titles t where t.slug = s.slug) or count(*) over (partition by s.slug) > 1
             then left(s.slug, 70) || '-' || left(md5(s.fid), 8) else s.slug end as slug2
      from _sf_src s join _sf_new n on n.fid = s.fid
     where n.match_id is null
  ), ins_t as (
    insert into public.titles (type, slug, title, is_published, published_at, model_id, poster_url, size_bytes, file_date)
    select 'movie', slug2, title, p_publish, case when p_publish then now() end, p_model_id, p_poster, size, fdate from fresh
    on conflict do nothing
    returning id, slug
  ), ins_s as (
    insert into public.media_sources (title_id, provider, file_id, quality, size_bytes, container, priority, is_active, folder_id, remote_name, remote_title, remote_checksum, content_type, remote_date)
    select t.id, 'onefichier', f.fid, f.quality::public.video_quality, f.size, left(f.container, 8), 10, true, p_folder, f.name, f.title, f.checksum, f.ctype, f.fdate
      from ins_t t join fresh f on f.slug2 = t.slug
    on conflict do nothing
    returning 1
  )
  select count(*) into v_new from ins_s;

  return jsonb_build_object('total', v_total, 'imported', v_new + v_relinked, 'ignored', v_total - v_new - v_relinked, 'renamed', v_renamed,
                            'moved', v_moved, 'restored', v_restored + v_relinked, 'fixed', v_moved, 'relinked', v_relinked, 'duplicates', v_dups);
end $$;

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
           parent_files = excluded.parent_files, parent_size = excluded.parent_size, missing_since = null, active = true,
           -- le dossier change de modèle (renommé avec le nom d'un modèle existant, déplacé sous un autre modèle…) :
           -- ses vidéos sont reclassées au prochain relevé complet, lancé tout de suite
           reassign_pending = watch_folders.reassign_pending or watch_folders.model_name is distinct from excluded.model_name,
           force_full = watch_folders.force_full or watch_folders.model_name is distinct from excluded.model_name,
           next_scan_at = case when watch_folders.model_name is distinct from excluded.model_name then least(watch_folders.next_scan_at, now()) else watch_folders.next_scan_at end
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

create or replace function public.sync_onefichier_sweep(p_grace_min int default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cut timestamptz := now() - make_interval(mins => greatest(p_grace_min, 10)); v_folders int := 0; v_removed int := 0; v_legacy int := 0;
        v_pending boolean := exists (select 1 from public.watch_folders w where w.active and w.missing_since is null and w.folder_id <> 0
                                       and (w.force_full or w.full_at is null or w.parent_files is distinct from w.files_count or w.parent_size is distinct from w.size_bytes));
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
       -- fichier peut-être simplement déplacé vers un autre dossier pas encore relu : on attend ce relevé (6 h au plus)
       and (missing_since < now() - interval '6 hours' or not v_pending)
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

revoke all on function public.sync_onefichier_folder(bigint, jsonb, boolean, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.sync_onefichier_folder(bigint, jsonb, boolean, uuid, text, boolean, boolean) to service_role;
