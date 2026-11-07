-- Page « Modèles », réglages d'apparence du site, règle « le dossier du modèle donne le nom » (sous-dossiers ignorés).

-- ───────── Réglages du site (une seule ligne) : thème, aperçus, nom des modèles
create table public.site_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict do nothing;
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to authenticated;
create policy site_settings_read on public.site_settings for select to authenticated using (true);

create or replace function public.admin_save_site_settings(p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  update public.site_settings set data = p_data, updated_at = now() where id = 1;
end $$;
revoke all on function public.admin_save_site_settings(jsonb) from public, anon;
grant execute on function public.admin_save_site_settings(jsonb) to authenticated;

-- ───────── Page publique des modèles : titres publiés par modèle
create or replace function public.catalog_models(p_limit int default 48, p_offset int default 0)
returns table (id uuid, name text, image_url text, titles_count bigint, total bigint)
language sql stable security definer set search_path = public as $$
  with m as (
    select md.id, md.name, md.image_url, count(t.id) as n
    from public.models md
    join public.titles t on t.model_id = md.id and t.is_published
    group by md.id
  )
  select m.id, m.name, m.image_url, m.n, count(*) over () from m
  order by m.n desc, m.name
  limit greatest(least(p_limit, 200), 1) offset greatest(p_offset, 0)
$$;
revoke all on function public.catalog_models(int, int) from public, anon;
grant execute on function public.catalog_models(int, int) to authenticated;

-- ───────── Outils de ménage des modèles
create or replace function public.admin_merge_models(p_from uuid, p_into uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_img text; v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from = p_into then raise exception 'same_model' using errcode = '22023'; end if;
  select image_url into v_img from public.models where id = p_into;
  if not found then raise exception 'unknown_model' using errcode = '22023'; end if;
  update public.titles set model_id = p_into,
    poster_url = case when v_img is not null then v_img || '#model'
                      when poster_url like '%#model' then null else poster_url end
   where model_id = p_from;
  get diagnostics v_n = row_count;
  delete from public.models where id = p_from;
  return v_n;
end $$;

create or replace function public.admin_delete_empty_models()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.models m where not exists (select 1 from public.titles t where t.model_id = m.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.admin_merge_models(uuid, uuid), public.admin_delete_empty_models() from public, anon;
grant execute on function public.admin_merge_models(uuid, uuid), public.admin_delete_empty_models() to authenticated;

-- ───────── Import : mode de nommage + correction des fichiers déjà importés
alter table public.import_jobs add column model_mode text not null default 'children' check (model_mode in ('children', 'inherit'));
alter table public.import_jobs add column reassign boolean not null default false;
alter table public.watch_folders add column model_name text;

-- Dossiers « génériques » (video, photos…) : jamais un modèle
create or replace function public.is_generic_folder(p_name text) returns boolean language sql immutable as $$
  select lower(btrim(p_name)) ~ '^(videos?|vid[eé]os?|vids?|clips?|movies?|films?|photos?|pics?|images?|media|medias|m[eé]dias?|new|news|nouveau|nouveaux|nouveaut[eé]s?|hd|fhd|uhd|4k|1080p?|720p?|480p?|full ?hd|originaux?|originals?|sources?|exclusive?s?|bonus|divers|autres?|misc|other|archives?|old|part ?[0-9]+|[0-9]{4})$'
$$;

-- Dossiers surveillés : le modèle est le dossier situé juste sous la racine ; tout ce qui est dessous en hérite
with recursive tree as (
  select folder_id, parent_id, name, 0 as depth, null::text as model
    from public.watch_folders where parent_id is null or folder_id = 0
  union all
  select c.folder_id, c.parent_id, c.name, t.depth + 1,
         case when t.depth = 0 and not public.is_generic_folder(c.name) then c.name else t.model end
    from public.watch_folders c join tree t on c.parent_id = t.folder_id and c.folder_id <> t.folder_id
   where t.depth < 30
)
update public.watch_folders w set model_name = tree.model from tree where tree.folder_id = w.folder_id and tree.model is not null;

-- Import par lots : « p_reassign » rattache aussi les titres déjà connus au bon modèle
drop function if exists public.import_onefichier_batch(jsonb, boolean, uuid, text);
create or replace function public.import_onefichier_batch(p_files jsonb, p_publish boolean, p_model_id uuid, p_poster text, p_reassign boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int := coalesce(jsonb_array_length(p_files), 0); v_new int := 0; v_fixed int := 0;
begin
  with src as (
    select distinct on (f->>'id') f->>'id' as fid, f->>'slug' as slug, f->>'title' as title,
           coalesce(f->>'quality', '1080p') as quality, nullif(f->>'size', '')::bigint as size, nullif(f->>'container', '') as container
    from jsonb_array_elements(p_files) f
  ), fresh as (
    select s.* from src s
    where not exists (select 1 from public.media_sources m where m.provider = 'onefichier' and m.file_id = s.fid)
  ), ins_t as (
    insert into public.titles (type, slug, title, is_published, published_at, model_id, poster_url)
    select 'movie', slug, title, p_publish, case when p_publish then now() end, p_model_id, p_poster from fresh
    on conflict do nothing
    returning id, slug
  ), ins_s as (
    insert into public.media_sources (title_id, provider, file_id, quality, size_bytes, container, priority, is_active)
    select t.id, 'onefichier', f.fid, f.quality::public.video_quality, f.size, left(f.container, 8), 10, true
    from ins_t t join fresh f on f.slug = t.slug
    on conflict do nothing
    returning 1
  ), fix as (
    update public.titles t
       set model_id = p_model_id,
           poster_url = case when p_poster is not null then p_poster when t.poster_url like '%#model' then null else t.poster_url end
      from public.media_sources m
     where p_reassign and p_model_id is not null
       and m.title_id = t.id and m.provider = 'onefichier'
       and m.file_id in (select fid from src)
       and t.model_id is distinct from p_model_id
    returning 1
  )
  select (select count(*) from ins_s), (select count(*) from fix) into v_new, v_fixed;
  return jsonb_build_object('total', v_total, 'imported', v_new, 'ignored', v_total - v_new, 'fixed', v_fixed);
end $$;
revoke all on function public.import_onefichier_batch(jsonb, boolean, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.import_onefichier_batch(jsonb, boolean, uuid, text, boolean) to service_role;
