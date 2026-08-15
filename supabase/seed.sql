-- ============================================================================
-- MoonOdds — dummy data seed
--
-- Invented content, real structure. Everything the UI needs to show every
-- state: won and lost picks for the track record, live fixtures, upcoming
-- fixtures across all twelve markets, a full engine config, a pending tuning
-- report, and one demo account per access tier.
--
-- No live API data is involved — API-Football, Anthropic and Paystack are all
-- mocked at the provider layer.
--
-- Deterministic: setseed() below fixes the random stream so a db reset always
-- reproduces the same data.
-- ============================================================================

select setseed(0.4242);

-- ---------------------------------------------------------------------------
-- Demo accounts, one per access tier
--
-- Password for all of them: moonodds
-- ---------------------------------------------------------------------------

-- NOTE: the *_token columns must be '' and not NULL. GoTrue scans them into Go
-- strings, and a NULL there fails every sign-in with the distinctly unhelpful
-- "Database error querying schema".
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, phone_change, phone_change_token,
  reauthentication_token
)
values
  -- Pass holder: bought today's pass, sees everything.
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'pass@moonodds.test',
   crypt('moonodds', gen_salt('bf')), now(), now() - interval '40 days', now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Priya (pass holder)"}', false, false, '', '', '', '', '', '', '', ''),

  -- Brand new: created today, so the two free picks apply.
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'new@moonodds.test',
   crypt('moonodds', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Kofi (first day)"}', false, false, '', '', '', '', '', '', '', ''),

  -- Returning, no pass: past the free day, sees nothing until they pay.
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'locked@moonodds.test',
   crypt('moonodds', gen_salt('bf')), now(), now() - interval '12 days', now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Sam (locked out)"}', false, false, '', '', '', '', '', '', '', ''),

  -- Suspended: blocked even though a valid pass exists.
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'suspended@moonodds.test',
   crypt('moonodds', gen_salt('bf')), now(), now() - interval '60 days', now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Dee (suspended)"}', false, false, '', '', '', '', '', '', '', ''),

  -- Super-admin: the Office panel.
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'admin@moonodds.test',
   crypt('moonodds', gen_salt('bf')), now(), now() - interval '90 days', now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Nara (admin)"}', false, false, '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

-- Identities, so email sign-in resolves.
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', u.id::text, now(), now(), now()
from auth.users u
where u.email like '%@moonodds.test'
on conflict do nothing;

-- The on_auth_user_created trigger has already made the profiles; set the flags.
update public.profiles set is_super_admin = true
  where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set is_suspended = true
  where id = '44444444-4444-4444-8444-444444444444';
update public.profiles set phone = '+233201234567'
  where id = '11111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- Leagues and teams
-- ---------------------------------------------------------------------------

insert into leagues (id, name, slug, country, external_id, season, is_active) values
  ('a0000001-0000-4000-8000-000000000001', 'Premier League',  'premier-league',  'England', 39,  2026, true),
  ('a0000001-0000-4000-8000-000000000002', 'La Liga',         'la-liga',         'Spain',   140, 2026, true),
  ('a0000001-0000-4000-8000-000000000003', 'Serie A',         'serie-a',         'Italy',   135, 2026, true),
  ('a0000001-0000-4000-8000-000000000004', 'Bundesliga',      'bundesliga',      'Germany', 78,  2026, true),
  ('a0000001-0000-4000-8000-000000000005', 'Ligue 1',         'ligue-1',         'France',  61,  2026, true),
  ('a0000001-0000-4000-8000-000000000006', 'Eredivisie',      'eredivisie',      'Netherlands', 88, 2026, true),
  ('a0000001-0000-4000-8000-000000000007', 'Primeira Liga',   'primeira-liga',   'Portugal', 94, 2026, false)
on conflict (id) do nothing;

insert into teams (league_id, name, short_name, slug, external_id) values
  -- Premier League
  ('a0000001-0000-4000-8000-000000000001', 'Arsenal',           'ARS', 'arsenal',            42),
  ('a0000001-0000-4000-8000-000000000001', 'Manchester City',   'MCI', 'manchester-city',    50),
  ('a0000001-0000-4000-8000-000000000001', 'Liverpool',         'LIV', 'liverpool',          40),
  ('a0000001-0000-4000-8000-000000000001', 'Chelsea',           'CHE', 'chelsea',            49),
  ('a0000001-0000-4000-8000-000000000001', 'Newcastle United',  'NEW', 'newcastle-united',   34),
  ('a0000001-0000-4000-8000-000000000001', 'Brighton',          'BHA', 'brighton',           51),
  ('a0000001-0000-4000-8000-000000000001', 'Aston Villa',       'AVL', 'aston-villa',        66),
  ('a0000001-0000-4000-8000-000000000001', 'Tottenham',         'TOT', 'tottenham',          47),
  -- La Liga
  ('a0000001-0000-4000-8000-000000000002', 'Real Madrid',       'RMA', 'real-madrid',        541),
  ('a0000001-0000-4000-8000-000000000002', 'Barcelona',         'BAR', 'barcelona',          529),
  ('a0000001-0000-4000-8000-000000000002', 'Atletico Madrid',   'ATM', 'atletico-madrid',    530),
  ('a0000001-0000-4000-8000-000000000002', 'Real Sociedad',     'RSO', 'real-sociedad',      548),
  ('a0000001-0000-4000-8000-000000000002', 'Athletic Club',     'ATH', 'athletic-club',      531),
  ('a0000001-0000-4000-8000-000000000002', 'Villarreal',        'VIL', 'villarreal',         533),
  -- Serie A
  ('a0000001-0000-4000-8000-000000000003', 'Inter',             'INT', 'inter',              505),
  ('a0000001-0000-4000-8000-000000000003', 'AC Milan',          'MIL', 'ac-milan',           489),
  ('a0000001-0000-4000-8000-000000000003', 'Juventus',          'JUV', 'juventus',           496),
  ('a0000001-0000-4000-8000-000000000003', 'Napoli',            'NAP', 'napoli',             492),
  ('a0000001-0000-4000-8000-000000000003', 'Roma',              'ROM', 'roma',               497),
  ('a0000001-0000-4000-8000-000000000003', 'Atalanta',          'ATA', 'atalanta',           499),
  -- Bundesliga
  ('a0000001-0000-4000-8000-000000000004', 'Bayern Munich',     'BAY', 'bayern-munich',      157),
  ('a0000001-0000-4000-8000-000000000004', 'Bayer Leverkusen',  'B04', 'bayer-leverkusen',   168),
  ('a0000001-0000-4000-8000-000000000004', 'Borussia Dortmund', 'BVB', 'borussia-dortmund',  165),
  ('a0000001-0000-4000-8000-000000000004', 'RB Leipzig',        'RBL', 'rb-leipzig',         173),
  ('a0000001-0000-4000-8000-000000000004', 'VfB Stuttgart',     'VFB', 'vfb-stuttgart',      172),
  ('a0000001-0000-4000-8000-000000000004', 'Eintracht Frankfurt','SGE','eintracht-frankfurt', 169),
  -- Ligue 1
  ('a0000001-0000-4000-8000-000000000005', 'Paris Saint-Germain','PSG','paris-saint-germain', 85),
  ('a0000001-0000-4000-8000-000000000005', 'Marseille',         'OM',  'marseille',          81),
  ('a0000001-0000-4000-8000-000000000005', 'Monaco',            'ASM', 'monaco',             91),
  ('a0000001-0000-4000-8000-000000000005', 'Lille',             'LIL', 'lille',              79),
  ('a0000001-0000-4000-8000-000000000005', 'Lyon',              'OL',  'lyon',               80),
  ('a0000001-0000-4000-8000-000000000005', 'Nice',              'NCE', 'nice',               84),
  -- Eredivisie
  ('a0000001-0000-4000-8000-000000000006', 'Ajax',              'AJA', 'ajax',               194),
  ('a0000001-0000-4000-8000-000000000006', 'PSV',               'PSV', 'psv',                197),
  ('a0000001-0000-4000-8000-000000000006', 'Feyenoord',         'FEY', 'feyenoord',          209),
  ('a0000001-0000-4000-8000-000000000006', 'AZ Alkmaar',        'AZ',  'az-alkmaar',         201)
on conflict (slug) do nothing;

insert into tipsters (id, display_name, slug, is_active) values
  ('b0000001-0000-4000-8000-000000000001', 'MoonOdds Quant', 'moonodds-quant', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- AI engine config
--
-- Ported wholesale from the Convex ai_engine_config document, values intact.
-- ---------------------------------------------------------------------------

insert into ai_engine_config (
  id, name, version, status, system_prompt,
  ranking_weights, weight_constraints, confidence_thresholds, filter_thresholds,
  market_pivots, slip_building, self_tuning, api_budget, selected_league_ids, notes
) values (
  'c0000001-0000-4000-8000-000000000001',
  'MoonOdds Quant Engine',
  '1.4.0',
  'active',
  'You are the MoonOdds quantitative football analyst.

Rank every fixture using the supplied weight configuration, then emit only the picks where you hold a genuine edge over the market. Quality beats quantity: an empty slate is a valid answer.

For each pick, report the market, the selection, a confidence score on the 0-10 scale, and a plain-English rationale a bettor can check against the stats you were given. Name every filter you triggered.

Never invent statistics. If the data for a fixture is thin, say so and lower your confidence rather than guessing.',
  jsonb_build_object(
    'xgWeight', 0.22, 'formWeight', 0.18, 'h2hWeight', 0.12,
    'homeAdvantageWeight', 0.10, 'shotsOnTargetWeight', 0.12,
    'lineupWeight', 0.10, 'keyManWeight', 0.08, 'marketEfficiencyWeight', 0.08
  ),
  jsonb_build_object(
    'sumMustEqual', 1.0, 'maxDeltaPerCycle', 0.05,
    'minValuePerWeight', 0.02, 'maxValuePerWeight', 0.35
  ),
  jsonb_build_object(
    'primarySlipFloor', 8.5, 'absoluteMinimumFloor', 7.0,
    'stakingUnit5Threshold', 9.5, 'stakingUnit4Threshold', 9.0,
    'stakingUnit3Threshold', 8.5, 'stakingUnit2Threshold', 8.0,
    'stakingUnit1Threshold', 7.0
  ),
  jsonb_build_object(
    'chaosFilterWinlessGames', 5, 'redCardCarryoverPenalty', 0.05,
    'capitulationBuffer', 0.15, 'standardBuffer', 0.08,
    'clvMovementThresholdPct', 5, 'clvConfidencePenalty', 0.05,
    'travelPenaltyKm', 1500, 'travelConfidencePenalty', 0.04,
    'restRuleGamesInDays', 3, 'restRuleDays', 7, 'restConfidencePenalty', 0.06,
    'humidityPivotThresholdPct', 80, 'precipitationOver25Penalty', 0.05,
    'artificialTurfGoalsBoost', 0.03, 'valverdeMitigationRatePerGame', 0.02,
    'mraOverperformThresholdPct', 15,
    'keymanTier1Penalty', 0.12, 'keymanTier1MitigatedPenalty', 0.06,
    'keymanTier2Penalty', 0.08, 'keymanTier3GkPenalty', 0.10,
    'keymanTier3GkBackupPenalty', 0.05
  ),
  jsonb_build_object(
    'lowOddsPivotThreshold', 1.35, 'lowOddsPivotTo', 'over_under_1_5',
    'humidityPivotTo', 'over_under_2_5', 'humidityPivotValue', 'under',
    'humidityPivotLine', 2.5, 'chaosPivotTo', 'double_chance', 'chaosPivotValue', '1X'
  ),
  jsonb_build_object(
    'minPicksPerSlip', 3, 'maxPicksPerSlip', 5,
    'targetCombinedOddsMin', 3.5, 'targetCombinedOddsMax', 8.0
  ),
  jsonb_build_object(
    'batchSize', 50, 'minSampleForMarketAdjustment', 20,
    'performanceTargetWinRate', 0.62, 'underperformThreshold', 0.52,
    'outperformThreshold', 0.72, 'mode', 'assisted', 'autoApply', false
  ),
  jsonb_build_object(
    'dailyTotal', 500, 'reservedForResults', 100,
    'maxFixturesPerSession', 30, 'callsPerFixtureEstimate', 4
  ),
  array[39, 140, 135, 78, 61, 88],
  'Seeded configuration. Weights last adjusted by the assisted tuning cycle.'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Fixtures and predictions
--
-- Generated procedurally so the volume is realistic without thousands of lines:
--   - 60 finished fixtures over the past 30 days, with graded predictions
--   - 3 fixtures in play right now
--   - 14 fixtures later today, with pending predictions
--   - 10 fixtures tomorrow, without predictions (the pipeline hasn't run)
-- ---------------------------------------------------------------------------

do $$
declare
  market_bank text[] := array[
    '1x2', 'over_under_2_5', 'over_under_1_5', 'over_under_3_5', 'btts',
    'double_chance', 'draw_no_bet', 'handicap', 'correct_score',
    'corners_over_under', 'first_half_goals', 'second_half_goals'
  ];
  reason_bank text[] := array[
    'Home side has converted %s%% of big chances across their last five, while the visitors concede from set pieces at nearly double the league rate. The model likes the goal line more than the result.',
    'Both teams have gone over this line in four of five. Neither keeper is behind a settled back four, and the referee''s cards profile suggests the game stays open.',
    'The market has drifted since Tuesday but the underlying numbers have not moved. We are taking the earlier price on form that the closing line has not caught up to.',
    'Away form is flattering: three of their last four wins came against sides in the bottom third. Against this press, the model expects them to sit deep and concede territory.',
    'Rest advantage is the whole story here — the visitors played 72 hours ago and travel over 1,500km. The rest-rule penalty applies, so we have pivoted to the safer market.',
    'Head-to-head is unusually one-sided at this venue: five meetings, four home wins, and an average of 3.2 goals. Chaos filter clear, so the primary selection stands.',
    'Key striker is out and the listed replacement has one goal in eleven. Tier-1 key-man penalty applied, which drops this below the goals line we would normally back.'
  ];
  tag_bank text[] := array['xg-edge','form-divergence','h2h-strong','rest-advantage','market-drift','set-piece-threat','keyman-out','home-fortress','press-mismatch'];

  f_id uuid;
  league record;
  home record;
  away record;
  i integer;
  kickoff timestamptz;
  hg smallint;
  ag smallint;
  conf numeric(4,2);
  mkt text;
  sel text;
  won boolean;
  run_id uuid;
begin
  -- ---------- settled history ----------
  insert into prediction_runs (id, run_at, num_picks, model_version)
  values (gen_random_uuid(), now() - interval '30 days', 60, 'moonodds-quant-v1.4.0')
  returning id into run_id;

  for i in 1..60 loop
    select * into league from leagues where is_active order by random() limit 1;
    select * into home from teams where league_id = league.id order by random() limit 1;
    select * into away from teams where league_id = league.id and id <> home.id order by random() limit 1;

    kickoff := now() - (interval '1 day' * (1 + floor(random() * 29))) - (interval '1 hour' * floor(random() * 8));
    hg := floor(random() * 4)::smallint;
    ag := floor(random() * 3)::smallint;

    insert into fixtures (
      league_id, home_team_id, away_team_id, slug, fixture_date,
      started_at, ended_at, status, home_goals, away_goals,
      ht_home_goals, ht_away_goals, venue, referee, round
    ) values (
      league.id, home.id, away.id,
      home.slug || '-v-' || away.slug || '-' || to_char(kickoff, 'YYYYMMDDHH24MI'),
      kickoff, kickoff, kickoff + interval '105 minutes', 'finished', hg, ag,
      least(hg, floor(random() * 2)::smallint), least(ag, floor(random() * 2)::smallint),
      home.name || ' Stadium',
      (array['M. Oliver','A. Taylor','C. Pawson','S. Hooper','P. Tierney'])[1 + floor(random() * 5)],
      'Regular Season - ' || (10 + floor(random() * 25))::text
    ) returning id into f_id;

    mkt := market_bank[1 + floor(random() * 8)];
    conf := round((7.2 + random() * 2.5)::numeric, 2);

    -- Selection consistent with the market, and a result consistent with it,
    -- weighted so the seeded track record lands near a believable 63% strike.
    won := random() < 0.63;
    sel := case mkt
      when '1x2' then case when hg > ag then '1' when hg = ag then 'X' else '2' end
      when 'btts' then case when hg > 0 and ag > 0 then 'yes' else 'no' end
      when 'over_under_2_5' then case when hg + ag > 2 then 'over' else 'under' end
      when 'over_under_1_5' then case when hg + ag > 1 then 'over' else 'under' end
      when 'over_under_3_5' then case when hg + ag > 3 then 'over' else 'under' end
      when 'double_chance' then case when hg >= ag then '1X' else 'X2' end
      when 'draw_no_bet' then case when hg > ag then '1' else '2' end
      else 'over'
    end;

    -- If this one is meant to be a loss, invert the selection.
    if not won then
      sel := case mkt
        when '1x2' then case sel when '1' then '2' when '2' then '1' else '1' end
        when 'btts' then case sel when 'yes' then 'no' else 'yes' end
        when 'double_chance' then case sel when '1X' then 'X2' else '1X' end
        when 'draw_no_bet' then case sel when '1' then '2' else '1' end
        else case sel when 'over' then 'under' else 'over' end
      end;
    end if;

    insert into predictions (
      fixture_id, tipster_id, prediction_run_id, prediction_type, predicted_value,
      confidence_score, staking_unit, frontier_explanation, status, model_version,
      reasoning_tags, actual_result, settled_at, created_at, filters_applied
    ) values (
      f_id, 'b0000001-0000-4000-8000-000000000001', run_id, mkt::prediction_type, sel,
      conf,
      case when conf >= 9.5 then 5 when conf >= 9.0 then 4
           when conf >= 8.5 then 3 when conf >= 8.0 then 2 else 1 end,
      format(reason_bank[1 + floor(random() * 7)], (55 + floor(random() * 30))::text),
      (case when won then 'won' else 'lost' end)::prediction_status,
      'moonodds-quant-v1.4.0',
      array[tag_bank[1 + floor(random() * 9)], tag_bank[1 + floor(random() * 9)]],
      jsonb_build_object('homeGoals', hg, 'awayGoals', ag),
      kickoff + interval '105 minutes',
      kickoff - interval '8 hours',
      jsonb_build_object('chaosFilter', random() < 0.2, 'restRule', random() < 0.15, 'keyMan', random() < 0.25)
    );
  end loop;

  -- ---------- in play ----------
  for i in 1..3 loop
    select * into league from leagues where is_active order by random() limit 1;
    select * into home from teams where league_id = league.id order by random() limit 1;
    select * into away from teams where league_id = league.id and id <> home.id order by random() limit 1;

    kickoff := now() - interval '52 minutes';

    insert into fixtures (
      league_id, home_team_id, away_team_id, slug, fixture_date, started_at,
      status, home_goals, away_goals, ht_home_goals, ht_away_goals, venue, round
    ) values (
      league.id, home.id, away.id,
      home.slug || '-v-' || away.slug || '-live-' || i::text,
      kickoff, kickoff, 'live',
      floor(random() * 3)::smallint, floor(random() * 2)::smallint,
      floor(random() * 2)::smallint, floor(random() * 2)::smallint,
      home.name || ' Stadium', 'Regular Season - 28'
    ) returning id into f_id;

    conf := round((8.4 + random() * 1.2)::numeric, 2);
    insert into predictions (
      fixture_id, tipster_id, prediction_type, predicted_value, confidence_score,
      staking_unit, frontier_explanation, status, model_version, reasoning_tags, created_at
    ) values (
      f_id, 'b0000001-0000-4000-8000-000000000001', 'over_under_2_5', 'over', conf,
      case when conf >= 9.0 then 4 else 3 end,
      format(reason_bank[2], '68'), 'pending', 'moonodds-quant-v1.4.0',
      array['xg-edge','press-mismatch'], kickoff - interval '6 hours'
    );
  end loop;

  -- ---------- today, still to kick off ----------
  insert into prediction_runs (id, run_at, num_picks, model_version)
  values (gen_random_uuid(), date_trunc('day', now()) + interval '6 hours', 14, 'moonodds-quant-v1.4.0')
  returning id into run_id;

  for i in 1..14 loop
    select * into league from leagues where is_active order by random() limit 1;
    select * into home from teams where league_id = league.id order by random() limit 1;
    select * into away from teams where league_id = league.id and id <> home.id order by random() limit 1;

    kickoff := date_trunc('day', now() at time zone 'utc') at time zone 'utc'
               + interval '1 hour' * (12 + (i % 10))
               + interval '15 minutes' * (i % 4);

    insert into fixtures (
      league_id, home_team_id, away_team_id, slug, fixture_date, status, venue, round
    ) values (
      league.id, home.id, away.id,
      home.slug || '-v-' || away.slug || '-today-' || i::text,
      kickoff, 'scheduled', home.name || ' Stadium',
      'Regular Season - 28'
    ) returning id into f_id;

    -- Spread across the full market vocabulary so every label gets exercised.
    mkt := market_bank[1 + ((i - 1) % 12)];
    conf := round((7.4 + random() * 2.4)::numeric, 2);
    sel := case mkt
      when '1x2' then (array['1','X','2'])[1 + floor(random() * 3)]
      when 'btts' then (array['yes','no'])[1 + floor(random() * 2)]
      when 'double_chance' then (array['1X','X2','12'])[1 + floor(random() * 3)]
      when 'draw_no_bet' then (array['1','2'])[1 + floor(random() * 2)]
      when 'handicap' then (array['home -1.5','away +0.5','home -0.5'])[1 + floor(random() * 3)]
      when 'correct_score' then (array['2-1','1-0','2-0','1-1'])[1 + floor(random() * 4)]
      else (array['over','under'])[1 + floor(random() * 2)]
    end;

    insert into predictions (
      fixture_id, tipster_id, prediction_run_id, prediction_type, predicted_value,
      confidence_score, staking_unit, frontier_explanation, status, model_version,
      reasoning_tags, alt_market, alt_predicted_value, alt_confidence,
      mra_signal_home, mra_signal_away, filters_applied, created_at
    ) values (
      f_id, 'b0000001-0000-4000-8000-000000000001', run_id, mkt::prediction_type, sel,
      conf,
      case when conf >= 9.5 then 5 when conf >= 9.0 then 4
           when conf >= 8.5 then 3 when conf >= 8.0 then 2 else 1 end,
      format(reason_bank[1 + floor(random() * 7)], (55 + floor(random() * 30))::text),
      'pending', 'moonodds-quant-v1.4.0',
      array[tag_bank[1 + floor(random() * 9)], tag_bank[1 + floor(random() * 9)], tag_bank[1 + floor(random() * 9)]],
      'over_under_1_5'::prediction_type, 'over', round((conf - 0.6)::numeric, 2),
      (array['overperforming','stable','regressing'])[1 + floor(random() * 3)],
      (array['overperforming','stable','regressing'])[1 + floor(random() * 3)],
      jsonb_build_object(
        'chaosFilter', random() < 0.2,
        'restRule', random() < 0.15,
        'keyMan', random() < 0.25,
        'travel', random() < 0.1,
        'clvDrift', random() < 0.2
      ),
      date_trunc('day', now()) + interval '6 hours'
    );
  end loop;

  -- ---------- tomorrow, awaiting the pipeline ----------
  for i in 1..10 loop
    select * into league from leagues where is_active order by random() limit 1;
    select * into home from teams where league_id = league.id order by random() limit 1;
    select * into away from teams where league_id = league.id and id <> home.id order by random() limit 1;

    kickoff := date_trunc('day', now() at time zone 'utc') at time zone 'utc'
               + interval '1 day' + interval '1 hour' * (12 + (i % 9));

    insert into fixtures (
      league_id, home_team_id, away_team_id, slug, fixture_date, status, venue, round
    ) values (
      league.id, home.id, away.id,
      home.slug || '-v-' || away.slug || '-tmrw-' || i::text,
      kickoff, 'scheduled', home.name || ' Stadium', 'Regular Season - 29'
    );
  end loop;
end;
$$;

-- Per-fixture stats for everything that has a prediction, so the Office
-- pipeline view and the match analysis modal have something to render.
insert into fixture_stats (
  fixture_id, home_form, away_form,
  h2h_home_wins, h2h_away_wins, h2h_draws, h2h_avg_goals, h2h_btts_rate,
  home_season, away_season
)
select
  f.id,
  (array['WWDLW','WDWWL','LWWDW','DWLWW','WWWDL'])[1 + floor(random() * 5)],
  (array['LDWLL','WLDLW','DLLWD','LWDLL','WDLLW'])[1 + floor(random() * 5)],
  floor(random() * 4)::smallint,
  floor(random() * 3)::smallint,
  floor(random() * 3)::smallint,
  round((2.1 + random() * 1.4)::numeric, 2),
  round((0.4 + random() * 0.4)::numeric, 3),
  jsonb_build_object(
    'gamesPlayed', 24, 'wins', 13, 'draws', 6, 'losses', 5,
    'avgGoalsScored', round((1.4 + random())::numeric, 2),
    'avgGoalsConceded', round((0.8 + random() * 0.7)::numeric, 2),
    'cleanSheetRate', round((0.25 + random() * 0.25)::numeric, 3),
    'bttsRate', round((0.45 + random() * 0.25)::numeric, 3)
  ),
  jsonb_build_object(
    'gamesPlayed', 24, 'wins', 9, 'draws', 7, 'losses', 8,
    'avgGoalsScored', round((1.0 + random())::numeric, 2),
    'avgGoalsConceded', round((1.1 + random() * 0.7)::numeric, 2),
    'cleanSheetRate', round((0.15 + random() * 0.2)::numeric, 3),
    'bttsRate', round((0.5 + random() * 0.25)::numeric, 3)
  )
from fixtures f
where exists (select 1 from predictions p where p.fixture_id = f.id)
on conflict do nothing;

-- Odds snapshots, so the CLV view has movement to show.
insert into odds_snapshots (
  fixture_id, prediction_id, market_type, bookmaker,
  opening_odds, pick_odds, closing_odds, clv_delta, market_opposed
)
select
  p.fixture_id, p.id, p.prediction_type::text, 'Pinnacle',
  round((1.6 + random() * 1.2)::numeric, 3),
  round((1.6 + random() * 1.2)::numeric, 3),
  round((1.6 + random() * 1.2)::numeric, 3),
  round((random() * 0.16 - 0.08)::numeric, 4),
  random() < 0.22
from predictions p
where p.status in ('won', 'lost')
limit 40;

-- ---------------------------------------------------------------------------
-- Commerce — the pass holder actually bought a pass today
-- ---------------------------------------------------------------------------

insert into payments (id, user_id, reference, purpose, amount_minor, currency, amount_usd, status, settled_at)
values
  ('d0000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'pass-seed-0001', 'daily_pass', 4500, 'GHS', 3.00, 'succeeded', now() - interval '3 hours'),
  ('d0000001-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'extra-seed-0001', 'extra_picks', 6000, 'GHS', 4.00, 'succeeded', now() - interval '2 hours'),
  ('d0000001-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444',
   'pass-seed-0002', 'daily_pass', 4500, 'GHS', 3.00, 'succeeded', now() - interval '5 hours')
on conflict (reference) do nothing;

insert into daily_passes (user_id, date_key, amount_usd, currency, payment_id, status)
values
  ('11111111-1111-4111-8111-111111111111', (now() at time zone 'utc')::date, 3.00, 'GHS',
   'd0000001-0000-4000-8000-000000000001', 'active'),
  -- The suspended user holds a valid pass. Access must still be denied, which
  -- is exactly the case worth being able to see in the UI.
  ('44444444-4444-4444-8444-444444444444', (now() at time zone 'utc')::date, 3.00, 'GHS',
   'd0000001-0000-4000-8000-000000000003', 'active')
on conflict (user_id, date_key) do nothing;

-- Extra picks bought for two leagues (up to 3 games each).
insert into extra_pick_orders (user_id, date_key, league_ids, fixture_ids, num_games, amount_usd, payment_id)
select
  '11111111-1111-4111-8111-111111111111',
  (now() at time zone 'utc')::date,
  array['a0000001-0000-4000-8000-000000000003'::uuid, 'a0000001-0000-4000-8000-000000000004'::uuid],
  array_agg(f.id),
  count(*)::smallint,
  4.00,
  'd0000001-0000-4000-8000-000000000002'
from (
  select id from fixtures
  where status = 'scheduled'
    and league_id in ('a0000001-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000004')
  order by fixture_date
  limit 6
) f;

-- A couple of saved slips for the pass holder.
do $$
declare
  slip_id uuid;
  legs record;
begin
  insert into slips (user_id, slip_type, status, combined_odds, leg_count, confirmed_at)
  values ('11111111-1111-4111-8111-111111111111', 'accumulator', 'won', 6.42, 3,
          now() - interval '6 days')
  returning id into slip_id;

  for legs in
    select id from predictions where status = 'won' order by settled_at desc limit 3
  loop
    insert into slip_legs (slip_id, prediction_id, odds, status)
    values (slip_id, legs.id, round((1.6 + random() * 0.6)::numeric, 3), 'won');
  end loop;

  insert into slips (user_id, slip_type, status, combined_odds, leg_count, confirmed_at)
  values ('11111111-1111-4111-8111-111111111111', 'accumulator', 'lost', 11.80, 4,
          now() - interval '2 days')
  returning id into slip_id;

  for legs in
    select id from predictions where status in ('won','lost') order by random() limit 4
  loop
    insert into slip_legs (slip_id, prediction_id, odds, status)
    values (slip_id, legs.id, round((1.7 + random() * 0.8)::numeric, 3),
            (array['won','lost'])[1 + floor(random() * 2)]::slip_leg_status);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- A pending tuning report for the Office reports tab to act on
-- ---------------------------------------------------------------------------

insert into tuning_reports (
  config_id, review_period,
  performance_by_market, performance_by_league, performance_by_confidence_band,
  performance_by_filter, performance_by_mra_signal,
  proposed_weight_changes, proposed_threshold_changes, proposed_filter_changes,
  status
) values (
  'c0000001-0000-4000-8000-000000000001',
  jsonb_build_object(
    'from', (now() - interval '30 days')::text, 'to', now()::text,
    'predictionsReviewed', 60, 'settled', 60, 'voids', 0, 'overallWinRate', 0.6333
  ),
  jsonb_build_object(
    'over_under_2_5', jsonb_build_object('total', 18, 'wins', 13, 'losses', 5, 'winRate', 0.722),
    '1x2',            jsonb_build_object('total', 15, 'wins', 8,  'losses', 7, 'winRate', 0.533),
    'btts',           jsonb_build_object('total', 12, 'wins', 8,  'losses', 4, 'winRate', 0.667),
    'double_chance',  jsonb_build_object('total', 9,  'wins', 6,  'losses', 3, 'winRate', 0.667),
    'draw_no_bet',    jsonb_build_object('total', 6,  'wins', 3,  'losses', 3, 'winRate', 0.500)
  ),
  jsonb_build_object(
    'Premier League', jsonb_build_object('total', 16, 'wins', 11, 'losses', 5, 'winRate', 0.688),
    'La Liga',        jsonb_build_object('total', 13, 'wins', 8,  'losses', 5, 'winRate', 0.615),
    'Serie A',        jsonb_build_object('total', 11, 'wins', 7,  'losses', 4, 'winRate', 0.636),
    'Bundesliga',     jsonb_build_object('total', 10, 'wins', 5,  'losses', 5, 'winRate', 0.500),
    'Ligue 1',        jsonb_build_object('total', 10, 'wins', 7,  'losses', 3, 'winRate', 0.700)
  ),
  jsonb_build_object(
    '9.5+',    jsonb_build_object('total', 6,  'wins', 5,  'losses', 1, 'winRate', 0.833),
    '9.0-9.5', jsonb_build_object('total', 12, 'wins', 9,  'losses', 3, 'winRate', 0.750),
    '8.5-9.0', jsonb_build_object('total', 19, 'wins', 12, 'losses', 7, 'winRate', 0.632),
    '8.0-8.5', jsonb_build_object('total', 14, 'wins', 8,  'losses', 6, 'winRate', 0.571),
    '7.0-8.0', jsonb_build_object('total', 9,  'wins', 4,  'losses', 5, 'winRate', 0.444)
  ),
  jsonb_build_object(
    'chaosFilter', jsonb_build_object('total', 12, 'wins', 9, 'losses', 3, 'winRate', 0.750),
    'restRule',    jsonb_build_object('total', 9,  'wins', 6, 'losses', 3, 'winRate', 0.667),
    'keyMan',      jsonb_build_object('total', 15, 'wins', 8, 'losses', 7, 'winRate', 0.533)
  ),
  jsonb_build_object(
    'overperforming', jsonb_build_object('total', 21, 'wins', 12, 'losses', 9, 'winRate', 0.571),
    'stable',         jsonb_build_object('total', 24, 'wins', 17, 'losses', 7, 'winRate', 0.708),
    'regressing',     jsonb_build_object('total', 15, 'wins', 9,  'losses', 6, 'winRate', 0.600)
  ),
  jsonb_build_array(
    jsonb_build_object('parameter','xgWeight','current_value',0.22,'proposed_value',0.25,'delta',0.03,
      'rationale','Goal-line markets driven by xG are the strongest bucket at 72.2%. Shifting weight toward xG should lift the 1X2 bucket, which is the weakest at 53.3%.'),
    jsonb_build_object('parameter','h2hWeight','current_value',0.12,'proposed_value',0.09,'delta',-0.03,
      'rationale','Head-to-head shows no measurable edge over the review window and is the most likely source of overfitting on small samples.')
  ),
  jsonb_build_array(
    jsonb_build_object('parameter','primarySlipFloor','current_value',8.5,'proposed_value',8.7,'delta',0.2,
      'rationale','The 7.0-8.0 band lost money at 44.4%. Raising the floor removes the tail without touching the profitable bands.')
  ),
  jsonb_build_array(
    jsonb_build_object('parameter','keymanTier1Penalty','current_value',0.12,'proposed_value',0.15,
      'rationale','Key-man flagged picks underperform the book at 53.3%. A larger penalty pushes marginal ones below the floor.')
  ),
  'pending'
);
