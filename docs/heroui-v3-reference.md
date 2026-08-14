# HeroUI v3 — API reference for this project

HeroUI v3 (3.2.4) is a ground-up rewrite and its API differs from v2 in ways that
matter. Extracted from the installed package, not from memory.

## Shape of the library

- **No provider.** v2's `<HeroUIProvider>` is gone. Styling is pure CSS variables.
- **Compound components.** `Card.Header`, `Card.Title`, `Card.Content`, `Card.Footer`.
- **Built on React Aria Components**, so `href`, `isDisabled`, `onPress` (not `onClick`)
  are the idioms. `RouterProvider` in `src/app/providers.tsx` routes `href` through Next.
- **Peer requirements:** React ≥19, Tailwind ≥4. Both satisfied.
- **Subpath imports** keep bundles lean: `@heroui/react/button`, not the barrel.

## Theming

Import once in `globals.css`:

```css
@import "@heroui/react/styles";
```

Then override the semantic variables. Light lives on `:root, .light, [data-theme="light"]`;
dark on `.dark, [data-theme="dark"]`. We invert that — dark is the default, set via
`data-theme="dark"` on `<html>`.

Variables worth knowing: `--background` `--foreground` `--surface`
`--surface-secondary` `--surface-tertiary` `--overlay` `--muted` `--default`
`--accent` `--success` `--warning` `--danger` `--border` `--separator` `--focus`
`--link` `--field-background` `--field-border` `--radius` `--backdrop`.

Hover states are derived automatically via `color-mix` — don't set them by hand.

## Variant vocabulary

Getting these wrong fails silently (the component renders unstyled rather than erroring).

| Component | Props | Default |
|---|---|---|
| `Button` | `variant`: primary·secondary·tertiary·outline·ghost·danger · `size`: sm·md·lg · `fullWidth` · `isIconOnly` | primary, md |
| `Card` | `variant`: default·secondary·tertiary·transparent | default |
| `Chip` | `color`: default·accent·success·warning·danger · `variant`: primary·secondary·soft·tertiary · `size`: sm·md·lg | default, secondary |
| `Badge` | `color`: default·accent·success·warning·danger · `variant`: primary·secondary·soft · `size` | default, primary |
| `Alert` | `status`: default·accent·success·warning·danger | default |
| `Tabs` | `variant`: primary·secondary | primary |
| `Table` | `variant`: primary·secondary | primary |
| `Select` `Input` `Textarea` `Checkbox` `RadioGroup` | `variant`: primary·secondary · `fullWidth` | primary |
| `Modal` | `size`: xs·sm·md·lg·full·cover · `variant`: opaque·blur·transparent · `scroll`: inside·outside | md, opaque, inside |
| `Drawer` | `placement`: top·bottom·left·right · `variant`: opaque·blur·transparent | bottom, opaque |
| `ProgressBar` | `color`: default·accent·success·warning·danger · `size` | accent, md |
| `Spinner` | `color`: accent·current·success·warning·danger · `size`: sm·md·lg·xl | accent, md |
| `Avatar` | `color` · `variant`: default·soft · `size` | default, md |
| `Toast` | `variant`: default·accent·success·warning·danger · `placement`: top·bottom | default, bottom |
| `Separator` | `orientation`: horizontal·vertical · `variant`: default·secondary·tertiary | horizontal, default |
| `Typography` | `type`: body·code·h1–h6 · `color`: default·muted · `weight`: normal·medium·semibold·bold · `truncate` | body |
| `Skeleton` | `animationType`: none·pulse·shimmer | shimmer |

**Note:** `Button` has no `accent` variant — `primary` already uses `--accent`.
`Chip`/`Badge`/`Alert` take colour on a separate prop from variant, and the default
`secondary` variant mutes the colour; use `variant="soft"` or `"primary"` when the
outcome colour should read at a glance.

## Project conventions

- Outcome semantics are fixed: **teal `success` = won**, **red `danger` = lost**,
  **orange `warning` = pending/at-risk**, **blue `accent` = live**.
- The blue→orange gradient (`.bg-brand-gradient`) is reserved for primary
  conversion actions — buying a pass or extra picks. Never decorative.
- Figures use `font-mono` and `tabular-nums` so columns align.
