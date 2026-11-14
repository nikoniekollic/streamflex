-- Durées réelles lues par le navigateur des visiteurs, enregistrées par lots (jusqu'à 100) : [{id, s}].
-- Seulement pour les vidéos qui n'en ont pas encore (une durée connue n'est jamais remplacée), valeurs plausibles seulement.
-- len_key (tri / filtre par durée) suit automatiquement par le déclencheur titles_set_len_key.
create or replace function public.report_durations(p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or jsonb_typeof(p_items) <> 'array' then return 0; end if;
  perform set_config('sf.keep_updated', '1', true);
  with src as (
    select distinct on (id) id, s from (
      select (x->>'id')::uuid as id, round((x->>'s')::numeric)::int as s
        from (select x from jsonb_array_elements(p_items) x limit 100) e
       where (x->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and jsonb_typeof(x->'s') = 'number'
    ) v
  )
  update public.titles t
     set duration_s = s.s,
         runtime_minutes = coalesce(t.runtime_minutes, greatest(1, least(round(s.s / 60.0), 1440))::smallint)
    from src s
   where t.id = s.id and t.duration_s is null and s.s between 1 and 86400;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.report_durations(jsonb) from public, anon;
grant execute on function public.report_durations(jsonb) to authenticated;
