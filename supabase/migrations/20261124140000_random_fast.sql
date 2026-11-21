-- Tirage au hasard : « order by random() » sur les 96 000 vidéos prenait 13,8 s (au-delà de la limite de 8 s) et occupait le
-- processeur de la base au point de faire échouer les autres pages ouvertes au même moment (recherche, modèles…).
-- Catalogue entier : 2 × N positions tirées au hasard dans l'index des identifiants (uuid aléatoires, répartis uniformément),
-- la vidéo publiée qui suit chaque position est retenue — quelques millisecondes. Un seul modèle (≤ 6 000 vidéos) : mélange direct.
create or replace function public.random_title_ids(p_limit integer default 30, p_model uuid default null::uuid, p_kids boolean default false, p_exclude uuid[] default '{}'::uuid[])
 returns setof uuid
 language plpgsql
 volatile
 set search_path to 'public'
as $function$
declare
  lim int := greatest(least(coalesce(p_limit, 30), 100), 1);
  excl uuid[] := coalesce(p_exclude, '{}');
  kids boolean := coalesce(p_kids, false);
begin
  if p_model is not null then
    return query
      select t.id from public.titles t
       where t.model_id = p_model and t.is_published and t.type = 'movie'
         and (not kids or public.is_kids_safe(t.maturity_rating, t.id))
         and not (t.id = any (excl))
       order by random()
       limit lim;
    return;
  end if;

  return query
    select x.id from (
      -- positions tirées d'avance (sinon le tirage n'est fait qu'une fois pour toute la requête)
      select distinct pick.id
        from unnest(array(select gen_random_uuid() from generate_series(1, lim * 2))) as r(u)
        cross join lateral (
          select t.id from public.titles t
           where t.id >= r.u and t.is_published and t.type = 'movie'
             and (not kids or public.is_kids_safe(t.maturity_rating, t.id))
             and not (t.id = any (excl))
           order by t.id
           limit 1
        ) pick
    ) x
    order by random()
    limit lim;
end $function$;

-- Estimation des durées (tâche quotidienne de 04:17) : ne réécrit plus que les vidéos dont l'estimation change de plus de 3 %
-- (auparavant, la moindre variation du débit moyen réécrivait des dizaines de milliers de lignes et leurs 18 index chaque nuit).
create or replace function public.refresh_len_estimates()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g double precision := public.global_bitrate(); n int;
begin
  delete from public.model_bitrates;
  insert into public.model_bitrates (model_id, bps, samples)
  select model_id, percentile_cont(0.5) within group (order by size_bytes::double precision / duration_s), count(*)
    from public.titles
   where model_id is not null and duration_s > 30 and size_bytes > 0
   group by model_id
  having count(*) >= 3;

  perform set_config('sf.keep_updated', '1', true);
  update public.titles t
     set len_key = t.size_bytes / (coalesce(mb.bps, g) * 60.0)
    from public.titles t2
    left join public.model_bitrates mb on mb.model_id = t2.model_id
   where t2.id = t.id and t.duration_s is null and t.runtime_minutes is null and t.size_bytes > 0
     and (t.len_key is null
          or abs(t.len_key - t.size_bytes / (coalesce(mb.bps, g) * 60.0)) > 0.03 * (t.size_bytes / (coalesce(mb.bps, g) * 60.0)));
  get diagnostics n = row_count;
  return n;
end $function$;
