-- Renmi account/authentication schema.
-- The API uses the Supabase service-role key; no browser or Electron client
-- should ever receive that key.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_normalized text not null,
  email_ciphertext text not null,
  email_hash text not null unique,
  password_hash text not null,
  password_reset_required boolean not null default false,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'deleted')),
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  suspended_until timestamptz,
  suspension_reason text,
  deleted_at timestamptz,
  profile_state jsonb not null default '{}'::jsonb,
  profile_updated_at timestamptz not null default now()
);

create index if not exists users_status_created_idx on public.users(status, created_at desc);

create table if not exists public.auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  email_hash text not null,
  purpose text not null check (purpose in ('register', 'login', 'admin_login', 'reset_password', 'change_email')),
  code_digest text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_challenges_lookup_idx
  on public.auth_challenges(email_hash, purpose, created_at desc);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  refresh_token_hash text not null unique,
  device_name text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists sessions_user_idx on public.sessions(user_id, revoked_at, expires_at);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users(id),
  action text not null,
  target_user_id uuid references public.users(id),
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

-- The public API never talks to these tables directly. Keep anonymous and
-- browser-authenticated access closed; only the backend service role may use
-- the data plane.
alter table public.users enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.sessions enable row level security;
alter table public.audit_logs enable row level security;

-- Safe to run when upgrading a database created by an earlier draft.
alter table public.users add column if not exists password_reset_required boolean not null default false;

-- Account-scoped Renmiao state. These columns are intentionally on the user
-- row so authentication and profile updates share the same durable account,
-- while the API still exposes profile data only after authentication.
alter table public.users add column if not exists profile_state jsonb not null default '{}'::jsonb;
alter table public.users add column if not exists profile_updated_at timestamptz not null default now();

-- An existing database may have been created before this column was added;
-- the statement above is deliberately idempotent for that upgrade path.

-- Usernames are display labels and may repeat. Email hashes remain unique
-- above and are the account identity. Drop the unique constraint created by
-- the first schema version; this is safe to run repeatedly.
alter table public.users drop constraint if exists users_username_normalized_key;
