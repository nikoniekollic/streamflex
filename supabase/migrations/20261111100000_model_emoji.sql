-- Emoji propre à chaque modèle (bouton rond « page du modèle » en bas des jaquettes) ; à défaut, celui du nom du modèle
-- (s'il en contient un) puis l'emoji par défaut de la page Apparence.
alter table public.models add column if not exists emoji text check (emoji is null or char_length(emoji) between 1 and 16);
