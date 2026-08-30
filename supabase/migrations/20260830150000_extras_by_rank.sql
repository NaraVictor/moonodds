-- ============================================================================
-- Extras become the tail of the board, not a second-rate pass over its leftovers
--
-- WHAT WAS WRONG
--
-- The extras add-on was sold by LEAGUE: $2 bought "up to five games" in each
-- league you ticked. Two things followed from that and both were bad. The
-- customer could not tell what they were buying, because how many games a
-- league carried depended on the day's card and on what the engine had already
-- published. And the basket was filled by a second engine pass running under a
-- LOWER floor, which meant the paid product was, by construction, the calls the
-- free board was not willing to make.
--
-- WHAT IT IS NOW
--
-- One floor decides what is publishable at all. Rank decides which side of the
-- paywall a publishable pick lands on: the strongest `dailyBoardSize` (15) are
-- the free board, and every other pick above the floor is an extra. An unlock
-- deals `extraPicksPerUnlock` (10) of them, drawn at random and shown
-- strongest first.
--
-- So an extra is a good call that placed sixteenth, not a call the engine
-- hedged on — and the sentence "$2 for 10 more of today's calls" is true on
-- every day of the week, which the per-league offer never was.
--
-- THE DRAW IS SERVER-SIDE AND IT HAS TO STAY THAT WAY
--
-- The buyer never names the fixtures. Checkout draws them, writes them onto
-- the payment, and activation copies that list onto the order — so the set is
-- fixed before money moves and cannot be widened afterwards by anything the
-- browser sends.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Config: one floor, plus the two numbers that shape the split.
-- --------------------------------------------------------------------------
update public.ai_engine_config
set confidence_thresholds =
  (confidence_thresholds - 'extraPicksFloor')
  || jsonb_build_object(
       'dailyBoardSize',
       coalesce(confidence_thresholds -> 'dailyBoardSize', to_jsonb(15)),
       'extraPicksPerUnlock',
       coalesce(confidence_thresholds -> 'extraPicksPerUnlock', to_jsonb(10))
     )
where confidence_thresholds is not null;

-- --------------------------------------------------------------------------
-- 2. The picker is gone. What replaces it is a count.
--
-- The UI needs one question answered before it renders anything: is there
-- anything to sell this caller today? It cannot work that out itself, because
-- `predictions` is default-deny and no query the browser makes can see one.
-- Without this the page offered an unlock on days the basket was empty, took
-- the $2, and handed over nothing.
-- --------------------------------------------------------------------------
drop function if exists public.get_extra_pick_leagues();

create or replace function public.get_extra_pick_offer()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with owned as (
    select unnest(o.fixture_ids) as fixture_id
    from public.extra_pick_orders o
    where o.user_id = (select auth.uid())
      and o.date_key = (select app.utc_today())
      and o.status = 'active'
  ),
  sellable as (
    select f.id
    from public.fixtures f
    join public.predictions p
      on p.fixture_id = f.id
     and p.tier = 'extra'
     and p.status = 'pending'
    where f.status = 'scheduled'
      and f.fixture_date >= now()
      and f.fixture_date < ((select app.utc_today()) + 1)::timestamptz
      and f.id not in (select fixture_id from owned)
  )
  select jsonb_build_object(
    'available', (select count(*) from sellable),
    'owned', (select count(*) from owned),
    -- So the page quotes the operator's number rather than a copy of it. A
    -- hardcoded 10 in the client would keep saying 10 the day someone sets it
    -- to 6, and the customer would be the one to find out.
    'unlockSize', coalesce(
      (select (c.confidence_thresholds ->> 'extraPicksPerUnlock')::int
       from public.ai_engine_config c
       where c.status = 'active'
       limit 1),
      10
    )
  );
$$;

comment on function public.get_extra_pick_offer() is
  'How many extra picks this caller could still buy today, and how many they already hold. Drives whether the unlock section renders at all.';

grant execute on function public.get_extra_pick_offer() to authenticated;

-- --------------------------------------------------------------------------
-- 3. Activation no longer records leagues, because leagues no longer sell.
--
-- The column stays and is written empty: dropping it would rewrite the history
-- of orders that genuinely were sold by league, and those rows are financial
-- records.
-- --------------------------------------------------------------------------
drop function if exists public.activate_extra_picks(uuid, text, uuid[], uuid[]);

create or replace function public.activate_extra_picks(
  p_user_id uuid,
  p_reference text,
  p_fixture_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  order_id uuid;
  key date;
begin
  select * into pay
  from public.payments
  where reference = p_reference and user_id = p_user_id and purpose = 'extra_picks';

  if not found then
    raise exception 'no matching payment for this account'
      using errcode = '42501';
  end if;

  -- Idempotent: the same reference must never produce two orders.
  select id into order_id from public.extra_pick_orders where payment_id = pay.id;
  if found then
    return order_id;
  end if;

  -- Charging for an empty list is the one outcome that must stay impossible.
  if coalesce(array_length(p_fixture_ids, 1), 0) = 0 then
    raise exception 'refusing to activate an order with no games'
      using errcode = '22023';
  end if;

  -- The day it was BOUGHT, not the day it settled.
  key := coalesce(
    (pay.metadata ->> 'dateKey')::date,
    (now() at time zone 'utc')::date
  );

  update public.payments
  set status = 'succeeded', settled_at = coalesce(settled_at, now())
  where id = pay.id;

  insert into public.extra_pick_orders (
    user_id, date_key, league_ids, fixture_ids, num_games,
    amount_usd, currency, payment_id, status
  )
  values (
    p_user_id, key, '{}'::uuid[], p_fixture_ids,
    coalesce(array_length(p_fixture_ids, 1), 0), pay.amount_usd, pay.currency,
    pay.id, 'active'
  )
  returning id into order_id;

  return order_id;
end;
$$;

revoke all on function public.activate_extra_picks(uuid, text, uuid[])
  from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. The 05:30 pass keeps its slot but changes job.
--
-- It used to publish under a lower floor. Now it reaches the fixtures the
-- 05:00 session cap could not, at the same floor as everything else, and the
-- run settles the day's split when it finishes. On a card small enough for one
-- session it finds nothing, which is the correct outcome and costs one query.
-- --------------------------------------------------------------------------
comment on column public.predictions.tier is
  'primary = the free board (the day''s strongest dailyBoardSize picks). extra = every other pick above the same floor, sold as the extras add-on. Set by rank at the end of each engine pass, never by hand except in the Office.';

-- --------------------------------------------------------------------------
-- 5. The double-tap guard has to key on the day now.
--
-- payments_one_pending_extra keyed on the sorted fixture ids, because the buyer
-- used to choose their own leagues and two different choices were two genuine
-- purchases. The draw is random now, so every tap produces a different key —
-- the index would never fire, and the second tap of a double-tap would open a
-- second Paystack transaction against a second pending row.
--
-- Still partial on `pending`, so a settled purchase does not hold the slot:
-- someone who buys ten and comes back for ten more is not blocked.
-- --------------------------------------------------------------------------
drop index if exists public.payments_one_pending_extra;

create unique index if not exists payments_one_pending_extra
  on public.payments (user_id, (metadata ->> 'checkoutKey'))
  where status = 'pending' and purpose = 'extra_picks';

-- ============================================================================
-- 6. THE PAYWALL HAD A HOLE IN IT
--
-- get_picks_by_status returns every prediction that matches the filter, gated
-- only by app.access_state()'s free-pick limit. A day-pass holder has full
-- access, so their limit covers everything — which means the moment extras
-- exist, that RPC hands the entire paid basket to every pass holder for free,
-- through the same board query the app already makes on load.
--
-- Nobody has lost money to this yet only because `tier` has not shipped: until
-- now every pick was primary and there was nothing extra to leak. Shipping the
-- split without this filter is what would open it.
--
-- So the public read carries the board and nothing else. The buyer's own games
-- come back through get_my_extra_picks, which checks their order.
-- ============================================================================
create or replace function public.get_picks_by_status(filter text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  total integer;
  visible jsonb;
begin
  if filter not in ('all', 'upcoming', 'live', 'settled') then
    raise exception 'unknown filter %', filter using errcode = '22023';
  end if;

  select * into st from app.access_state();

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where p.tier = 'primary' and case filter
    when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
    when 'live'     then p.status = 'pending' and f.status = 'live'
    when 'settled'  then p.status in ('won', 'lost')
    else true
  end;

  select coalesce(
           jsonb_agg(
             app.pick_json_gated(r.pred, r.rn is not null and r.rn <= st.pick_limit)
             order by r.confidence_score desc
           ),
           '[]'::jsonb
         )
    into visible
  from (
    select p as pred,
           p.confidence_score,
           case
             when p.status in ('won', 'lost') then null
             else row_number() over (
               partition by (p.status in ('won', 'lost'))
               order by p.confidence_score desc
             )
           end as rn
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.tier = 'primary' and case filter
      when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
      when 'live'     then p.status = 'pending' and f.status = 'live'
      when 'settled'  then p.status in ('won', 'lost')
      else true
    end
    order by p.confidence_score desc
    limit 200
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;

-- ============================================================================
-- 7. The Office needs what the public read must not return.
--
-- It was reading the board through get_picks_by_status — fine while that was
-- everything, useless now that it is the free tier only: an operator could not
-- see, let alone move, a pick that had landed in the basket.
--
-- Super-admin only, and it says so in SQL rather than trusting the page that
-- calls it. `tier` rides along so the board can label each row.
-- ============================================================================
create or replace function public.get_admin_predictions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app.is_super_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return coalesce(
    (select jsonb_agg(
       app.pick_json(p) || jsonb_build_object('tier', p.tier)
       order by p.confidence_score desc
     )
     from (
       select p.*
       from public.predictions p
       order by p.confidence_score desc
       limit 500
     ) p),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_admin_predictions() is
  'Every pick with its tier, for the Office. Super-admin only: this is the read that deliberately ignores the paywall.';

grant execute on function public.get_admin_predictions() to authenticated;
