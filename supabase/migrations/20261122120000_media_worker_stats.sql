-- Avancement du travailleur : trois comptages complets du catalogue (~3 s chacun, disque lent) dépassaient la limite de 8 s.
-- Un seul passage, et l'espace occupé par les images à part (rapide : seul lui conditionne la distribution du travail).
create or replace function public.media_worker_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('no_duration', count(*) filter (where duration_s is null),
                            'no_still', count(*) filter (where poster_url is null or poster_url like '%#model'))
    from public.titles
   where is_published and type = 'movie' and (duration_s is null or poster_url is null or poster_url like '%#model')
$$;

create or replace function public.media_worker_storage_mb()
returns integer language sql stable security definer set search_path = public as $$
  select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1e6)::int from storage.objects where bucket_id = 'stills'
$$;
revoke all on function public.media_worker_storage_mb() from public, anon, authenticated;
grant execute on function public.media_worker_storage_mb() to service_role;
