import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase writes a bundled edge runtime here on `supabase start`. It is
    // git-ignored generated vendor code, but eslint has no reason to know that,
    // and linting one minified line produced 154 errors that were not ours.
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
