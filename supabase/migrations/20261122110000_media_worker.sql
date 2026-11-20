-- Travailleur autonome (programme sur le PC de l'admin, connexion de particulier) : durées réelles + image de jaquette
-- Alldebrid et 1fichier refusent les serveurs (NO_SERVER / HTTP 503) : seul un appareil sur une connexion de particulier peut lire
-- les vidéos. Le programme demande du travail à la fonction media-worker (clé WORKER_SECRET), lit la durée (ffprobe), prend une
-- image au moment de la jaquette (ffmpeg, 320 px, WebP ~8 Ko) et renvoie le tout : l'image est stockée UNE fois pour tout le site
-- (bucket « stills ») et devient la jaquette par défaut (poster_url), affichée instantanément au lieu d'un fond noir.
-- Un fichier que le débrideur dit supprimé est signalé comme ceux des lecteurs (suspect_at) : la surveillance le vérifie et le retire.

-- Suivi du travail à part (une mise à jour de titles purge le cache du catalogue : seuls les résultats y sont écrits)
create table if not exists public.media_work (
  title_id uuid primary key references public.titles(id) on delete cascade,
  claimed_at timestamptz,
  failed_at timestamptz,
  tries smallint not null default 0,
  still_pos real -- moment (fraction de la durée) de l'image enregistrée : refaite si l'admin change cover_pos
);
alter table public.media_work enable row level security; -- aucun accès client (service_role seulement)

-- titres à traiter : durée inconnue ou pas d'image de jaquette (index partiel, parcours dans l'ordre de publication)
create index if not exists titles_media_todo_idx on public.titles (published_at desc nulls last, id)
  where is_published and type = 'movie' and (duration_s is null or poster_url is null or poster_url like '%#model');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stills', 'stills', true, 65536, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 65536, allowed_mime_types = array['image/webp'];

/**
 * Lot de travail : réservé 20 min (plusieurs programmes peuvent tourner sans faire deux fois la même vidéo).
 * p_stills = false : stockage des images plein, durées seulement (sinon les mêmes titres reviendraient sans fin).
 */
create or replace function public.media_worker_claim(p_n integer default 12, p_stills boolean default true)
returns table(title_id uuid, file_id text, cover_pos real, duration_s integer, need_still boolean)
language plpgsql security definer set search_path = public as $$
declare v_n int := least(greatest(coalesce(p_n, 12), 1), 50); v_ids uuid[];
begin
  if p_stills then
    select array_agg(id) into v_ids from (
      (select t.id from public.titles t
        where t.is_published and t.type = 'movie' and (t.duration_s is null or t.poster_url is null or t.poster_url like '%#model')
          and exists (select 1 from public.media_sources ms where ms.title_id = t.id and ms.provider = 'onefichier' and ms.is_active and ms.file_id is not null)
          and not exists (select 1 from public.media_work w where w.title_id = t.id
                            and (w.claimed_at > now() - interval '20 minutes' or w.failed_at > now() - (interval '1 day' * least(w.tries, 7))))
        order by t.published_at desc nulls last, t.id
        limit v_n)
      union
      -- image prise à un autre moment que celui choisi depuis dans l'admin : refaite
      (select t.id from public.titles t join public.media_work w on w.title_id = t.id
        where t.is_published and t.cover_pos is not null and w.still_pos is distinct from t.cover_pos and t.poster_url like '%/stills/%'
          and (w.claimed_at is null or w.claimed_at < now() - interval '20 minutes')
          and (w.failed_at is null or w.failed_at < now() - (interval '1 day' * least(w.tries, 7)))
        limit v_n)
    ) d limit v_n;
  else
    select array_agg(id) into v_ids from (
      select t.id from public.titles t
       where t.is_published and t.type = 'movie' and t.duration_s is null
         and exists (select 1 from public.media_sources ms where ms.title_id = t.id and ms.provider = 'onefichier' and ms.is_active and ms.file_id is not null)
         and not exists (select 1 from public.media_work w where w.title_id = t.id
                           and (w.claimed_at > now() - interval '20 minutes' or w.failed_at > now() - (interval '1 day' * least(w.tries, 7))))
       order by t.published_at desc nulls last, t.id
       limit v_n
    ) d;
  end if;
  if v_ids is null then return; end if;

  insert into public.media_work as w (title_id, claimed_at) select unnest(v_ids), now()
  on conflict on constraint media_work_pkey do update set claimed_at = now();

  return query
  select t.id, s.file_id::text, t.cover_pos, t.duration_s,
         p_stills and (t.poster_url is null or t.poster_url like '%#model' or (t.cover_pos is not null and w.still_pos is distinct from t.cover_pos))
    from public.titles t
    join public.media_work w on w.title_id = t.id
    cross join lateral (select ms.file_id from public.media_sources ms
                         where ms.title_id = t.id and ms.provider = 'onefichier' and ms.is_active and ms.file_id is not null
                         order by ms.priority limit 1) s
   where t.id = any (v_ids);
end $$;

/**
 * Résultats : [{id, duration?, dead?, failed?}]. Durée : seulement si inconnue. dead : fichier supprimé selon le débrideur
 * (vérifié ensuite par la surveillance avant tout retrait). failed : réessayé plus tard (1 jour, 2 jours… 7 jours au plus).
 */
create or replace function public.media_worker_report(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dur int := 0; v_dead int := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then return '{}'::jsonb; end if;
  perform set_config('sf.keep_updated', '1', true);
  create temp table if not exists _mw (id uuid, dur int, dead boolean, failed boolean) on commit drop;
  truncate _mw;
  insert into _mw
  select (x->>'id')::uuid,
         case when jsonb_typeof(x->'duration') = 'number' then round((x->>'duration')::numeric)::int end,
         coalesce((x->>'dead')::boolean, false), coalesce((x->>'failed')::boolean, false)
    from (select x from jsonb_array_elements(p_items) x limit 100) e
   where (x->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  update public.titles t
     set duration_s = m.dur,
         runtime_minutes = coalesce(t.runtime_minutes, greatest(1, least(round(m.dur / 60.0), 1440))::smallint)
    from _mw m
   where t.id = m.id and m.dur between 1 and 86400 and t.duration_s is null;
  get diagnostics v_dur = row_count;

  with s as (
    update public.media_sources ms set suspect_at = now()
     where ms.title_id in (select id from _mw where dead) and ms.provider = 'onefichier' and ms.removed_at is null
       and (ms.suspect_at is null or ms.suspect_at < now() - interval '6 hours')
    returning ms.folder_id
  ), f as (
    update public.watch_folders w set force_full = true, next_scan_at = least(w.next_scan_at, now())
     where w.folder_id in (select distinct folder_id from s where folder_id is not null)
       and w.active and w.missing_since is null and not coalesce(w.capped, false)
    returning 1
  )
  select count(*) into v_dead from s;

  update public.media_work w
     set claimed_at = null,
         failed_at = case when m.failed or m.dead then now() else w.failed_at end,
         tries = case when m.failed or m.dead then least(w.tries + 1, 30) else w.tries end
    from _mw m where w.title_id = m.id;
  return jsonb_build_object('durations', v_dur, 'dead', v_dead);
end $$;

/** Image de jaquette enregistrée (fichier déjà déposé dans le bucket) : devient la jaquette par défaut, sauf image choisie à la main. */
create or replace function public.media_worker_still(p_title uuid, p_url text, p_pos real)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('sf.keep_updated', '1', true);
  update public.titles set poster_url = p_url
   where id = p_title and (poster_url is null or poster_url like '%#model' or poster_url like '%/stills/%');
  get diagnostics n = row_count;
  insert into public.media_work as w (title_id, still_pos) values (p_title, p_pos)
  on conflict (title_id) do update set still_pos = p_pos, failed_at = null, tries = 0;
  return n > 0;
end $$;

/** Avancement (panneau admin / journal du programme). */
create or replace function public.media_worker_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'published', (select count(*) from public.titles where is_published and type = 'movie'),
    'no_duration', (select count(*) from public.titles where is_published and type = 'movie' and duration_s is null),
    'no_still', (select count(*) from public.titles where is_published and type = 'movie' and (poster_url is null or poster_url like '%#model')),
    'stills_mb', (select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1e6) from storage.objects where bucket_id = 'stills')
  )
$$;

revoke all on function public.media_worker_claim(integer, boolean) from public, anon, authenticated;
revoke all on function public.media_worker_report(jsonb) from public, anon, authenticated;
revoke all on function public.media_worker_still(uuid, text, real) from public, anon, authenticated;
revoke all on function public.media_worker_stats() from public, anon, authenticated;
grant execute on function public.media_worker_claim(integer, boolean) to service_role;
grant execute on function public.media_worker_report(jsonb) to service_role;
grant execute on function public.media_worker_still(uuid, text, real) to service_role;
grant execute on function public.media_worker_stats() to service_role;
