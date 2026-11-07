-- Surveillance automatique du compte 1fichier (pg_cron → Edge Function) + captures de jaquettes.

-- ───────── Voie d'appels dédiée à la surveillance (budget propre, disjoncteur partagé)
create or replace function public.onefichier_take_slot(p_lane text, p_gap_ms int, p_cap int, p_max_wait_ms int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.api_governor; v_shared timestamptz; v_now timestamptz := clock_timestamp(); v_slot timestamptz; v_wait int;
begin
  if p_lane not in ('onefichier', 'onefichier_admin', 'onefichier_watch') then raise exception 'unknown_lane' using errcode = '22023'; end if;
  insert into public.api_governor (name) values ('onefichier') on conflict do nothing;
  insert into public.api_governor (name) values (p_lane) on conflict do nothing;
  select paused_until into v_shared from public.api_governor where name = 'onefichier';
  select * into g from public.api_governor where name = p_lane for update;
  if v_shared is not null and v_shared > v_now then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'retry_s', ceil(extract(epoch from v_shared - v_now)));
  end if;
  if g.window_start < v_now - interval '1 hour' then g.window_start := v_now; g.window_count := 0; end if;
  if g.window_count >= p_cap then
    update public.api_governor set window_start = g.window_start, window_count = g.window_count where name = p_lane;
    return jsonb_build_object('ok', false, 'reason', 'hourly_cap', 'retry_s', ceil(extract(epoch from g.window_start + interval '1 hour' - v_now)));
  end if;
  v_slot := greatest(v_now, coalesce(g.last_call_at, v_now - interval '1 day') + make_interval(secs => p_gap_ms / 1000.0));
  v_wait := ceil(extract(epoch from v_slot - v_now) * 1000);
  if v_wait > p_max_wait_ms then
    return jsonb_build_object('ok', false, 'reason', 'busy', 'retry_s', ceil(v_wait / 1000.0));
  end if;
  update public.api_governor set last_call_at = v_slot, window_start = g.window_start, window_count = g.window_count + 1 where name = p_lane;
  return jsonb_build_object('ok', true, 'wait_ms', v_wait);
end $$;

-- ───────── Surveillance : dossiers connus + configuration
create table public.watch_folders (
  folder_id bigint primary key,
  parent_id bigint,
  name text not null default '',
  active boolean not null default true,
  interval_min int not null default 15,       -- s'allonge (jusqu'à 24 h) tant que rien de neuf, retombe à 15 min sinon
  next_scan_at timestamptz not null default now(),
  last_scanned_at timestamptz,
  last_new_at timestamptz,
  files_seen int not null default 0,
  imported_total bigint not null default 0
);
create index watch_folders_due_idx on public.watch_folders (next_scan_at) where active;

create table public.watch_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  publish boolean not null default false,
  model_per_folder boolean not null default true,
  folders_per_tick int not null default 2 check (folders_per_tick between 1 and 10),
  url text,
  anon_key text,
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  last_tick_at timestamptz,
  last_message text,
  updated_at timestamptz not null default now()
);
insert into public.watch_config (id) values (1) on conflict do nothing;

alter table public.watch_folders enable row level security;
alter table public.watch_config enable row level security;
revoke all on public.watch_folders, public.watch_config from anon, authenticated;
grant select on public.watch_folders to authenticated;
grant select (id, enabled, publish, model_per_folder, folders_per_tick, url, last_tick_at, last_message, updated_at) on public.watch_config to authenticated;
create policy watch_folders_admin_read on public.watch_folders for select to authenticated using (public.is_admin());
create policy watch_config_admin_read on public.watch_config for select to authenticated using (public.is_admin());

create or replace function public.admin_watch_set(p_enabled boolean, p_publish boolean, p_model_per_folder boolean, p_url text, p_anon_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_url is not null and p_url !~ '^https://[^ ]+$' then raise exception 'invalid_url' using errcode = '22023'; end if;
  update public.watch_config set enabled = p_enabled, publish = p_publish, model_per_folder = p_model_per_folder,
         url = coalesce(p_url, url), anon_key = coalesce(p_anon_key, anon_key), updated_at = now() where id = 1;
  if p_enabled then
    insert into public.watch_folders (folder_id, name) values (0, 'Racine') on conflict do nothing;
  end if;
end $$;

create or replace function public.watch_verify(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.watch_config where id = 1 and enabled and secret = p_secret);
$$;

-- Appelée par pg_cron toutes les 5 min : réveille l'Edge Function (le JWT anon sert au passage, le secret authentifie)
create or replace function public.watch_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from public.watch_config where id = 1;
  if not c.enabled or c.url is null or c.anon_key is null then return; end if;
  perform net.http_post(
    url := c.url,
    body := jsonb_build_object('action', 'watch_tick'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.anon_key, 'apikey', c.anon_key, 'x-watch-secret', c.secret),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'watch_tick failed: %', sqlerrm;
end $$;

revoke all on function public.admin_watch_set(boolean, boolean, boolean, text, text), public.watch_verify(text), public.watch_tick() from public, anon;
grant execute on function public.admin_watch_set(boolean, boolean, boolean, text, text) to authenticated;
grant execute on function public.watch_verify(text) to service_role;

create extension if not exists pg_cron;
select cron.unschedule('onefichier-watch') where exists (select 1 from cron.job where jobname = 'onefichier-watch');
select cron.schedule('onefichier-watch', '*/5 * * * *', 'select public.watch_tick()');

-- ───────── Captures de jaquettes : bucket public, écriture admin
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy covers_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (select public.is_admin()));
create policy covers_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (select public.is_admin()));
create policy covers_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (select public.is_admin()));

-- La capture (ou toute jaquette réelle) n'est plus écrasée par l'image du modèle : seules les jaquettes « #model » ou vides suivent le modèle
create or replace function public.sync_model_cover() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.image_url is distinct from old.image_url then
    update public.titles set poster_url = new.image_url || '#model'
     where model_id = new.id and (poster_url is null or poster_url like '%#model');
  end if;
  return new;
end $$;

create or replace function public.admin_attach_titles(p_model uuid, p_title_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_img text; n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if array_length(p_title_ids, 1) > 2000 then raise exception 'too_many' using errcode = '22023'; end if;
  if p_model is null then
    update public.titles set model_id = null,
      poster_url = case when poster_url like '%#model' then null else poster_url end
      where id = any (p_title_ids);
  else
    select image_url into v_img from public.models where id = p_model;
    if not found then raise exception 'unknown_model' using errcode = '22023'; end if;
    update public.titles set model_id = p_model,
      poster_url = case
        when poster_url is null or poster_url like '%#model' then (case when v_img is not null then v_img || '#model' else null end)
        else poster_url end
      where id = any (p_title_ids);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
