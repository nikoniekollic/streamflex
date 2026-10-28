-- 0010_notifications.sql — notifications temps réel (personnelles + globales)
create type public.notification_type as enum ('info', 'new_content', 'subscription', 'warning', 'system');

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete cascade,   -- null = alerte globale (tous les utilisateurs)
  type        public.notification_type not null default 'info',
  message     text not null check (char_length(message) between 1 and 500),
  link        text check (link is null or link ~ '^/[^/]'),         -- chemin interne uniquement (pas d'URL externe)
  read_status boolean not null default false,                       -- notifications personnelles
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_global_idx on public.notifications (created_at desc) where user_id is null;

-- Lecture des alertes globales : un état par utilisateur (read_status unique ne suffit pas)
create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
revoke all on public.notifications, public.notification_reads from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_status) on public.notifications to authenticated;
grant select, insert on public.notification_reads to authenticated;
grant insert (user_id, type, message, link), delete on public.notifications to authenticated;

-- Lecture : les siennes + les globales (aussi utilisé par Realtime pour filtrer les événements)
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or user_id is null or (select public.is_admin()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_admin_insert on public.notifications for insert to authenticated
  with check ((select public.is_admin()));
create policy notifications_admin_delete on public.notifications for delete to authenticated
  using ((select public.is_admin()));

create policy notification_reads_own on public.notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ───── RPC utilisateur
create or replace function public.my_notifications(p_limit integer default 50)
returns table (id uuid, type public.notification_type, message text, link text, is_global boolean, read boolean, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select n.id, n.type, n.message, n.link, n.user_id is null,
         case when n.user_id is null then r.notification_id is not null else n.read_status end,
         n.created_at
  from public.notifications n
  left join public.notification_reads r on r.notification_id = n.id and r.user_id = (select auth.uid())
  where n.user_id = (select auth.uid())
     or (n.user_id is null and n.created_at >= coalesce(
           (select p.created_at from public.profiles p where p.id = (select auth.uid())), '-infinity') - interval '30 days')
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.notifications set read_status = true where id = p_id and user_id = (select auth.uid());
  if not found then
    insert into public.notification_reads (notification_id, user_id)
    select n.id, (select auth.uid()) from public.notifications n where n.id = p_id and n.user_id is null
    on conflict do nothing;
  end if;
end $$;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.notifications set read_status = true where user_id = (select auth.uid()) and not read_status;
  insert into public.notification_reads (notification_id, user_id)
  select n.id, (select auth.uid()) from public.notifications n
  where n.user_id is null and n.created_at >= now() - interval '1 year'
  on conflict do nothing;
end $$;

-- ───── RPC admin : diffusion
create or replace function public.admin_send_notification(
  p_message text, p_type public.notification_type default 'info', p_link text default null, p_user uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.notifications (user_id, type, message, link, created_by)
  values (p_user, p_type, btrim(p_message), nullif(btrim(p_link), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.my_notifications(integer), public.mark_notification_read(uuid),
  public.mark_all_notifications_read(), public.admin_send_notification(text, public.notification_type, text, uuid) from public, anon;
grant execute on function public.my_notifications(integer), public.mark_notification_read(uuid),
  public.mark_all_notifications_read(), public.admin_send_notification(text, public.notification_type, text, uuid) to authenticated;

-- ───── Notifications automatiques
-- Nouveau contenu publié → alerte globale
create or replace function public.notify_new_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    insert into public.notifications (user_id, type, message, link)
    values (null, 'new_content',
            case when new.type = 'series' then 'Nouvelle série : ' else 'Nouveau film : ' end || new.title,
            '/title/' || new.slug);
  end if;
  return null;
end $$;
create trigger titles_notify_new_content after insert or update of is_published on public.titles
  for each row execute function public.notify_new_content();

-- Abonnement crédité / modifié → notification personnelle
create or replace function public.notify_subscription_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, message, link)
  values (new.user_id, 'subscription',
    case
      when new.source = 'code' then format('Code activé : +%s jours d''abonnement.', new.delta_days)
      when new.source = 'admin_adjust' and new.delta_days > 0 then format('Un administrateur a ajouté %s jours à ton abonnement.', new.delta_days)
      when new.source = 'admin_adjust' then format('Ton abonnement a été réduit de %s jours.', abs(new.delta_days))
      when new.status = 'suspended' then 'Ton abonnement a été suspendu.'
      when new.status = 'canceled' then 'Ton abonnement a été annulé.'
      else format('Ton abonnement est actif jusqu''au %s.', to_char(new.new_ends_at at time zone 'Europe/Paris', 'DD/MM/YYYY'))
    end,
    '/profile#subscription');
  return null;
end $$;
create trigger subscription_events_notify after insert on public.subscription_events
  for each row execute function public.notify_subscription_event();

-- ───── Supabase Realtime
alter publication supabase_realtime add table public.notifications;
