-- Fluently PostgreSQL schema v1.
-- Apply with a reviewed migration runner. No credentials belong in this repository.

create extension if not exists pgcrypto;

do $$ begin
  create type account_status as enum ('active', 'deletion_requested', 'deleted', 'suspended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type content_status as enum ('draft', 'in_review', 'approved', 'changes_requested', 'published', 'retired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type employee_role as enum ('owner', 'editor', 'reviewer', 'publisher');
exception when duplicate_object then null; end $$;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_verified_at timestamptz,
  display_name text,
  password_hash text,
  status account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint email_normalized check (email is null or email = lower(trim(email))),
  constraint password_hash_argon2id check (password_hash is null or password_hash like '$argon2id$%')
);

create table if not exists external_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  created_at timestamptz not null default now(),
  unique(provider, provider_subject)
);

create table if not exists employee_memberships (
  user_id uuid not null references app_users(id) on delete cascade,
  role employee_role not null,
  granted_by uuid references app_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, role)
);

create table if not exists learning_profiles (
  user_id uuid primary key references app_users(id) on delete cascade,
  nickname text,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  active_track text not null default 'comprehensive',
  daily_goal_minutes integer not null default 10 check (daily_goal_minutes between 5 and 180),
  sync_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_items (
  id text primary key,
  title text not null,
  stage text not null,
  status content_status not null default 'draft',
  content_version text not null,
  source_metadata jsonb not null,
  content_json jsonb not null,
  review_note text,
  reviewed_by uuid references app_users(id),
  reviewed_at timestamptz,
  published_by uuid references app_users(id),
  published_at timestamptz,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or (reviewed_by is not null and reviewed_at is not null and published_by is not null and published_at is not null))
);
create index if not exists content_items_status_updated on content_items(status, updated_at desc);

create table if not exists content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id text not null references content_items(id),
  content_version text not null,
  snapshot jsonb not null,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique(content_id, content_version)
);

create table if not exists curriculum_releases (
  id uuid primary key default gen_random_uuid(),
  package_id text not null,
  content_version text not null,
  schema_version integer not null,
  manifest jsonb not null,
  package_sha256 text not null check (package_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('staged', 'published', 'retired')),
  published_by uuid references app_users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(package_id, content_version),
  check (status <> 'published' or (published_by is not null and published_at is not null))
);

create table if not exists learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  event_type text not null,
  entity_id text not null,
  content_version text not null,
  payload jsonb not null,
  occurred_at_client timestamptz not null,
  received_at_server timestamptz not null default now()
);
create index if not exists learning_events_user_received on learning_events(user_id, received_at_server desc);

create table if not exists sync_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  operation_id uuid not null,
  entity_id text not null,
  entity_type text not null,
  schema_version integer not null,
  occurred_at_local timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique(user_id, operation_id)
);

create table if not exists review_states (
  user_id uuid not null references app_users(id) on delete cascade,
  item_id text not null,
  state jsonb not null,
  algorithm_version text not null,
  due_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references app_users(id),
  action text not null,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists audit_events_time on audit_events(occurred_at desc);

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'blocked')),
  notes text
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists user_sessions_active on user_sessions(user_id, expires_at) where revoked_at is null;

create table if not exists verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null check (purpose in ('email_verification', 'password_reset')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS policies must be added alongside the deployment role strategy before production traffic.
-- Keep all API queries user-scoped; the current development API does not connect without Hyperdrive.
