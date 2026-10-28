-- 0006_subscriptions_security.sql — abonnements, codes d'activation, bannissement IP, coffre de clés API
create extension if not exists pgcrypto with schema extensions;

-- ═════════════════════════ ABONNEMENTS
create type public.subscription_status as enum ('active', 'suspended', 'canceled');
create type public.activation_code_status as enum ('active', 'used', 'revoked');

create table public.subscriptions (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  status     public.subscription_status not null default 'active',
  plan       text not null default 'premium',
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null,
  updated_at timestamptz not null default now()
);
create index subscriptions_ends_at_idx on public.subscriptions (ends_at);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.subscription_events (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  source           text not null check (source in ('code', 'admin_adjust', 'admin_set', 'admin_status')),
  delta_days       integer,
  previous_ends_at timestamptz,
  new_ends_at      timestamptz,
  status           public.subscription_status,
  code_id          uuid,
  actor_id         uuid references auth.users (id) on delete set null,
  note             text check (char_length(note) <= 500),
  created_at       timestamptz not null default now()
);
create index subscription_events_user_idx on public.subscription_events (user_id, created_at desc);

create table public.activation_codes (
  id            uuid primary key default gen_random_uuid(),
  code_hash     text not null unique,                -- sha256 du code normalisé (le code clair n'est jamais stocké)
  code_hint     text not null,                       -- XXXXX-…-XX pour l'admin
  duration_days integer not null check (duration_days between 1 and 3650),
  status        public.activation_code_status not null default 'active',
  label         text check (char_length(label) <= 100),
  expires_at    timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  used_by       uuid references auth.users (id) on delete set null,
  used_at       timestamptz
);
create index activation_codes_status_idx on public.activation_codes (status, created_at desc);

create table public.redeem_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index redeem_attempts_user_idx on public.redeem_attempts (user_id, created_at desc);

-- Abonnement actif ? (admins toujours autorisés)
create or replace function public.has_active_subscription(p_user uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = coalesce(p_user, (select auth.uid()))
      and s.status = 'active' and s.ends_at > now()
  ) or exists (
    select 1 from public.profiles p where p.id = coalesce(p_user, (select auth.uid())) and p.role = 'admin'
  );
$$;

-- Crédit / débit de jours (interne)
create or replace function public._apply_subscription_days(
  p_user uuid, p_days integer, p_source text, p_code uuid, p_actor uuid, p_note text
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_prev timestamptz;
  v_new timestamptz;
begin
  select ends_at into v_prev from public.subscriptions where user_id = p_user for update;
  if p_days > 0 then
    v_new := greatest(coalesce(v_prev, now()), now()) + make_interval(days => p_days);
  else
    v_new := coalesce(v_prev, now()) + make_interval(days => p_days);
  end if;

  insert into public.subscriptions as s (user_id, ends_at, status)
  values (p_user, v_new, 'active')
  on conflict (user_id) do update
    set ends_at = excluded.ends_at,
        status = case when p_days > 0 and s.status = 'canceled' then 'active'::public.subscription_status else s.status end;

  insert into public.subscription_events (user_id, source, delta_days, previous_ends_at, new_ends_at, code_id, actor_id, note)
  values (p_user, p_source, p_days, v_prev, v_new, p_code, p_actor, p_note);
  return v_new;
end $$;
revoke all on function public._apply_subscription_days(uuid, integer, text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.normalize_activation_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Activation d'un code par l'utilisateur (retour JSON : les échecs sont journalisés, pas d'exception)
create or replace function public.redeem_activation_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_norm text := public.normalize_activation_code(p_code);
  v_code public.activation_codes%rowtype;
  v_fail integer;
  v_end timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;

  select count(*) into v_fail from public.redeem_attempts
  where user_id = v_uid and not success and created_at > now() - interval '1 hour';
  if v_fail >= 10 then return jsonb_build_object('ok', false, 'error', 'too_many_attempts'); end if;

  if length(v_norm) <> 25 then
    insert into public.redeem_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_format');
  end if;

  select * into v_code from public.activation_codes
  where code_hash = encode(extensions.digest(v_norm, 'sha256'), 'hex')
  for update;

  if not found or v_code.status = 'revoked' then
    insert into public.redeem_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_code.status = 'used' then
    insert into public.redeem_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'code_used');
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    insert into public.redeem_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'code_expired');
  end if;
  if exists (select 1 from public.subscriptions where user_id = v_uid and status = 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'subscription_suspended');
  end if;

  update public.activation_codes set status = 'used', used_by = v_uid, used_at = now() where id = v_code.id;
  v_end := public._apply_subscription_days(v_uid, v_code.duration_days, 'code', v_code.id, v_uid, null);
  insert into public.redeem_attempts (user_id, success) values (v_uid, true);
  return jsonb_build_object('ok', true, 'days', v_code.duration_days, 'ends_at', v_end);
end $$;

-- ───── Admin : abonnements
create or replace function public.admin_adjust_subscription(p_user uuid, p_days integer, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_days = 0 or abs(p_days) > 36500 then raise exception 'invalid_days' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  return public._apply_subscription_days(p_user, p_days, 'admin_adjust', null, (select auth.uid()), p_note);
end $$;

create or replace function public.admin_set_subscription(
  p_user uuid, p_ends_at timestamptz, p_status public.subscription_status default 'active', p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_prev timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  select ends_at into v_prev from public.subscriptions where user_id = p_user for update;
  insert into public.subscriptions (user_id, ends_at, status) values (p_user, coalesce(p_ends_at, v_prev, now()), p_status)
  on conflict (user_id) do update set ends_at = excluded.ends_at, status = excluded.status;
  insert into public.subscription_events (user_id, source, previous_ends_at, new_ends_at, status, actor_id, note)
  values (p_user, case when p_ends_at is null then 'admin_status' else 'admin_set' end, v_prev,
          coalesce(p_ends_at, v_prev, now()), p_status, (select auth.uid()), p_note);
end $$;

-- ───── Admin : codes d'activation (25 caractères, alphabet sans ambiguïté 0/O/1/I)
create or replace function public.admin_generate_codes(
  p_count integer, p_duration_days integer, p_label text default null, p_expires_at timestamptz default null
) returns table (id uuid, code text)
language plpgsql security definer set search_path = '' as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 symboles → 256 % 32 = 0, sans biais
  v_bytes bytea;
  v_raw text;
  v_id uuid;
  i integer;
  j integer;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_count not between 1 and 500 then raise exception 'invalid_count' using errcode = '22023'; end if;
  for i in 1..p_count loop
    loop
      v_bytes := extensions.gen_random_bytes(25);
      v_raw := '';
      for j in 0..24 loop
        v_raw := v_raw || substr(v_alpha, (get_byte(v_bytes, j) % 32) + 1, 1);
      end loop;
      begin
        insert into public.activation_codes (code_hash, code_hint, duration_days, label, expires_at, created_by)
        values (encode(extensions.digest(v_raw, 'sha256'), 'hex'),
                substr(v_raw, 1, 5) || '-…-' || substr(v_raw, 24, 2),
                p_duration_days, nullif(btrim(p_label), ''), p_expires_at, (select auth.uid()))
        returning activation_codes.id into v_id;
        exit;
      exception when unique_violation then
        -- collision (≈ impossible, 2^125) → nouveau tirage
      end;
    end loop;
    id := v_id;
    code := substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5) || '-' || substr(v_raw, 11, 5) || '-' || substr(v_raw, 16, 5) || '-' || substr(v_raw, 21, 5);
    return next;
  end loop;
end $$;

create or replace function public.admin_set_code_status(p_id uuid, p_status public.activation_code_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status = 'used' then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.activation_codes set status = p_status where id = p_id and status <> 'used';
  if not found then raise exception 'code_not_updatable' using errcode = 'P0002'; end if;
end $$;

-- ───── Admin : utilisateurs (lecture auth.users côté serveur uniquement)
create or replace function public.admin_list_users(
  p_q text default null, p_filter text default null, p_limit integer default 25, p_offset integer default 0
) returns table (
  id uuid, email text, display_name text, username text, role public.user_role, created_at timestamptz,
  last_sign_in_at timestamptz, sub_status public.subscription_status, sub_ends_at timestamptz, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, p.display_name, p.username, coalesce(p.role, 'user'::public.user_role), u.created_at,
         u.last_sign_in_at, s.status, s.ends_at, count(*) over ()
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.subscriptions s on s.user_id = u.id
  where (p_q is null or u.email ilike '%' || p_q || '%' or p.display_name ilike '%' || p_q || '%' or p.username ilike '%' || p_q || '%')
    and (p_filter is null
      or (p_filter = 'active' and s.status = 'active' and s.ends_at > now())
      or (p_filter = 'expired' and (s.user_id is null or s.ends_at <= now()))
      or (p_filter = 'suspended' and s.status in ('suspended', 'canceled'))
      or (p_filter = 'admin' and p.role = 'admin'))
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- ═════════════════════════ BANNISSEMENT IP
create table public.ip_bans (
  id         uuid primary key default gen_random_uuid(),
  ip         cidr not null unique,
  reason     text check (char_length(reason) <= 300),
  expires_at timestamptz,                     -- null = permanent
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ip_bans_ip_gist on public.ip_bans using gist (ip inet_ops);

create or replace function public.ip_ban_lookup(p_ip text)
returns table (reason text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_ip inet;
begin
  begin
    v_ip := btrim(p_ip)::inet;
  exception when others then
    return;
  end;
  return query
  select b.reason, b.expires_at from public.ip_bans b
  where v_ip <<= b.ip and (b.expires_at is null or b.expires_at > now())
  order by b.expires_at desc nulls first
  limit 1;
end $$;

create or replace function public.request_ip()
returns text language sql stable set search_path = '' as $$
  select nullif(btrim(coalesce(
    h ->> 'cf-connecting-ip',
    h ->> 'x-real-ip',
    split_part(h ->> 'x-forwarded-for', ',', 1)
  )), '')
  from (select nullif(current_setting('request.headers', true), '')::json as h) t
$$;

-- Middleware PostgREST : exécuté avant CHAQUE requête Data API (REST/RPC)
create or replace function public.check_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_ip text := public.request_ip();
  v_ban record;
begin
  if v_ip is null then return; end if;
  select * into v_ban from public.ip_ban_lookup(v_ip);
  if found then
    raise sqlstate 'PT403' using message = 'ip_banned',
      detail = coalesce(v_ban.reason, ''),
      hint = coalesce(to_char(v_ban.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'permanent');
  end if;
end $$;

alter role authenticator set pgrst.db_pre_request = 'public.check_request';
notify pgrst, 'reload config';

-- ═════════════════════════ COFFRE DES CLÉS API (Supabase Vault)
create table public.app_secrets (
  name            text primary key check (name in (
                    'ALLDEBRID_API_KEY', 'ALLDEBRID_AGENT', 'PIXELDRAIN_API_KEY', 'ONEFICHIER_API_KEY',
                    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN')),
  vault_secret_id uuid not null,
  last4           text,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

create or replace function public.admin_set_api_key(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_name not in ('ALLDEBRID_API_KEY', 'ALLDEBRID_AGENT', 'PIXELDRAIN_API_KEY', 'ONEFICHIER_API_KEY',
                    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN') then
    raise exception 'unknown_key' using errcode = '22023';  -- avant toute écriture : aucun fragment de valeur dans l'erreur
  end if;
  if p_value is null or length(btrim(p_value)) < 3 or length(p_value) > 4096 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select vault_secret_id into v_id from public.app_secrets where name = p_name;
  if v_id is null then
    v_id := vault.create_secret(btrim(p_value), 'streamflex_' || lower(p_name), 'StreamFlex — géré via /admin/security');
  else
    perform vault.update_secret(v_id, btrim(p_value));
  end if;
  insert into public.app_secrets (name, vault_secret_id, last4, updated_by, updated_at)
  values (p_name, v_id, right(btrim(p_value), 4), (select auth.uid()), now())
  on conflict (name) do update set vault_secret_id = excluded.vault_secret_id, last4 = excluded.last4,
    updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.admin_delete_api_key(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.app_secrets where name = p_name returning vault_secret_id into v_id;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
end $$;

create or replace function public.admin_list_api_keys()
returns table (name text, last4 text, updated_at timestamptz, updated_by_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select a.name, a.last4, a.updated_at, u.email::text
  from public.app_secrets a left join auth.users u on u.id = a.updated_by
  order by a.name;
end $$;

-- Lecture en clair : service_role uniquement (Edge Functions)
create or replace function public.get_api_key(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret from vault.decrypted_secrets d
  join public.app_secrets a on a.vault_secret_id = d.id
  where a.name = p_name
$$;

-- ═════════════════════════ RLS & GRANTS
alter table public.subscriptions       enable row level security;
alter table public.subscription_events enable row level security;
alter table public.activation_codes    enable row level security;
alter table public.redeem_attempts     enable row level security;
alter table public.ip_bans             enable row level security;
alter table public.app_secrets         enable row level security;

revoke all on public.subscriptions, public.subscription_events, public.activation_codes,
              public.redeem_attempts, public.ip_bans, public.app_secrets from anon, authenticated;

grant select on public.subscriptions, public.subscription_events, public.activation_codes to authenticated;
grant select, insert, update, delete on public.ip_bans to authenticated;

create policy subscriptions_select on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy activation_codes_admin on public.activation_codes for select to authenticated
  using ((select public.is_admin()));
create policy ip_bans_admin on public.ip_bans for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- redeem_attempts / app_secrets : aucune policy → accès via fonctions security definer uniquement

revoke all on function public.has_active_subscription(uuid) from public, anon;
revoke all on function public.redeem_activation_code(text) from public, anon;
revoke all on function public.admin_adjust_subscription(uuid, integer, text) from public, anon;
revoke all on function public.admin_set_subscription(uuid, timestamptz, public.subscription_status, text) from public, anon;
revoke all on function public.admin_generate_codes(integer, integer, text, timestamptz) from public, anon;
revoke all on function public.admin_set_code_status(uuid, public.activation_code_status) from public, anon;
revoke all on function public.admin_list_users(text, text, integer, integer) from public, anon;
revoke all on function public.admin_set_api_key(text, text) from public, anon;
revoke all on function public.admin_delete_api_key(text) from public, anon;
revoke all on function public.admin_list_api_keys() from public, anon;
revoke all on function public.get_api_key(text) from public, anon, authenticated;
revoke all on function public.ip_ban_lookup(text) from public, authenticated;

grant execute on function public.has_active_subscription(uuid) to authenticated, service_role;
grant execute on function public.redeem_activation_code(text) to authenticated;
grant execute on function public.admin_adjust_subscription(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_subscription(uuid, timestamptz, public.subscription_status, text) to authenticated;
grant execute on function public.admin_generate_codes(integer, integer, text, timestamptz) to authenticated;
grant execute on function public.admin_set_code_status(uuid, public.activation_code_status) to authenticated;
grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;
grant execute on function public.admin_set_api_key(text, text) to authenticated;
grant execute on function public.admin_delete_api_key(text) to authenticated;
grant execute on function public.admin_list_api_keys() to authenticated;
grant execute on function public.get_api_key(text) to service_role;
grant execute on function public.ip_ban_lookup(text) to anon, service_role;
grant execute on function public.check_request() to anon, authenticated, service_role;
grant execute on function public.request_ip() to anon, authenticated, service_role;
