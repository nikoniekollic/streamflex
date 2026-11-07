-- Listes de lecture (par profil) + tirage aléatoire de titres pour la lecture « aléatoire » du lecteur.
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.viewer_profiles (id, user_id) on delete cascade
);
create index playlists_profile_idx on public.playlists (profile_id, created_at desc);
create trigger playlists_updated_at before update on public.playlists
  for each row execute function public.set_updated_at();

create table public.playlist_items (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, title_id)
);
create index playlist_items_title_idx on public.playlist_items (title_id);

alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
revoke all on public.playlists, public.playlist_items from anon, authenticated;
grant select, delete on public.playlists, public.playlist_items to authenticated;
grant insert (name, profile_id) on public.playlists to authenticated;
grant update (name) on public.playlists to authenticated;
grant insert (playlist_id, title_id) on public.playlist_items to authenticated;

create policy playlists_own on public.playlists for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy playlist_items_own on public.playlist_items for all to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid())));

-- Titres tirés au hasard (publiés, films) ; « p_exclude » évite de rejouer ceux déjà passés
create or replace function public.random_title_ids(p_limit int default 30, p_model uuid default null, p_kids boolean default false, p_exclude uuid[] default '{}')
returns setof uuid language sql stable security invoker set search_path = public as $$
  select t.id from public.titles t
   where t.is_published and t.type = 'movie'
     and (p_model is null or t.model_id = p_model)
     and (not coalesce(p_kids, false) or public.is_kids_safe(t.maturity_rating, t.id))
     and not (t.id = any (coalesce(p_exclude, '{}')))
   order by random()
   limit greatest(least(p_limit, 100), 1)
$$;
revoke all on function public.random_title_ids(int, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.random_title_ids(int, uuid, boolean, uuid[]) to authenticated;
