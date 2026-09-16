-- The Status field's options were renamed to match the Slack List's own labels exactly
-- (Bugs, Released to prod, Work in progress, ... instead of Backlog/Todo/In progress/Done/...).
-- issues_sync_state_and_status()'s reverse path (state changed via the app's Close/Reopen
-- buttons, not by picking a Status option) matched options by hardcoded name ('done', 'todo'),
-- which no longer exist. Rebuilt to key off field_options.closes_as instead: closing picks the
-- option whose closes_as matches the close reason, reopening picks the lowest-sort_order option
-- that doesn't close the issue at all. This makes the trigger survive any future Status rename.
create or replace function issues_sync_state_and_status()
returns trigger language plpgsql as $$
declare
  status_field_id uuid;
  old_status_option_id uuid;
  new_status_option_id uuid;
  closes text;
  target_option_id uuid;
begin
  select id into status_field_id from field_defs where name = 'Status';
  if status_field_id is null then
    return new;
  end if;

  old_status_option_id := (old.fields -> status_field_id::text ->> 'optionId')::uuid;
  new_status_option_id := (new.fields -> status_field_id::text ->> 'optionId')::uuid;

  if new_status_option_id is distinct from old_status_option_id and new_status_option_id is not null then
    select closes_as into closes from field_options where id = new_status_option_id;
    if closes is not null then
      new.state := 'CLOSED';
      new.state_reason := closes;
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.state := 'OPEN';
      new.state_reason := null;
      new.closed_at := null;
    end if;
  elsif new.state is distinct from old.state or new.state_reason is distinct from old.state_reason then
    if new.state = 'CLOSED' then
      select fo.id into target_option_id from field_options fo
        where fo.field_def_id = status_field_id
          and fo.closes_as = (case when new.state_reason = 'DUPLICATE' then 'NOT_PLANNED' else new.state_reason end)
        order by fo.sort_order limit 1;
    else
      select fo.id into target_option_id from field_options fo
        where fo.field_def_id = status_field_id and fo.closes_as is null
        order by fo.sort_order limit 1;
    end if;
    if target_option_id is not null then
      new.fields := jsonb_set(new.fields, array[status_field_id::text], jsonb_build_object('optionId', target_option_id));
    end if;
  end if;

  return new;
end;
$$;
