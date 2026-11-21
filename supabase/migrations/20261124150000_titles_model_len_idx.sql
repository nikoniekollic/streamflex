-- Page d'un modèle : la liste des vidéos sans durée réelle (triée par durée estimée) parcourait l'index des durées de tout le
-- catalogue en écartant 33 000 lignes — 8 s pour dreddxxx (6 051 vidéos), au-delà de la limite. Index modèle + durée : 21 ms.
-- Sert aussi aux tris « plus longues / plus courtes » d'une page de modèle.
create index if not exists titles_model_len_idx on public.titles (model_id, len_key desc nulls last, id) where is_published;
