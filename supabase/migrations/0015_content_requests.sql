-- 0015_content_requests.sql — demandes d'ajout de films / séries
-- statut : pending (en attente) | added (ajouté) | rejected (refusé)
create type public.request_status as enum ('pending', 'added', 'rejected');

create table public.content_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id   uuid,                                   -- profil de visionnage à l'origine (optionnel)
  title        text not null check (char_length(btrim(title)) between 2 and 200),
  media_type   public.title_type not null,             -- movie | series
  release_year smallint check (release_year between 1880 and 2100),
  note         text check (char_length(note) <= 500), -- précision libre de l'utilisateur
  status       public.request_status not null default 'pending',
  admin_note   text check (char_length(admin_note) <= 500),
  title_id     uuid references public.titles (id) on delete set null,  -- contenu ajouté correspondant
  handled_by   uuid references auth.users (id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.viewer_profiles (id, user_id) on delete set null (profile_id)
);
-- clé de regroupement des demandes identiques (titre sans accents/casse + type)
create index content_requests_user_idx on public.content_requests (user_id, created_at desc);
create index content_requests_status_idx on public.content_requests (status, created_at desc);
create index content_requests_group_idx on public.content_requests (media_type, (lower(public.f_unaccent(btrim(title)))));
-- pas de doublon en attente pour un même utilisateur
create unique index content_requests_pending_uidx on public.content_requests
  (user_id, media_type, (lower(public.f_unaccent(btrim(title))))) where status = 'pending';

-- Anti-abus : 20 demandes en attente max, 10 / 24 h
create or replace function public.content_requests_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.content_requests where user_id = new.user_id and status = 'pending') >= 20 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;
  if (select count(*) from public.content_requests where user_id = new.user_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  return new;
end $$;
create trigger content_requests_quota before insert on public.content_requests
  for each row execute function public.content_requests_quota();

-- ═════════════ RLS
alter table public.content_requests enable row level security;
revoke all on public.content_requests from anon, authenticated;
grant select, delete on public.content_requests to authenticated;
grant insert (title, media_type, release_year, note, profile_id) on public.content_requests to authenticated;
grant update on public.content_requests to authenticated;  -- filtré par RLS : admin uniquement

create policy content_requests_select on public.content_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy content_requests_insert on public.content_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
-- l'utilisateur peut annuler une demande encore en attente ; l'admin supprime tout
create policy content_requests_delete on public.content_requests for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'pending') or (select public.is_admin()));
create policy content_requests_admin_update on public.content_requests for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ═════════════ Admin : liste avec demandeur et nombre de demandes similaires
create or replace function public.admin_list_requests(
  p_status public.request_status default null, p_q text default null, p_limit integer default 50, p_offset integer default 0
) returns table (
  id uuid, title text, media_type public.title_type, release_year smallint, note text, status public.request_status,
  admin_note text, title_id uuid, title_slug text, created_at timestamptz, handled_at timestamptz,
  user_id uuid, user_email text, user_name text, similar_count bigint, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with base as (
    select r.*, lower(public.f_unaccent(btrim(r.title))) as gkey from public.content_requests r
  ), grouped as (
    select b.*, count(*) filter (where true) over (partition by b.media_type, b.gkey) as similar
    from base b
  )
  select g.id, g.title, g.media_type, g.release_year, g.note, g.status, g.admin_note, g.title_id, t.slug,
         g.created_at, g.handled_at, g.user_id, u.email::text, coalesce(vp.name, p.display_name),
         g.similar, count(*) over ()
  from grouped g
  join auth.users u on u.id = g.user_id
  left join public.profiles p on p.id = g.user_id
  left join public.viewer_profiles vp on vp.id = g.profile_id
  left join public.titles t on t.id = g.title_id
  where (p_status is null or g.status = p_status)
    and (p_q is null or g.gkey like '%' || lower(public.f_unaccent(btrim(p_q))) || '%' or u.email ilike '%' || p_q || '%')
  order by (g.status = 'pending') desc, g.similar desc, g.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Admin : changement de statut (lot) + notification personnelle au demandeur
create or replace function public.admin_set_request_status(
  p_ids uuid[], p_status public.request_status, p_admin_note text default null, p_title_id uuid default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_slug text;
  v_count integer := 0;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_title_id is not null then
    select slug into v_slug from public.titles where id = p_title_id;
    if v_slug is null then raise exception 'title_not_found' using errcode = 'P0002'; end if;
  end if;

  for r in
    update public.content_requests c set
      status = p_status,
      admin_note = coalesce(nullif(btrim(p_admin_note), ''), c.admin_note),
      title_id = case when p_status = 'added' then coalesce(p_title_id, c.title_id) else c.title_id end,
      handled_by = case when p_status = 'pending' then null else (select auth.uid()) end,
      handled_at = case when p_status = 'pending' then null else now() end
    from (select id, status as old_status from public.content_requests where id = any (p_ids) for update) o
    where c.id = o.id and o.old_status is distinct from p_status
    returning c.user_id, c.title, c.media_type, c.title_id, c.status, c.admin_note
  loop
    v_count := v_count + 1;
    if r.status = 'added' then
      insert into public.notifications (user_id, type, message, link)
      values (r.user_id, 'new_content',
              format('Ta demande « %s » est disponible au catalogue !', r.title),
              coalesce('/title/' || (select slug from public.titles where id = r.title_id),
                       '/search?q=' || replace(r.title, ' ', '+')));
    elsif r.status = 'rejected' then
      insert into public.notifications (user_id, type, message, link)
      values (r.user_id, 'info',
              format('Ta demande « %s » n''a pas pu être ajoutée%s', r.title,
                     coalesce(' : ' || nullif(btrim(r.admin_note), ''), '.')),
              '/request');
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.admin_list_requests(public.request_status, text, integer, integer),
  public.admin_set_request_status(uuid[], public.request_status, text, uuid) from public, anon;
grant execute on function public.admin_list_requests(public.request_status, text, integer, integer),
  public.admin_set_request_status(uuid[], public.request_status, text, uuid) to authenticated;
