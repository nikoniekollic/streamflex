-- Table des vidéos : ~75 000 lignes mortes par jour (synchros, durées, aperçus) et un seul nettoyage automatique en 24 h
-- (seuil par défaut : 20 % de 96 000 lignes). Entre deux, les lectures vérifiaient chaque ligne une à une : compter les
-- vidéos prenait 4 s au lieu de 0,05 s et les recherches dépassaient la limite de 8 s.
-- Nettoyage et statistiques déclenchés bien plus tôt (≈ 1 000 lignes modifiées), et 10 % de place laissée libre dans les
-- nouvelles pages pour que les mises à jour restent dans la même page.
alter table public.titles set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 500,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 2,
  fillfactor = 90
);
alter table public.media_sources set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05
);
