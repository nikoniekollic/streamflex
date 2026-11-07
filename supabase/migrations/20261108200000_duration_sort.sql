-- Tri par durée : les fichiers importés n'ont pas de durée. On garde la taille du fichier (proxy : ~4 Mb/s ≈ 31 Mo/min)
-- dans titles.len_key, remplacée par la vraie durée dès qu'elle est connue (le navigateur la remonte en lisant la vidéo).
alter table public.titles add column if not exists size_bytes bigint;
alter table public.titles add column if not exists len_key real;

update public.titles t set size_bytes = s.sz
  from (select title_id, max(size_bytes) as sz from public.media_sources group by title_id) s
 where s.title_id = t.id;
update public.titles set len_key = coalesce(runtime_minutes::real, size_bytes / 31000000.0);
create index if not exists titles_len_key_idx on public.titles (len_key desc nulls last);

create or replace function public.titles_set_len_key() returns trigger language plpgsql as $$
begin
  new.len_key := coalesce(new.runtime_minutes::real, new.size_bytes / 31000000.0);
  return new;
end $$;
drop trigger if exists titles_len_key_biu on public.titles;
create trigger titles_len_key_biu before insert or update of runtime_minutes, size_bytes on public.titles
  for each row execute function public.titles_set_len_key();

-- Durée réelle remontée par le navigateur (une seule fois par titre, valeurs plausibles seulement)
create or replace function public.report_title_duration(p_title uuid, p_seconds numeric)
returns void language sql security definer set search_path = public as $$
  update public.titles set runtime_minutes = least(round(p_seconds / 60.0), 1440)::smallint
   where id = p_title and runtime_minutes is null and p_seconds between 60 and 86400
$$;
revoke all on function public.report_title_duration(uuid, numeric) from public, anon;
grant execute on function public.report_title_duration(uuid, numeric) to authenticated;

-- Import par lots : renseigne aussi la taille du fichier
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
    insert into public.titles (type, slug, title, is_published, published_at, model_id, poster_url, size_bytes)
    select 'movie', slug, title, p_publish, case when p_publish then now() end, p_model_id, p_poster, size from fresh
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
