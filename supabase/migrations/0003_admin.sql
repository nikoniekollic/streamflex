-- 0003_admin.sql — sauvegarde atomique d'un titre depuis le panel admin + published_at auto

create or replace function public.set_published_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;

create trigger titles_published_at before insert or update of is_published on public.titles
  for each row execute function public.set_published_at();

-- p_title   : {id?, type, slug, title, original_title, synopsis, release_year, runtime_minutes,
--              maturity_rating, poster_url, backdrop_url, logo_url, trailer_url, is_published}
-- p_genre_ids : remplace la liste des genres
-- p_sources : null = ne pas toucher ; sinon synchronise les sources du FILM
--             [{id?, provider, external_id, raw_url, quality, priority, is_active}]
create or replace function public.admin_save_title(
  p_title jsonb,
  p_genre_ids smallint[] default '{}',
  p_sources jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_title ->> 'id', '')::uuid;
  v_type public.title_type := (p_title ->> 'type')::public.title_type;
  v_keep uuid[];
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.titles (type, slug, title, original_title, synopsis, release_year, runtime_minutes,
                               maturity_rating, poster_url, backdrop_url, logo_url, trailer_url, is_published)
    values (v_type, p_title ->> 'slug', p_title ->> 'title', nullif(p_title ->> 'original_title', ''),
            nullif(p_title ->> 'synopsis', ''), nullif(p_title ->> 'release_year', '')::smallint,
            nullif(p_title ->> 'runtime_minutes', '')::smallint, nullif(p_title ->> 'maturity_rating', ''),
            nullif(p_title ->> 'poster_url', ''), nullif(p_title ->> 'backdrop_url', ''),
            nullif(p_title ->> 'logo_url', ''), nullif(p_title ->> 'trailer_url', ''),
            coalesce((p_title ->> 'is_published')::boolean, false))
    returning id into v_id;
  else
    update public.titles set
      type            = v_type,
      slug            = p_title ->> 'slug',
      title           = p_title ->> 'title',
      original_title  = nullif(p_title ->> 'original_title', ''),
      synopsis        = nullif(p_title ->> 'synopsis', ''),
      release_year    = nullif(p_title ->> 'release_year', '')::smallint,
      runtime_minutes = nullif(p_title ->> 'runtime_minutes', '')::smallint,
      maturity_rating = nullif(p_title ->> 'maturity_rating', ''),
      poster_url      = nullif(p_title ->> 'poster_url', ''),
      backdrop_url    = nullif(p_title ->> 'backdrop_url', ''),
      logo_url        = nullif(p_title ->> 'logo_url', ''),
      trailer_url     = nullif(p_title ->> 'trailer_url', ''),
      is_published    = coalesce((p_title ->> 'is_published')::boolean, false)
    where id = v_id;
    if not found then
      raise exception 'title % not found', v_id using errcode = 'P0002';
    end if;
  end if;

  delete from public.title_genres where title_id = v_id and genre_id <> all (coalesce(p_genre_ids, '{}'));
  insert into public.title_genres (title_id, genre_id)
  select v_id, g from unnest(coalesce(p_genre_ids, '{}')) g
  on conflict do nothing;

  if p_sources is not null and v_type = 'movie' then
    select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_keep
    from jsonb_array_elements(p_sources) s where nullif(s ->> 'id', '') is not null;

    delete from public.media_sources where title_id = v_id and id <> all (v_keep);

    update public.media_sources m set
      provider    = (s ->> 'provider')::public.video_provider,
      external_id = nullif(s ->> 'external_id', ''),
      raw_url     = nullif(s ->> 'raw_url', ''),
      quality     = (s ->> 'quality')::public.video_quality,
      priority    = coalesce(nullif(s ->> 'priority', '')::smallint, 100),
      is_active   = coalesce((s ->> 'is_active')::boolean, true)
    from jsonb_array_elements(p_sources) s
    where nullif(s ->> 'id', '') is not null and m.id = (s ->> 'id')::uuid and m.title_id = v_id;

    insert into public.media_sources (title_id, provider, external_id, raw_url, quality, priority, is_active)
    select v_id, (s ->> 'provider')::public.video_provider, nullif(s ->> 'external_id', ''), nullif(s ->> 'raw_url', ''),
           (s ->> 'quality')::public.video_quality, coalesce(nullif(s ->> 'priority', '')::smallint, 100),
           coalesce((s ->> 'is_active')::boolean, true)
    from jsonb_array_elements(p_sources) s
    where nullif(s ->> 'id', '') is null;
  end if;

  return v_id;
end $$;

revoke all on function public.admin_save_title(jsonb, smallint[], jsonb) from public, anon;
grant execute on function public.admin_save_title(jsonb, smallint[], jsonb) to authenticated;
