-- Vérification ciblée (admin) : un modèle ou un dossier 1fichier précis (ex. le répertoire de base).
-- Seuls les fichiers de ce modèle / de ce dossier sont comparés à 1fichier et retirés s'ils ont été supprimés ; les fichiers
-- des autres modèles, même rangés dans le même dossier, ne sont jamais touchés.

create table if not exists public.verify_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('model', 'folder')),
  target text not null,
  label text,
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  message text,
  total int not null default 0,     -- fichiers du modèle / du dossier sur le site
  absent int not null default 0,    -- absents du relevé 1fichier
  confirmed int not null default 0, -- vérifiés un par un auprès de 1fichier
  removed int not null default 0,   -- supprimés chez 1fichier : retirés du site
  pending int not null default 0,   -- absents non confirmés : retirés au prochain passage de la surveillance (20 min) ou à revérifier
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.verify_runs enable row level security; -- lu et écrit par la fonction serveur seulement
create index if not exists verify_runs_created_idx on public.verify_runs (created_at desc);

/** Retire du site les fichiers confirmés supprimés chez 1fichier (et dépublie le film s'il n'a plus aucun fichier). */
create or replace function public.verify_remove_sources(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    update public.media_sources m
       set removed_at = now(), is_active = false, missing_since = coalesce(m.missing_since, now()),
           last_checked_at = now(), last_status = 404
     where m.id = any(p_ids) and m.provider = 'onefichier' and m.removed_at is null
    returning m.id, m.title_id
  ), hide as (
    update public.titles t set is_published = false
      from (select distinct title_id from gone where title_id is not null) g
     where t.id = g.title_id and t.is_published
       and not exists (select 1 from public.media_sources m2 where m2.title_id = t.id and m2.is_active
                         and not exists (select 1 from gone x where x.id = m2.id))
    returning 1
  )
  select count(*) into n from gone;
  return n;
end $$;
revoke all on function public.verify_remove_sources(uuid[]) from public, anon, authenticated;
grant execute on function public.verify_remove_sources(uuid[]) to service_role;
