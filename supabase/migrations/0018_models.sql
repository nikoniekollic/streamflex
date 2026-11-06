-- Modèles : une image de profil partagée par plusieurs titres (jaquettes).
-- L'image du modèle est copiée dans titles.poster_url avec le marqueur « #model » :
-- toutes les requêtes du catalogue (qui lisent déjà poster_url) la reçoivent sans changement.
create table public.models (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  image_url text check (image_url is null or image_url ~ '^https://'),
  created_at timestamptz not null default now()
);
alter table public.titles add column model_id uuid references public.models (id) on delete set null;
create index titles_model_idx on public.titles (model_id) where model_id is not null;

alter table public.models enable row level security;
create policy models_read on public.models for select to authenticated using (true);
create policy models_admin on public.models for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Bucket public en lecture, écriture admin
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('model-images', 'model-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy model_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'model-images' and (select public.is_admin()));
create policy model_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'model-images' and (select public.is_admin()));
create policy model_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'model-images' and (select public.is_admin()));

-- Image du modèle modifiée → toutes les jaquettes rattachées suivent
create or replace function public.sync_model_cover() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.image_url is distinct from old.image_url then
    update public.titles set poster_url = new.image_url || '#model' where model_id = new.id;
  end if;
  return new;
end $$;
create trigger models_sync_cover after update of image_url on public.models
  for each row execute function public.sync_model_cover();

create or replace function public.clear_model_cover() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.titles set poster_url = null where model_id = old.id and poster_url like '%#model';
  return old;
end $$;
create trigger models_clear_cover before delete on public.models
  for each row execute function public.clear_model_cover();

create or replace function public.admin_list_models()
returns table (id uuid, name text, image_url text, titles_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.id, m.name, m.image_url, count(t.id)
    from public.models m left join public.titles t on t.model_id = m.id
    group by m.id order by lower(m.name);
end $$;

-- Rattache des titres (liste d'ids) à un modèle ; p_model null = détache
create or replace function public.admin_attach_titles(p_model uuid, p_title_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_img text; n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if array_length(p_title_ids, 1) > 2000 then raise exception 'too_many' using errcode = '22023'; end if;
  if p_model is null then
    update public.titles set model_id = null,
      poster_url = case when poster_url like '%#model' then null else poster_url end
      where id = any (p_title_ids);
  else
    select image_url into v_img from public.models where id = p_model;
    if not found then raise exception 'unknown_model' using errcode = '22023'; end if;
    update public.titles set model_id = p_model,
      poster_url = case when v_img is not null then v_img || '#model' else
                     case when poster_url like '%#model' then null else poster_url end end
      where id = any (p_title_ids);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Rattache tous les titres dont le nom contient p_query (max 2000), sans écraser un autre modèle sauf p_override
create or replace function public.admin_attach_by_query(p_model uuid, p_query text, p_override boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_query is null or char_length(btrim(p_query)) < 2 then raise exception 'query_too_short' using errcode = '22023'; end if;
  select coalesce(array_agg(id), '{}') into ids from (
    select id from public.titles
    where title ilike '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%'
      and (p_override or model_id is null or model_id = p_model)
    limit 2000) s;
  return public.admin_attach_titles(p_model, ids);
end $$;

revoke all on function public.admin_list_models(), public.admin_attach_titles(uuid, uuid[]),
  public.admin_attach_by_query(uuid, text, boolean) from public, anon;
grant execute on function public.admin_list_models(), public.admin_attach_titles(uuid, uuid[]),
  public.admin_attach_by_query(uuid, text, boolean) to authenticated;
