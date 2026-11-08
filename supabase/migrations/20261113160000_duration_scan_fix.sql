-- Correctif : une vidéo de moins de 30 s donnait runtime_minutes = 0 (refusé par la contrainte > 0) : minimum 1 minute
-- Remontée d'une durée par le lecteur / les jaquettes (une seule fois par titre)
create or replace function public.report_title_duration(p_title uuid, p_seconds numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('sf.keep_updated', '1', true);
  update public.titles
     set duration_s = round(p_seconds)::int,
         runtime_minutes = coalesce(runtime_minutes, greatest(1, least(round(p_seconds / 60.0), 1440))::smallint)
   where id = p_title and duration_s is null and p_seconds between 5 and 86400;
end $$;
revoke all on function public.report_title_duration(uuid, numeric) from public, anon;
grant execute on function public.report_title_duration(uuid, numeric) to authenticated;

-- Lecture admin : plusieurs durées d'un coup, [{id, s}] — uniquement les titres qui n'en ont pas encore
create or replace function public.admin_set_durations(p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform set_config('sf.keep_updated', '1', true);
  with src as (select (x->>'id')::uuid as id, round((x->>'s')::numeric)::int as s from jsonb_array_elements(p_items) x)
  update public.titles t
     set duration_s = s.s,
         runtime_minutes = coalesce(t.runtime_minutes, greatest(1, least(round(s.s / 60.0), 1440))::smallint)
    from src s
   where t.id = s.id and t.duration_s is null and s.s between 1 and 86400;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_set_durations(jsonb) from public, anon;
grant execute on function public.admin_set_durations(jsonb) to authenticated;

