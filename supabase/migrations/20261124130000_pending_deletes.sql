-- Suppression pendant une pause de l'API 1fichier : la vidéo part du site tout de suite, l'effacement du fichier chez 1fichier
-- attend ici (repris automatiquement par la surveillance dès la fin de la pause). Entre-temps, ces fichiers ne sont pas
-- réimportés par la synchro.
create table if not exists public.onefichier_pending_rm (
  file_id text primary key,
  created_at timestamptz not null default now(),
  tries int not null default 0,
  last_error text
);
alter table public.onefichier_pending_rm enable row level security;
revoke all on public.onefichier_pending_rm from anon, authenticated;

-- synchro : fichiers en attente d'effacement ignorés (marqueur pending_rm)
do $mig$
declare
  def text := pg_get_functiondef('public.sync_onefichier_folder'::regproc);
  old_w text := E'   where f->>''id'' ~ ''^[A-Za-z0-9]{4,32}$'';\n';
  new_w text := E'   where f->>''id'' ~ ''^[A-Za-z0-9]{4,32}$''\n     and not exists (select 1 from public.onefichier_pending_rm p where p.file_id = f->>''id''); -- pending_rm\n';
begin
  if position('pending_rm' in def) > 0 then return; end if;
  if position(old_w in def) = 0 then raise exception 'sync_onefichier_folder : filtre des identifiants introuvable'; end if;
  execute replace(def, old_w, new_w);
end
$mig$;

-- Pause de 24 h déclenchée le 21/11 à 04:02 par un refus propre à UN fichier (« 403 Resource not allowed #350 » en le
-- supprimant), pas par un blocage du compte : levée (ce refus ne déclenche plus la pause).
update public.api_governor set paused_until = null, pause_reason = null
 where name = 'onefichier' and pause_reason like '%#350%';
