-- 0008_catalog_cache.sql — invalidation du cache Redis du catalogue via webhook (pg_net) + nouvelles clés du coffre
create extension if not exists pg_net;

-- Nouvelles clés gérées dans /admin/security
alter table public.app_secrets drop constraint if exists app_secrets_name_check;
alter table public.app_secrets add constraint app_secrets_name_check check (name in (
  'ALLDEBRID_API_KEY', 'ALLDEBRID_AGENT', 'PIXELDRAIN_API_KEY', 'ONEFICHIER_API_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL',
  'CATALOG_WEBHOOK_URL', 'CATALOG_WEBHOOK_SECRET'));

create or replace function public.admin_set_api_key(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_name not in ('ALLDEBRID_API_KEY', 'ALLDEBRID_AGENT', 'PIXELDRAIN_API_KEY', 'ONEFICHIER_API_KEY',
                    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL',
                    'CATALOG_WEBHOOK_URL', 'CATALOG_WEBHOOK_SECRET') then
    raise exception 'unknown_key' using errcode = '22023';
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

-- Webhook asynchrone (pg_net : la transaction n'attend pas la réponse) → Edge Function `catalog-webhook`
create or replace function public.notify_catalog_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url text := public.get_api_key('CATALOG_WEBHOOK_URL');
  v_secret text := public.get_api_key('CATALOG_WEBHOOK_SECRET');
begin
  if v_url is null or v_secret is null then
    return null; -- cache non configuré : rien à purger
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('table', tg_table_name, 'op', tg_op),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 3000
  );
  return null;
exception when others then
  raise warning 'catalog cache invalidation failed: %', sqlerrm; -- ne bloque jamais l'écriture
  return null;
end $$;
revoke all on function public.notify_catalog_change() from public, anon, authenticated;

create trigger titles_catalog_cache after insert or update or delete on public.titles
  for each statement execute function public.notify_catalog_change();
create trigger title_genres_catalog_cache after insert or update or delete on public.title_genres
  for each statement execute function public.notify_catalog_change();
create trigger genres_catalog_cache after insert or update or delete on public.genres
  for each statement execute function public.notify_catalog_change();
