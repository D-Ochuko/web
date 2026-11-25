# ESLint 9 and flat config migration plan

The repo is on `eslint@^8` with `.eslintrc.json` and `eslint-config-next@14.2.35`.
ESLint 8 is end of life, and newer `eslint-config-next` releases assume ESLint 9
and the flat config format (`eslint.config.mjs`). This page plans the move so it
ships together with the Next.js upgrade instead of becoming a surprise blocker.

## Current setup

- Config: `.eslintrc.json` (legacy format), extended from `next` and `prettier`.
- Scripts: `npm run lint` runs `next lint`; `lint-staged` runs `eslint --fix` on staged JS/TS files.
- CI: `npm run lint` in the `ci` job of `.github/workflows/ci.yml`.

## Migration steps

1. Upgrade `eslint` to `^9` together with the Next.js upgrade, using the
   `eslint-config-next` version that matches the new Next release.
2. Convert `.eslintrc.json` to `eslint.config.mjs`. `@eslint/eslintrc`'s
   `FlatCompat` can wrap `next/core-web-vitals` and `prettier` while the pinned
   `eslint-config-next` does not ship a native flat export.
3. Replace `next lint` with `eslint .` in `package.json` if the Next release in
   use deprecates `next lint`, and update the `lint-staged` entry to match.
4. Re-run `npm run lint` and fix new findings, or record intentional rule
   changes in the config with a comment explaining why.
5. Remove `.eslintrc.json` once the flat config passes in CI.

## Compatibility checklist

- `eslint-config-prettier` must be a version that supports flat config (v9 or newer).
- `knip` and the Husky hooks must keep working with the new config file name.
- Editor integrations need the flat config enabled (the default in ESLint 9).

## Out of scope

Choosing new lint rules. The migration should keep the current rule set so the
diff stays reviewable.
