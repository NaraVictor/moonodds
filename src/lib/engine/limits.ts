/**
 * How big one engine pass may be.
 *
 * Three numbers, one subject, one file. They were three numbers in three files:
 * the timeout in the Anthropic client, a session cap defaulted to 30 in the
 * pipeline (twice, and disagreeing with the 15 every seeded config carries),
 * and a third copy of that 30 in the Office panel that draws the cut line. A
 * cap the operator is shown and a cap the engine applies must be the same
 * number or the line is a decoration.
 *
 * Nothing here imports the server client, so the Office can read the same
 * constants the pipeline enforces.
 */

/**
 * How long the engine's model call is allowed to take.
 *
 * Measured, not guessed: a real run over seven fixtures took 152 seconds. It
 * was 120s, which that run came close enough to that it succeeded by luck
 * rather than headroom — a slightly slower day or two more fixtures and the
 * client would have aborted a call that was working.
 *
 * 240s leaves the platform's own 300s route limit as the outer bound, so an
 * overrun fails as an error we raised rather than as a function that vanished
 * mid-write. Raising it further is not the answer if runs get longer; fewer
 * fixtures per session is, because the 300s above is not ours to move.
 */
export const ENGINE_CALL_BUDGET_MS = 240_000;

/**
 * Fixtures per session when the active config does not say.
 *
 * 20, matching what production was cut to when the model call replaced the API
 * call budget as the binding constraint.
 *
 * Treat it as provisional. It is extrapolated from a single measured run — 152
 * seconds over seven fixtures — and nothing has yet watched twenty go through
 * under a 240s timeout. `prediction_runs.model_duration_ms` exists to turn that
 * extrapolation into evidence; read it before raising this.
 */
export const DEFAULT_MAX_FIXTURES_PER_SESSION = 20;

/**
 * The ceiling on a manual override.
 *
 * An operator can size a run down freely and up only this far. The route runs
 * under a 300s platform limit and the model client under 240s; a run that
 * exceeds either is killed mid-write, and every fixture it had already analysed
 * is paid for and lost. The override is a person choosing a size, not a person
 * choosing to exceed a timeout they cannot move.
 */
export const MAX_FIXTURES_OVERRIDE = 40;

/**
 * How many fixtures one pass may work over.
 *
 * The override wins over the config, clamped at both ends. The API call budget
 * still binds separately downstream — this is the session cap, not permission
 * to spend.
 */
export function sessionCap(
  budget: { maxFixturesPerSession?: number } | null | undefined,
  override?: number,
): number {
  if (override !== undefined && Number.isFinite(override)) {
    return Math.min(Math.max(Math.floor(override), 1), MAX_FIXTURES_OVERRIDE);
  }
  return budget?.maxFixturesPerSession ?? DEFAULT_MAX_FIXTURES_PER_SESSION;
}

/**
 * Below this many games, a season average describes the last fixture rather
 * than the side.
 *
 * One four-goal match moves goals-per-game by 4/N: two goals at matchday 2,
 * 0.8 at matchday 5, 0.4 at matchday 10. Six is where a single outlier stops
 * being able to shift the average by more than about two thirds of a goal.
 *
 * Read in three places that must agree: the fetch decides whether to spend a
 * call on last season, and the prompt builder decides both whether to mark the
 * current line THIN and whether to print the prior one. A fetch that skipped
 * the call while the renderer still expected the line would print nothing and
 * look like a feed gap.
 */
export const THIN_SEASON_GAMES = 6;
