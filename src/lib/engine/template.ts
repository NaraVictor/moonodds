import {
  resolveEngineVariables,
  validateEngineVariables,
  VARIABLES_BY_KEY,
  type ConfigLike,
  type VariableWarning,
} from "./variables";

/**
 * Prompt templating.
 *
 * A rendered prompt either has every placeholder filled or it does not render.
 * The alternative, shipping a literal "{{tier1Penalty}}" to the model, is the
 * worst outcome available: the run succeeds, the picks look normal, and one
 * threshold quietly meant nothing. Failing here costs a cron run; failing
 * silently costs a day of calibration nobody can reconstruct afterwards.
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type RenderedPrompt = {
  text: string;
  /** Variables the active config supplied. */
  overrides: string[];
  /** Variables that fell back to the built-in default. */
  fallbacks: string[];
  /** Config keys matching no known variable, typos and stale names. */
  unknownKeys: string[];
  /** Scale and coherence problems worth an operator's attention. */
  warnings: VariableWarning[];
  /** Placeholders actually present in this template. */
  used: string[];
};

export class PromptRenderError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `Engine prompt references ${missing.length} unknown variable(s): ${missing.join(", ")}. ` +
        `Add them to ENGINE_VARIABLES or correct the placeholder.`,
    );
    this.name = "PromptRenderError";
  }
}

/** Every distinct placeholder in a template, in first-appearance order. */
export function placeholdersIn(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) seen.add(match[1]);
  return [...seen];
}

/**
 * Render a prompt template against an engine config.
 *
 * Throws when a placeholder has no matching variable. Falling back to the
 * table default is fine and expected; having no definition at all is a bug in
 * the prompt text, and the operator needs to hear about it before a run.
 */
export function renderPrompt(template: string, config: ConfigLike | null | undefined): RenderedPrompt {
  const used = placeholdersIn(template);
  const missing = used.filter((key) => !VARIABLES_BY_KEY.has(key));
  if (missing.length) throw new PromptRenderError(missing);

  const { values, overrides, fallbacks, unknownKeys } = resolveEngineVariables(config);

  const text = template.replace(PLACEHOLDER, (_, key: string) => String(values[key]));

  // Report only on variables this template actually references, a config that
  // omits a key no prompt uses is not a fallback worth logging.
  const usedSet = new Set(used);
  return {
    text,
    overrides: overrides.filter((k) => usedSet.has(k)),
    fallbacks: fallbacks.filter((k) => usedSet.has(k)),
    unknownKeys,
    warnings: validateEngineVariables(values),
    used,
  };
}
