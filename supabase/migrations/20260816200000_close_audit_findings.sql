-- ============================================================================
-- Remaining audit findings that live in the database
--
--   P-05  corners can be selected and can never be graded
--   P-06  the dispute path exists everywhere except the product
--   G-06  the review queue has no SLA and nothing escalates
--   F-05  no receipt after a purchase
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P-05: refuse new corners predictions
--
-- We do not fetch corner counts, so gradePrediction can only ever return
-- review_needed for one. The enum value stays because historical rows carry it
-- and dropping a member would orphan them; this stops new ones being written.
--
-- NOT VALID: the constraint applies to everything from here on without forcing
-- a full-table scan, and without failing the migration if a legacy row exists.
-- ---------------------------------------------------------------------------
alter table predictions
  add constraint predictions_gradeable_market
  check (prediction_type <> 'corners_over_under') not valid;

comment on constraint predictions_gradeable_market on predictions is
  'Corners cannot be settled: no corner counts are fetched. Drop this once they are.';

-- ---------------------------------------------------------------------------
-- P-06: let someone actually dispute a result
--
-- prediction_status has carried 'disputed' since the first migration and the
-- Contact page invites people to write in about a disputed result, but nothing
-- ever set it and no queue surfaced it. Grading errors are the most common
-- trust failure in this category and the Terms commit to correcting them.
-- ---------------------------------------------------------------------------
create table if not exists prediction_disputes (
  id             uuid primary key default gen_random_uuid(),
  prediction_id  uuid not null references predictions (id) on delete cascade,
  user_id        uuid not null references profiles (id) on delete cascade,
  reason         text not null check (length(trim(reason)) between 10 and 2000),
  status         text not null default 'open'
                   check (status in ('open', 'upheld', 'rejected')),
  resolution     text,
  resolved_by    text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),

  -- One open dispute per person per pick. Without this, a frustrated customer
  -- files the same complaint five times and the queue stops being readable.
  unique (prediction_id, user_id)
);

create index if not exists prediction_disputes_status_idx
  on prediction_disputes (status, created_at);

alter table prediction_disputes enable row level security;

create policy disputes_own_read on prediction_disputes
  for select to authenticated
  using (user_id = (select auth.uid()));

/**
 * Raise a dispute against a settled pick you actually followed.
 *
 * Restricted to picks on one of the caller's own slips: a dispute queue open to
 * anyone about anything is a spam surface, and the people with standing to
 * challenge a result are the ones who backed it.
 */
create or replace function public.raise_dispute(
  p_prediction_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  followed boolean;
  pred_status public.prediction_status;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select status into pred_status from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'no such prediction' using errcode = '22023';
  end if;
  if pred_status not in ('won', 'lost', 'void') then
    raise exception 'that prediction has not settled yet' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.slip_legs l
    join public.slips s on s.id = l.slip_id
    where s.user_id = uid and l.prediction_id = p_prediction_id
  ) into followed;

  if not followed then
    raise exception 'you can only dispute a pick you backed' using errcode = '42501';
  end if;

  insert into public.prediction_disputes (prediction_id, user_id, reason)
  values (p_prediction_id, uid, p_reason)
  on conflict (prediction_id, user_id) do nothing;

  -- Flagging the prediction is what puts it in front of an operator. The
  -- outcome is NOT changed here: a dispute is a request to look again, not a
  -- way for a customer to rewrite their own result.
  update public.predictions
  set status = 'disputed'
  where id = p_prediction_id and status in ('won', 'lost', 'void');

  return jsonb_build_object('raised', true);
end;
$$;

grant execute on function public.raise_dispute(uuid, text) to authenticated;
grant select on prediction_disputes to authenticated;

-- ---------------------------------------------------------------------------
-- G-06: what is stuck, and for how long
--
-- review_needed picks surfaced in the Office and nothing escalated one that had
-- sat for a week. An unsettled pick is an unsettled slip for everyone who
-- followed it.
-- ---------------------------------------------------------------------------
create or replace function public.get_stuck_queue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reviewNeeded', coalesce((
      select jsonb_agg(row_to_json(t) order by t.age_hours desc)
      from (
        select p.id,
               p.prediction_type::text as market,
               p.predicted_value       as "predictedValue",
               round(extract(epoch from (now() - f.fixture_date)) / 3600)::int as age_hours,
               (select count(*) from public.slip_legs l where l.prediction_id = p.id) as "slipsAffected"
        from public.predictions p
        join public.fixtures f on f.id = p.fixture_id
        where p.status = 'review_needed'
        order by f.fixture_date
        limit 100
      ) t
    ), '[]'::jsonb),
    'openDisputes', coalesce((
      select jsonb_agg(row_to_json(d) order by d.created_at)
      from (
        select id, prediction_id as "predictionId", reason, created_at
        from public.prediction_disputes
        where status = 'open'
        order by created_at
        limit 100
      ) d
    ), '[]'::jsonb),
    -- The number that matters: anything past this is a customer waiting.
    'breaching', (
      select count(*)
      from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      where p.status in ('review_needed', 'disputed')
        and f.fixture_date < now() - interval '48 hours'
    )
  )
  where (select app.is_super_admin());
$$;

grant execute on function public.get_stuck_queue() to authenticated;
