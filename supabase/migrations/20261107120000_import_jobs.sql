-- Import récursif du compte 1fichier : job persistant (file de dossiers) + insertion par lots.
-- Accès service_role uniquement (Edge Function onefichier-import) ; lecture admin pour l'avancement.

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid(),
  root_folder_id bigint not null,
  root_name text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'waiting', 'completed', 'cancelled', 'error')),
  publish boolean not null default false,
  model_per_folder boolean not null default true,
  -- file d'attente : [{ "id": 123, "name": "Dossier", "model": "Nom du modèle" }]
  queue jsonb not null default '[]'::jsonb,
  folders_done int not null default 0,
  files_seen bigint not null default 0,
  imported bigint not null default 0,
  ignored bigint not null default 0,
  failed bigint not null default 0,
  current_folder text,
  last_message text,
  resume_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.import_jobs enable row level security;
revoke all on public.import_jobs from anon, authenticated;
grant select on public.import_jobs to authenticated;
create policy import_jobs_admin_read on public.import_jobs for select to authenticated using (public.is_admin());

-- Insertion par lots : un titre « film » + sa source 1fichier par fichier, déjà connus ignorés. Retourne les compteurs.
create or replace function public.import_onefichier_batch(p_files jsonb, p_publish boolean, p_model_id uuid, p_poster text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int := coalesce(jsonb_array_length(p_files), 0); v_new int := 0;
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
  )
  select count(*) into v_new from ins_s;
  return jsonb_build_object('total', v_total, 'imported', v_new, 'ignored', v_total - v_new);
end $$;
revoke all on function public.import_onefichier_batch(jsonb, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.import_onefichier_batch(jsonb, boolean, uuid, text) to service_role;

-- Verrou de traitement : un seul « tick » à la fois par job. Retourne true si le verrou est pris.
create or replace function public.import_job_lock(p_job uuid, p_seconds int default 150)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.import_jobs
     set locked_until = now() + make_interval(secs => p_seconds), status = case when status in ('pending', 'waiting') then 'running' else status end, updated_at = now()
   where id = p_job and status in ('pending', 'running', 'waiting') and (locked_until is null or locked_until < now())
     and (resume_at is null or resume_at <= now());
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.import_job_lock(uuid, int) from public, anon, authenticated;
grant execute on function public.import_job_lock(uuid, int) to service_role;
