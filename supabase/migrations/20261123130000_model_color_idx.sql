-- Couleur du nom de chaque modèle : un numéro unique et définitif par modèle (jamais deux modèles de la même couleur,
-- même après en avoir supprimé). Le site en tire une teinte parmi des dizaines de milliers de variantes (angle d'or,
-- clarté et saturation alternées). Bruno_Dickemz garde le n° 0 = son violet actuel ; les modèles futurs reçoivent le suivant.
alter table public.models add column if not exists color_idx integer;
create sequence if not exists public.models_color_idx_seq minvalue 0 start 0;

update public.models set color_idx = 0 where lower(name) = 'bruno_dickemz';
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.models where color_idx is null
)
update public.models m set color_idx = o.rn from ordered o where o.id = m.id;

select setval('public.models_color_idx_seq', coalesce((select max(color_idx) from public.models), 0) + 1, false);
alter table public.models alter column color_idx set default nextval('public.models_color_idx_seq');
alter sequence public.models_color_idx_seq owned by public.models.color_idx;
alter table public.models alter column color_idx set not null;
create unique index if not exists models_color_idx_key on public.models (color_idx);
grant usage, select on sequence public.models_color_idx_seq to authenticated, service_role;
