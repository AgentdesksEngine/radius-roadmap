-- Security hardening found by the Supabase linter before the app's first real deploy.
--
-- 1. activity_feed was SECURITY DEFINER (view creator's privileges, i.e. postgres, not the
--    querying role) with default anon/authenticated grants from being created in the public
--    schema. Combined, any anon-key holder (the anon key is public in the frontend bundle by
--    design) could read every comment and activity event for every issue via PostgREST,
--    bypassing the fact that comments/activity_events have RLS enabled with zero policies.
--    The API backend queries this view over a direct Postgres connection (DATABASE_URL,
--    api/_lib/db/pool.ts) as the `postgres` role, which already bypasses RLS regardless of
--    the view's security mode -- so switching to security_invoker changes nothing for the
--    app and closes the hole for every other role.
alter view public.activity_feed set (security_invoker = true);
revoke all on public.activity_feed from anon, authenticated;

-- 2. handle_new_user() is a trigger function (operates on NEW, not callable outside a
--    trigger context) but Postgres grants EXECUTE to PUBLIC by default on function
--    creation, so it showed up as anon/authenticated-executable via
--    /rest/v1/rpc/handle_new_user. Revoke the grant it never needed.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3. Mutable search_path on SECURITY DEFINER / trigger functions is a defense-in-depth
--    fix (search_path hijacking), not an active exploit here, but cheap to close.
alter function public.current_profile_id() set search_path = public;
alter function public.issues_set_initial_position() set search_path = public;
alter function public.issues_sync_state_and_status() set search_path = public;
alter function public.issues_activity() set search_path = public;
alter function public.issue_labels_activity() set search_path = public;
alter function public.issue_assignees_activity() set search_path = public;
alter function public.comments_touch_issue() set search_path = public;
alter function public.prevent_parent_cycle() set search_path = public;
alter function public.recompute_sub_issue_counters(uuid) set search_path = public;
alter function public.sub_issue_counters() set search_path = public;
alter function public.move_item(uuid, uuid) set search_path = public;
