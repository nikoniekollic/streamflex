-- L'emoji d'un modèle peut aussi être un emoji animé (« a:1f4b0 ») ou une icône Iconify (« i:fluent-emoji-flat:money-bag ») :
-- la limite de 16 caractères est portée à 64.
alter table public.models drop constraint if exists models_emoji_check;
alter table public.models add constraint models_emoji_check check (emoji is null or char_length(emoji) between 1 and 64);
