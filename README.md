# agentdouble (MVP)

Application de prise de notes minimaliste (noir & blanc) avec un bandeau gauche type Notion, login Supabase, stockage Supabase, et API Python.

## Stack

- Mobile/Web: Expo (React Native) (`mobile`)
- Backend: FastAPI (`backend`)
- DB + Auth: Supabase (Postgres + Supabase Auth)

## 1) Préparer Supabase

1. Crée un projet Supabase.
2. Dans *SQL editor*, exécute le SQL ci-dessous (table `notes` + RLS).
3. Dans *Auth → Providers*, active *Email* (et désactive les confirmations email en dev si besoin).
4. Récupère (⚠️ ne jamais utiliser une clé secrète côté navigateur/mobile):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (clé publishable/anon, souvent `sb_publishable_...`)
   - `SUPABASE_SERVICE_ROLE_KEY` (clé secrète/service role, souvent `sb_secret_...`, backend uniquement)

```sql
create extension if not exists "pgcrypto";

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_id_updated_at_idx
  on public.notes (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_notes_updated_at on public.notes;
create trigger set_notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

drop policy if exists notes_select_own on public.notes;
create policy notes_select_own
  on public.notes for select
  using (auth.uid() = user_id);

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own
  on public.notes for insert
  with check (auth.uid() = user_id);

drop policy if exists notes_update_own on public.notes;
create policy notes_update_own
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own
  on public.notes for delete
  using (auth.uid() = user_id);
```

Si tu vois `Forbidden use of secret API key in browser`, c’est presque toujours que tu as mis une clé `sb_secret_...` côté client (ou que `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` sont inversées dans `backend/.env`).

## Dépannage

- Erreur `Could not find the table 'public.notes' in the schema cache` (PGRST205) sur `/notes`: exécute le SQL ci-dessus dans Supabase (SQL editor), puis relance le backend.

## 2) Lancer le backend (FastAPI)

```bash
cd backend
cp .env.example .env
# renseigner SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY
# + OPENAI_API_KEY si tu veux activer /generate
uv sync
uv run uvicorn app.main:app --reload --port 8000 --env-file .env
```

Healthcheck: `http://localhost:8000/health`

## 3) Lancer l’app (Expo)

```bash
cd mobile
cp .env.example .env
# renseigner EXPO_PUBLIC_API_URL
npm install
npm run web
```

## Démarrage (script)

```bash
./start.sh web
```

## Notes

- L’app se connecte à Supabase (email/mot de passe), récupère le `access_token`, puis appelle l’API FastAPI avec `Authorization: Bearer <token>`.
- Le backend valide le token via `/auth/v1/user` et lit/écrit dans `notes` via PostgREST (service role key).
- IA `/generate` : streaming SSE via `/ai/generate/stream` (aperçu progressif), insertion finale seulement si le contenu n'a pas changé ; le backend appelle OpenAI via `OPENAI_API_KEY` (optionnellement `OPENAI_MODEL`), le client ne voit jamais la clé.
- Pour tester rapidement: crée un compte via “Créer un compte” (aucun identifiant n’est versionné dans ce repo).
- `./start.sh` injecte `CORS_ALLOW_ORIGINS` côté backend à partir des ports (`PORT` backend + `EXPO_PACKAGER_PORT` frontend, défaut `8081`).
- `./start.sh` injecte aussi `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` au frontend à partir de `backend/.env` (évite la redondance dans `mobile/.env`).
- Mode jour/nuit: bouton `☀︎/☾` sur l’écran de login et dans la sidebar (préférence persistée).
- Mode mobile: le bandeau gauche est masquable (bouton `☰` pour ouvrir, tap sur le fond ou `×` pour fermer).
- Éditeur: placeholder "Nouvelle page" en gros, date retirée, statut de sauvegarde en bandeau en haut à droite, barre horizontale supprimée, marge latérale augmentée.
- Éditeur: taper `/` ouvre un menu de commandes (ex: `/generate`, todo, titre) proche du curseur; `Echap` ou un tap le ferme.
