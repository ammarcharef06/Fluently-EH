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


-- Row-level security v1.
-- Every authenticated API transaction must set app.user_id using a verified session.
-- Production must use a non-superuser database role; table owners bypass RLS unless FORCE is enabled.
create or replace function fluently_current_user_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

alter table app_users enable row level security;
alter table app_users force row level security;
drop policy if exists app_users_self on app_users;
create policy app_users_self on app_users
  for all using (id = fluently_current_user_id())
  with check (id = fluently_current_user_id());

alter table external_identities enable row level security;
alter table external_identities force row level security;
drop policy if exists external_identities_self on external_identities;
create policy external_identities_self on external_identities
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table employee_memberships enable row level security;
alter table employee_memberships force row level security;
drop policy if exists employee_memberships_self_read on employee_memberships;
create policy employee_memberships_self_read on employee_memberships
  for select using (user_id = fluently_current_user_id());

alter table learning_profiles enable row level security;
alter table learning_profiles force row level security;
drop policy if exists learning_profiles_self on learning_profiles;
create policy learning_profiles_self on learning_profiles
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table user_sessions enable row level security;
alter table user_sessions force row level security;
drop policy if exists user_sessions_self on user_sessions;
create policy user_sessions_self on user_sessions
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table verification_tokens enable row level security;
alter table verification_tokens force row level security;
drop policy if exists verification_tokens_self on verification_tokens;
create policy verification_tokens_self on verification_tokens
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table learning_events enable row level security;
alter table learning_events force row level security;
drop policy if exists learning_events_self on learning_events;
create policy learning_events_self on learning_events
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table sync_operations enable row level security;
alter table sync_operations force row level security;
drop policy if exists sync_operations_self on sync_operations;
create policy sync_operations_self on sync_operations
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table review_states enable row level security;
alter table review_states force row level security;
drop policy if exists review_states_self on review_states;
create policy review_states_self on review_states
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table account_deletion_requests enable row level security;
alter table account_deletion_requests force row level security;
drop policy if exists account_deletion_requests_self on account_deletion_requests;
create policy account_deletion_requests_self on account_deletion_requests
  for all using (user_id = fluently_current_user_id())
  with check (user_id = fluently_current_user_id());

alter table content_items enable row level security;
alter table content_items force row level security;
drop policy if exists content_items_admin_read on content_items;
create policy content_items_admin_read on content_items
  for select using (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor', 'reviewer', 'publisher')
    )
  );
drop policy if exists content_items_editor_insert on content_items;
create policy content_items_editor_insert on content_items
  for insert with check (
    created_by = fluently_current_user_id()
    and exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor')
    )
  );
drop policy if exists content_items_admin_update on content_items;
create policy content_items_admin_update on content_items
  for update using (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor', 'reviewer', 'publisher')
    )
  ) with check (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor', 'reviewer', 'publisher')
    )
  );

alter table content_versions enable row level security;
alter table content_versions force row level security;
drop policy if exists content_versions_admin_read on content_versions;
create policy content_versions_admin_read on content_versions
  for select using (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor', 'reviewer', 'publisher')
    )
  );
drop policy if exists content_versions_editor_insert on content_versions;
create policy content_versions_editor_insert on content_versions
  for insert with check (
    created_by = fluently_current_user_id()
    and exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor')
    )
  );

alter table curriculum_releases enable row level security;
alter table curriculum_releases force row level security;
drop policy if exists curriculum_releases_publisher on curriculum_releases;
create policy curriculum_releases_publisher on curriculum_releases
  for all using (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'publisher')
    )
  ) with check (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'publisher')
    )
  );

alter table audit_events enable row level security;
alter table audit_events force row level security;
drop policy if exists audit_events_admin_read on audit_events;
create policy audit_events_admin_read on audit_events
  for select using (
    exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role = 'owner'
    )
  );
drop policy if exists audit_events_admin_insert on audit_events;
create policy audit_events_admin_insert on audit_events
  for insert with check (
    actor_user_id = fluently_current_user_id()
    and exists (
      select 1 from employee_memberships m
      where m.user_id = fluently_current_user_id()
        and m.revoked_at is null
        and m.role in ('owner', 'editor', 'reviewer', 'publisher')
    )
  );

-- Do not grant app_users/session/table bypass rights to the Worker role.
-- A separate migration/role grant must provision the application role after provider setup.
