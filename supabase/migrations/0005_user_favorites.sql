-- 0005_user_favorites.sql — « Ma Liste »
create table public.user_favorites (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title_id   uuid not null references public.titles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, title_id)
);
create index user_favorites_user_recent_idx on public.user_favorites (user_id, created_at desc);
create index user_favorites_title_idx on public.user_favorites (title_id);

alter table public.user_favorites enable row level security;

revoke all on public.user_favorites from anon, authenticated;
grant select, delete on public.user_favorites to authenticated;
grant insert (title_id) on public.user_favorites to authenticated;

create policy user_favorites_select_own on public.user_favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_favorites_insert_own on public.user_favorites for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.titles t where t.id = title_id and t.is_published)
  );
create policy user_favorites_delete_own on public.user_favorites for delete to authenticated
  using (user_id = (select auth.uid()));
