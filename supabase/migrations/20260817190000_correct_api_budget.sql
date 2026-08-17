-- ============================================================================
-- Correct api_budget on configs still carrying the shipped default
--
-- The seed was changed to match the API-Football Free plan's real 100 calls a
-- day, but `supabase db push` does not apply seeds, so every environment
-- created before that change still holds `dailyTotal: 500`. No plan on this
-- account grants 500, and runFetchStats now sizes its work against this figure,
-- so leaving it means the pipeline politely budgets itself against a ceiling
-- that does not exist and still runs the account dry before grading.
--
-- Scoped to rows that still hold exactly the shipped-wrong 500. A config whose
-- budget someone has deliberately set to anything else is left alone: this
-- corrects a bad default, it does not overwrite a decision.
-- ============================================================================

update public.ai_engine_config
set api_budget = api_budget || jsonb_build_object(
      'dailyTotal', 100,
      'reservedForResults', 20,
      'maxFixturesPerSession', 15,
      'callsPerFixtureEstimate', 4
    )
where (api_budget->>'dailyTotal')::numeric = 500;
