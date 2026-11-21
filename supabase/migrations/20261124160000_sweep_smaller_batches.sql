-- Synchro de fond : un lot de 247 vidéos à masquer dépassait la limite de 8 s à chaque passage (04:26 → 04:45 le 21/11),
-- occupant la base au point de faire échouer des pages ouvertes au même moment. Lots de 100 : le reste au passage suivant.
do $mig$
declare
  def text := pg_get_functiondef('public.sync_onefichier_sweep'::regproc);
begin
  if position('limit 100' in def) > 0 then return; end if;
  if position(E'     limit 500\n' in def) = 0 or position('v_removed >= 500' in def) = 0 then
    raise exception 'sync_onefichier_sweep : taille de lot introuvable';
  end if;
  def := replace(def, E'     limit 500\n', E'     limit 100\n');
  def := replace(def, 'v_removed >= 500', 'v_removed >= 100');
  def := replace(def, 'retrait par lots de 500', 'retrait par lots de 100');
  execute def;
end
$mig$;
