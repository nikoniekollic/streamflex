-- Liens débridés partagés : le premier abonné qui débride un film (dans son navigateur) dépose le lien ici ; les suivants
-- le reçoivent directement de resolve-stream, sans nouveau débridage (≈ 1 à 4 s gagnées, moins d'appels à Alldebrid).
-- Testé le 8 nov. : un lien débridé depuis une IP fonctionne depuis une autre (téléphone en 5G) → non lié à l'IP.
create table public.unlocked_links (
  title_id uuid primary key references public.titles (id) on delete cascade,
  url text not null check (url ~ '^https://[a-z0-9.-]+\.(debrid\.it|alld\.io|alldebrid\.com)/dl/[^[:space:]]+$' and char_length(url) <= 600),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index unlocked_links_expires_idx on public.unlocked_links (expires_at);
alter table public.unlocked_links enable row level security;
revoke all on public.unlocked_links from anon, authenticated; -- aucune lecture directe : seule l'Edge Function (service_role) lit

-- Dépôt de liens par les abonnés actifs. p_items : [{ "title_id": uuid, "url": text, "replace": bool }] (50 au plus)
--  • replace = false : n'écrase que si le lien en place expire dans moins de 10 min (premier arrivé, premier servi)
--  • replace = true  : le client a constaté que le lien en place est mort et vient d'en débrider un neuf
create or replace function public.share_unlocked_links(p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_ttl interval := interval '90 minutes';
begin
  if not public.has_active_subscription() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  with src as (
    select (i->>'title_id')::uuid as title_id, i->>'url' as url, coalesce((i->>'replace')::boolean, false) as rep
    from jsonb_array_elements(p_items) i
    where (i->>'url') ~ '^https://[a-z0-9.-]+\.(debrid\.it|alld\.io|alldebrid\.com)/dl/[^[:space:]]+$' and char_length(i->>'url') <= 600
  ), ok as (
    select s.* from src s where exists (select 1 from public.titles t where t.id = s.title_id and t.is_published)
  ), up as (
    insert into public.unlocked_links as u (title_id, url, created_at, expires_at)
    select title_id, url, now(), now() + v_ttl from ok
    on conflict (title_id) do update
      set url = excluded.url, created_at = now(), expires_at = excluded.expires_at
      where u.expires_at < now() + interval '10 minutes'
         or exists (select 1 from ok o where o.title_id = u.title_id and o.rep)
    returning 1
  )
  select count(*) into v_n from up;

  delete from public.unlocked_links where expires_at < now() - interval '1 day';
  return v_n;
end $$;
revoke all on function public.share_unlocked_links(jsonb) from public, anon;
grant execute on function public.share_unlocked_links(jsonb) to authenticated;
