-- Notifications « nouveauté » regroupées
-- Avant : une notification globale PAR vidéo publiée. Les imports 1fichier en publient des milliers (jusqu'à 3 000 / heure) :
-- autant de bulles en bas à droite, qui figeaient le site. Maintenant, sur une heure glissante :
--  • 1re vidéo publiée → « Nouveau film : <titre> » (une seule bulle, comme avant) ;
--  • les suivantes mettent à jour CETTE notification : « 245 nouvelles vidéos » → lien vers le catalogue trié par nouveautés.
--    Une mise à jour n'affiche pas de nouvelle bulle (le temps réel n'annonce que les insertions) et la notification
--    redevient « non lue ».
-- Les ~53 000 notifications « Nouveau film » existantes sont fusionnées en une notification par jour.

alter table public.notifications add column if not exists group_count integer not null default 1;
create index if not exists notifications_global_type_idx on public.notifications (type, created_at desc) where user_id is null;

create or replace function public.notify_new_content()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_id uuid; v_n int;
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    perform pg_advisory_xact_lock(hashtext('notify_new_content'));
    select n.id, n.group_count into v_id, v_n from public.notifications n
     where n.user_id is null and n.type = 'new_content' and n.created_at > now() - interval '1 hour'
     order by n.created_at desc limit 1;
    if v_id is null then
      insert into public.notifications (user_id, type, message, link)
      values (null, 'new_content', case when new.type = 'series' then 'Nouvelle série : ' else 'Nouveau film : ' end || new.title, '/title/' || new.slug);
    else
      update public.notifications
         set group_count = v_n + 1,
             message = (v_n + 1) || ' nouvelles vidéos ajoutées au catalogue',
             link = '/browse?sort=recent'
       where id = v_id;
      delete from public.notification_reads where notification_id = v_id; -- de nouveau « non lue »
    end if;
  end if;
  return null;
end $function$;

-- Fusion de l'existant : une notification par jour (la plus récente du jour garde son identifiant)
with days as (
  select date_trunc('day', created_at) d, count(*) n, (array_agg(id order by created_at desc))[1] keep_id, max(created_at) last_at,
         (array_agg(message order by created_at desc))[1] msg, (array_agg(link order by created_at desc))[1] lnk
    from public.notifications where user_id is null and type = 'new_content' group by 1
), upd as (
  update public.notifications n
     set group_count = d.n,
         message = case when d.n > 1 then d.n || ' nouvelles vidéos ajoutées au catalogue' else d.msg end,
         link = case when d.n > 1 then '/browse?sort=recent' else d.lnk end
    from days d where n.id = d.keep_id
  returning n.id
)
delete from public.notifications n
 where n.user_id is null and n.type = 'new_content' and n.id not in (select keep_id from days);
