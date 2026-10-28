-- 0012_viewer_profiles.sql — profils multiples par compte (façon Netflix), contrôle parental, catalogue enfants
-- NB : `public.profiles` existe déjà (profil du COMPTE : rôle, pseudo…) → les profils de visionnage vivent dans `viewer_profiles`.
create extension if not exists pgcrypto with schema extensions;

-- ═════════════ Table
create table public.viewer_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 30),
  avatar_url      text check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~ '^(preset:[a-z0-9-]{1,30}|https://\S+)$')),
  is_kids_profile boolean not null default false,
  pin_code        text,             -- hash bcrypt du PIN (jamais en clair, jamais exposé au client)
  position        smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id)
);
create unique index viewer_profiles_name_uidx on public.viewer_profiles (user_id, lower(btrim(name)));
create index viewer_profiles_user_idx on public.viewer_profiles (user_id, position);
create trigger viewer_profiles_updated_at before update on public.viewer_profiles
  for each row execute function public.set_updated_at();

create table public.viewer_pin_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index viewer_pin_attempts_idx on public.viewer_pin_attempts (user_id, created_at desc);

alter table public.viewer_profiles enable row level security;
alter table public.viewer_pin_attempts enable row level security;
revoke all on public.viewer_profiles, public.viewer_pin_attempts from anon, authenticated;
-- lecture colonne par colonne : pin_code jamais lisible
grant select (id, user_id, name, avatar_url, is_kids_profile, position, created_at, updated_at) on public.viewer_profiles to authenticated;
create policy viewer_profiles_own on public.viewer_profiles for select to authenticated using (user_id = (select auth.uid()));

-- Profil par défaut pour chaque compte (existants + futurs)
insert into public.viewer_profiles (user_id, name)
select u.id, left(coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Profil 1'), 30)
from auth.users u left join public.profiles p on p.id = u.id
where not exists (select 1 from public.viewer_profiles v where v.user_id = u.id);

create or replace function public.create_default_viewer_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.viewer_profiles (user_id, name)
  values (new.id, left(coalesce(nullif(btrim(new.display_name), ''), 'Profil 1'), 30))
  on conflict do nothing;
  return new;
end $$;
create trigger profiles_default_viewer after insert on public.profiles
  for each row execute function public.create_default_viewer_profile();

-- ═════════════ watch_progress / user_favorites : profile_id (user_id conservé pour la propriété et les stats)
alter table public.watch_progress add column profile_id uuid;
alter table public.user_favorites add column profile_id uuid;

update public.watch_progress w set profile_id = (
  select v.id from public.viewer_profiles v where v.user_id = w.user_id order by v.position, v.created_at limit 1);
update public.user_favorites f set profile_id = (
  select v.id from public.viewer_profiles v where v.user_id = f.user_id order by v.position, v.created_at limit 1);

alter table public.watch_progress alter column profile_id set not null;
alter table public.user_favorites alter column profile_id set not null;

-- FK composite : le profil appartient forcément au même compte que la ligne (user_id = auth.uid() via RLS)
alter table public.watch_progress add constraint watch_progress_profile_fkey
  foreign key (profile_id, user_id) references public.viewer_profiles (id, user_id) on delete cascade;
alter table public.user_favorites add constraint user_favorites_profile_fkey
  foreign key (profile_id, user_id) references public.viewer_profiles (id, user_id) on delete cascade;

alter table public.watch_progress drop constraint watch_progress_user_id_title_id_episode_id_key;
alter table public.watch_progress add constraint watch_progress_profile_title_episode_key
  unique nulls not distinct (profile_id, title_id, episode_id);
create index watch_progress_profile_recent_idx on public.watch_progress (profile_id, updated_at desc);

alter table public.user_favorites drop constraint user_favorites_pkey;
alter table public.user_favorites add primary key (profile_id, title_id);
create index user_favorites_profile_recent_idx on public.user_favorites (profile_id, created_at desc);

grant insert (title_id, profile_id) on public.user_favorites to authenticated;
grant insert (profile_id) on public.watch_progress to authenticated;

-- ═════════════ Catalogue enfants
alter table public.genres add column if not exists is_family boolean not null default false;
update public.genres set is_family = true where slug in ('animation', 'famille', 'family', 'jeunesse', 'kids', 'dessin-anime');

create or replace function public.is_kids_safe(p_maturity text, p_title uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_maturity in ('Tous publics', '10+'), false)
      or (p_maturity is null and exists (
            select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id
            where tg.title_id = p_title and g.is_family))
$$;
grant execute on function public.is_kids_safe(text, uuid) to authenticated, service_role;

-- Accueil (titres publiés + genres), filtrable enfants — utilisé par l'Edge `catalog` et le repli direct
create or replace function public.catalog_titles(p_kids boolean default false, p_limit integer default 60)
returns table (
  id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint, runtime_minutes smallint,
  maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz, genres jsonb
) language sql stable security invoker set search_path = '' as $$
  select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating,
         t.poster_url, t.backdrop_url, t.logo_url, t.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name) order by g.name)
                   from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = t.id), '[]'::jsonb)
  from public.titles t
  where t.is_published and (not coalesce(p_kids, false) or public.is_kids_safe(t.maturity_rating, t.id))
  order by t.published_at desc nulls last
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
grant execute on function public.catalog_titles(boolean, integer) to authenticated, service_role;

-- search_titles + p_kids
drop function public.search_titles(text, public.title_type, text, integer, integer);
create or replace function public.search_titles(
  p_q text default null, p_type public.title_type default null, p_genre text default null,
  p_limit integer default 30, p_offset integer default 0, p_kids boolean default false
)
returns table (
  id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint,
  runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text,
  published_at timestamptz, genres jsonb, rank real, total_count bigint
)
language sql stable security invoker set search_path = '' as $$
  with params as (
    select nullif(btrim(lower(public.f_unaccent(coalesce(p_q, '')))), '') as q,
           least(greatest(coalesce(p_limit, 30), 1), 100) as lim, greatest(coalesce(p_offset, 0), 0) as off
  ),
  base as (
    select t.*, p.q,
      case when p.q is null then null else websearch_to_tsquery('simple', p.q) end as tsq,
      lower(public.f_unaccent(t.title)) as t_norm
    from public.titles t, params p
    where t.is_published
      and (p_type is null or t.type = p_type)
      and (not coalesce(p_kids, false) or public.is_kids_safe(t.maturity_rating, t.id))
      and (p_genre is null or exists (
        select 1 from public.title_genres tg join public.genres g on g.id = tg.genre_id
        where tg.title_id = t.id and g.slug = p_genre))
  ),
  matched as (
    select b.*,
      case when b.q is null then 0::real else (
        ts_rank_cd(b.search, b.tsq) * 2 + extensions.similarity(b.t_norm, b.q)
        + case when b.t_norm = b.q then 3 when b.t_norm like b.q || '%' then 1.5 when b.t_norm like '%' || b.q || '%' then 0.75 else 0 end
      )::real end as rank
    from base b
    where b.q is null or b.search @@ b.tsq or b.t_norm like '%' || b.q || '%'
       or lower(public.f_unaccent(coalesce(b.synopsis, ''))) like '%' || b.q || '%'
       or extensions.similarity(b.t_norm, b.q) > 0.3 or extensions.word_similarity(b.q, b.t_norm) > 0.5
  )
  select m.id, m.type, m.slug, m.title, m.synopsis, m.release_year, m.runtime_minutes, m.maturity_rating,
         m.poster_url, m.backdrop_url, m.logo_url, m.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name) order by g.name)
                   from public.title_genres tg join public.genres g on g.id = tg.genre_id where tg.title_id = m.id), '[]'::jsonb),
         m.rank, count(*) over ()
  from matched m
  order by m.rank desc, m.published_at desc nulls last, m.title
  limit (select lim from params) offset (select off from params);
$$;
revoke execute on function public.search_titles(text, public.title_type, text, integer, integer, boolean) from anon, public;
grant execute on function public.search_titles(text, public.title_type, text, integer, integer, boolean) to authenticated, service_role;

-- ═════════════ Gestion des profils (RPC, réponses JSON : les échecs de PIN sont journalisés)
create or replace function public._viewer_pin_locked(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select count(*) >= 5 from public.viewer_pin_attempts
  where user_id = p_user and not success and created_at > now() - interval '15 minutes'
$$;

-- PIN valide pour : le profil lui-même OU (p_parental) n'importe quel profil adulte protégé du compte
create or replace function public._viewer_pin_matches(p_user uuid, p_profile uuid, p_pin text, p_parental boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then return false; end if;
  select exists (
    select 1 from public.viewer_profiles v
    where v.user_id = p_user and v.pin_code is not null
      and (v.id = p_profile or (p_parental and not v.is_kids_profile))
      and v.pin_code = extensions.crypt(p_pin, v.pin_code)
  ) into v_ok;
  insert into public.viewer_pin_attempts (user_id, success) values (p_user, v_ok);
  return v_ok;
end $$;

create or replace function public._parental_enabled(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.viewer_profiles where user_id = p_user and pin_code is not null and not is_kids_profile)
$$;

revoke all on function public._viewer_pin_locked(uuid), public._viewer_pin_matches(uuid, uuid, text, boolean),
  public._parental_enabled(uuid) from public, anon, authenticated;

create or replace function public.my_viewer_profiles()
returns table (id uuid, name text, avatar_url text, is_kids_profile boolean, has_pin boolean, sort_order smallint)
language sql stable security definer set search_path = '' as $$
  select v.id, v.name, v.avatar_url, v.is_kids_profile, v.pin_code is not null, v.position
  from public.viewer_profiles v where v.user_id = (select auth.uid())
  order by v.position, v.created_at
$$;

-- Activation d'un profil (vérifie le PIN s'il existe)
create or replace function public.unlock_viewer_profile(p_id uuid, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_has_pin boolean;
begin
  select pin_code is not null into v_has_pin from public.viewer_profiles where id = p_id and user_id = v_uid;
  if v_has_pin is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not v_has_pin then return jsonb_build_object('ok', true); end if;
  if public._viewer_pin_locked(v_uid) then return jsonb_build_object('ok', false, 'error', 'pin_locked'); end if;
  if public._viewer_pin_matches(v_uid, p_id, p_pin, false) then return jsonb_build_object('ok', true); end if;
  return jsonb_build_object('ok', false, 'error', 'wrong_pin');
end $$;

create or replace function public.create_viewer_profile(
  p_name text, p_avatar_url text default null, p_is_kids boolean default false,
  p_new_pin text default null, p_parental_pin text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  if (select count(*) from public.viewer_profiles where user_id = v_uid) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'max_profiles');
  end if;
  if p_new_pin is not null and p_new_pin !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'error', 'invalid_pin'); end if;
  -- contrôle parental actif : créer un profil ADULTE exige un PIN parental
  if not coalesce(p_is_kids, false) and public._parental_enabled(v_uid) then
    if public._viewer_pin_locked(v_uid) then return jsonb_build_object('ok', false, 'error', 'pin_locked'); end if;
    if not public._viewer_pin_matches(v_uid, null, p_parental_pin, true) then
      return jsonb_build_object('ok', false, 'error', 'parental_pin_required');
    end if;
  end if;
  begin
    insert into public.viewer_profiles (user_id, name, avatar_url, is_kids_profile, pin_code, position)
    values (v_uid, btrim(p_name), nullif(btrim(p_avatar_url), ''), coalesce(p_is_kids, false),
            case when p_new_pin is null then null else extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)) end,
            (select coalesce(max(position), -1) + 1 from public.viewer_profiles where user_id = v_uid))
    returning id into v_id;
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'error', 'name_taken');
    when check_violation then return jsonb_build_object('ok', false, 'error', 'invalid_values');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Modification : nom/avatar/enfant ; PIN : p_new_pin ('' = supprimer, null = inchangé)
create or replace function public.update_viewer_profile(
  p_id uuid, p_name text, p_avatar_url text default null, p_is_kids boolean default null,
  p_new_pin text default null, p_pin text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v public.viewer_profiles%rowtype;
  v_needs_pin boolean;
  v_kids boolean;
begin
  select * into v from public.viewer_profiles where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_kids := coalesce(p_is_kids, v.is_kids_profile);
  if p_new_pin is not null and p_new_pin <> '' and p_new_pin !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;
  -- PIN requis si : profil protégé, ou passage enfant → adulte / changement de PIN sous contrôle parental
  v_needs_pin := v.pin_code is not null
    or (public._parental_enabled(v_uid) and ((v.is_kids_profile and not v_kids) or p_new_pin is not null));
  if v_needs_pin then
    if public._viewer_pin_locked(v_uid) then return jsonb_build_object('ok', false, 'error', 'pin_locked'); end if;
    if not public._viewer_pin_matches(v_uid, p_id, p_pin, true) then return jsonb_build_object('ok', false, 'error', 'wrong_pin'); end if;
  end if;
  begin
    update public.viewer_profiles set
      name = btrim(p_name),
      avatar_url = nullif(btrim(p_avatar_url), ''),
      is_kids_profile = v_kids,
      pin_code = case
        when p_new_pin is null then pin_code
        when p_new_pin = '' then null
        else extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)) end
    where id = p_id;
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'error', 'name_taken');
    when check_violation then return jsonb_build_object('ok', false, 'error', 'invalid_values');
  end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.delete_viewer_profile(p_id uuid, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v public.viewer_profiles%rowtype;
begin
  select * into v from public.viewer_profiles where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if (select count(*) from public.viewer_profiles where user_id = v_uid) <= 1 then
    return jsonb_build_object('ok', false, 'error', 'last_profile');
  end if;
  if v.pin_code is not null or public._parental_enabled(v_uid) then
    if public._viewer_pin_locked(v_uid) then return jsonb_build_object('ok', false, 'error', 'pin_locked'); end if;
    if not public._viewer_pin_matches(v_uid, p_id, p_pin, true) then return jsonb_build_object('ok', false, 'error', 'wrong_pin'); end if;
  end if;
  delete from public.viewer_profiles where id = p_id; -- cascade : progression + favoris du profil
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.my_viewer_profiles(), public.unlock_viewer_profile(uuid, text),
  public.create_viewer_profile(text, text, boolean, text, text),
  public.update_viewer_profile(uuid, text, text, boolean, text, text),
  public.delete_viewer_profile(uuid, text) from public, anon;
grant execute on function public.my_viewer_profiles(), public.unlock_viewer_profile(uuid, text),
  public.create_viewer_profile(text, text, boolean, text, text),
  public.update_viewer_profile(uuid, text, text, boolean, text, text),
  public.delete_viewer_profile(uuid, text) to authenticated;

-- ═════════════ Progression par profil
drop function public.save_progress(uuid, uuid, integer, integer);
create or replace function public.save_progress(
  p_profile_id uuid, p_title_id uuid, p_episode_id uuid, p_position_seconds integer, p_duration_seconds integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_prev integer;
  v_prev_at timestamptz;
  v_delta integer;
  v_pos integer := greatest(0, coalesce(p_position_seconds, 0));
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.viewer_profiles where id = p_profile_id and user_id = v_uid) then
    raise exception 'profile_not_found' using errcode = '42501';
  end if;
  if not exists (select 1 from public.titles where id = p_title_id and is_published) then
    raise exception 'title_not_available' using errcode = '42501';
  end if;

  select position_seconds, updated_at into v_prev, v_prev_at
  from public.watch_progress
  where profile_id = p_profile_id and title_id = p_title_id and episode_id is not distinct from p_episode_id
  for update;

  insert into public.watch_progress (user_id, profile_id, title_id, episode_id, position_seconds, duration_seconds)
  values (v_uid, p_profile_id, p_title_id, p_episode_id, v_pos, nullif(p_duration_seconds, 0))
  on conflict (profile_id, title_id, episode_id) do update
    set position_seconds = excluded.position_seconds,
        duration_seconds = coalesce(excluded.duration_seconds, public.watch_progress.duration_seconds);

  if v_prev is not null then
    v_delta := least(v_pos - v_prev, ceil(extract(epoch from now() - v_prev_at))::integer + 5);
    if v_delta > 0 then
      insert into public.watch_daily (user_id, title_id, day, seconds)
      values (v_uid, p_title_id, current_date, v_delta)
      on conflict (user_id, title_id, day) do update set seconds = public.watch_daily.seconds + excluded.seconds;
    end if;
  end if;
end $$;
revoke all on function public.save_progress(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_progress(uuid, uuid, uuid, integer, integer) to authenticated;

-- Historique / reprise par profil
drop function public.my_continue_watching(integer);
drop function public.my_watch_history(integer, integer);

create or replace function public.my_watch_history(p_profile_id uuid, p_limit integer default 60, p_offset integer default 0)
returns table (
  title_id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint,
  runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz,
  episode_id uuid, season_number smallint, episode_number smallint, episode_name text,
  position_seconds integer, duration_seconds integer, ratio real, updated_at timestamptz, total_count bigint
) language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (wp.title_id) wp.*
    from public.watch_progress wp
    where wp.user_id = (select auth.uid()) and wp.profile_id = p_profile_id
    order by wp.title_id, wp.updated_at desc
  )
  select t.id, t.type, t.slug, t.title, t.synopsis, t.release_year, t.runtime_minutes, t.maturity_rating,
         t.poster_url, t.backdrop_url, t.logo_url, t.published_at,
         l.episode_id, s.season_number, e.episode_number, e.name,
         l.position_seconds, l.duration_seconds,
         case when l.duration_seconds > 0 then least(1, l.position_seconds::real / l.duration_seconds) else 0 end,
         l.updated_at, count(*) over ()
  from latest l
  join public.titles t on t.id = l.title_id
  left join public.episodes e on e.id = l.episode_id
  left join public.seasons s on s.id = e.season_id
  order by l.updated_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.my_continue_watching(p_profile_id uuid, p_limit integer default 20)
returns table (
  title_id uuid, type public.title_type, slug text, title text, synopsis text, release_year smallint,
  runtime_minutes smallint, maturity_rating text, poster_url text, backdrop_url text, logo_url text, published_at timestamptz,
  episode_id uuid, season_number smallint, episode_number smallint, episode_name text,
  position_seconds integer, duration_seconds integer, ratio real, updated_at timestamptz, total_count bigint
) language sql stable security invoker set search_path = '' as $$
  select h.* from public.my_watch_history(p_profile_id, 200, 0) h
  where h.duration_seconds > 0 and h.ratio >= 0.02 and h.ratio <= 0.95
  order by h.updated_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.my_watch_history(uuid, integer, integer), public.my_continue_watching(uuid, integer) from public, anon;
grant execute on function public.my_watch_history(uuid, integer, integer), public.my_continue_watching(uuid, integer) to authenticated;

-- Profil enfant autorisé à lire ce titre ? (Edge `resolve-stream`)
create or replace function public.can_profile_watch(p_profile_id uuid, p_title_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when v.id is null then 'profile_not_found'
    when not v.is_kids_profile then 'ok'
    when public.is_kids_safe(t.maturity_rating, t.id) then 'ok'
    else 'kids_restricted' end
  from (select 1) x
  left join public.viewer_profiles v on v.id = p_profile_id and v.user_id = (select auth.uid())
  left join public.titles t on t.id = p_title_id
$$;
grant execute on function public.can_profile_watch(uuid, uuid) to authenticated;
