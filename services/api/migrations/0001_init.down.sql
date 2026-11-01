-- Manual rollback for schema v1. Review data retention before applying.
drop table if exists verification_tokens;
drop table if exists user_sessions;
drop table if exists account_deletion_requests;
drop table if exists audit_events;
drop table if exists review_states;
drop table if exists sync_operations;
drop table if exists learning_events;
drop table if exists curriculum_releases;
drop table if exists content_versions;
drop table if exists content_items;
drop table if exists learning_profiles;
drop table if exists employee_memberships;
drop table if exists external_identities;
drop table if exists app_users;
drop type if exists employee_role;
drop type if exists content_status;
drop type if exists account_status;

drop function if exists fluently_current_user_id();
