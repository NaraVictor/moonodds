-- ============================================================================
-- "Not pending" is not the same as "settled"
--
-- queue_daily_results treated the day as finished when no pick was still
-- pending. prediction_status has six values, and two of them are neither
-- pending nor settled: review_needed, which the grader assigns when it cannot
-- parse a selection, and disputed, which a CUSTOMER assigns by challenging a
-- result.
--
-- A board carrying either would have been judged complete, and the results
-- email selects only won/lost/void — so the pick would have vanished from the
-- table without a word, and the win rate underneath would have described a
-- subset while presenting itself as the day. Dropping a disputed call quietly
-- from the published results is the precise opposite of what a dispute is for.
--
-- The day is finished when every pick has an outcome. Anything else holds the
-- email, which is the safe direction: a late email is a delay, and a wrong one
-- is a correction.
-- ============================================================================
create or replace function app.queue_daily_results(p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  total     integer;
  unsettled integer;
begin
  perform pg_advisory_xact_lock(hashtext('kicka_daily_results_' || p_date::text));

  if exists (
    select 1 from public.jobs
    where kind = 'daily_results_ready'
      and payload ->> 'dateKey' = p_date::text
  ) then
    return false;
  end if;

  select
    count(*),
    count(*) filter (where p.status not in ('won', 'lost', 'void'))
  into total, unsettled
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where p.tier = 'primary'
    and f.fixture_date >= p_date::timestamp at time zone 'utc'
    and f.fixture_date <  (p_date + 1)::timestamp at time zone 'utc';

  -- Nothing to report on, or something on the board has no outcome yet.
  if total = 0 or unsettled > 0 then
    return false;
  end if;

  insert into public.jobs (kind, payload)
  values ('daily_results_ready', jsonb_build_object('dateKey', p_date::text));

  return true;
end;
$$;
