# Turno

Run a fair pickleball **open play** — players are randomized onto courts, queued
fairly, and rotated as games finish. Offline-first, installable to a phone as a
PWA. No backend: all state lives on the device.

> _Turno_ means "turn" / "shift". "Open play" is the pickleball session format.

## Stack

- **React + TypeScript** (strict), built with **Vite**
- **Tailwind CSS** + **shadcn/ui** components
- **Vitest** for unit tests
- **Biome** for lint + format
- **pnpm** package manager (pinned via `packageManager`)
- Deploys to **Cloudflare Workers** with static assets

## Architecture

The entire rotation engine lives in **`src/engine/`** as a pure TypeScript module
with **zero React and zero DOM**. It is a reducer — `(state, action) => state` —
plus pure selectors (`whoIsUpNext`, `courtsView`, …). Randomness is injected so
the engine is fully deterministic in tests.

React is a thin shell that renders engine state and dispatches actions. UI-only
state (open sheets, text inputs) lives in React; all game state lives in the
engine.

```
src/
  engine/        pure TS: types, reducer, selectors, mode strategies, scoring, sim helper
  engine/*.test.ts
  components/    React + shadcn/ui
  components/ui/ shadcn primitives (button, input, sheet)
  hooks/         useEngine — binds the reducer to React + persistence
  lib/           storage (guarded localStorage), utils
  pwa/           service-worker registration
public/          manifest.webmanifest, sw.js, icons
prototype/       original single-file reference (read-only)
wrangler.jsonc   Cloudflare Workers + SPA assets config
```

### Game modes (strategy pattern)

Modes share one interface; the only divergence is *what happens when a game ends*
(`src/engine/modes.ts`):

- **Rotating queue** (default) — courts run independently; when a game ends,
  everyone on that court goes to the back of the queue and the next fair group is
  pulled on.
- **King of the court** — winners stay (capped at `KING_MAX_CONSECUTIVE_WINS`),
  losers rotate off, challengers come from the top of the fairness queue. This
  mode records who won each game.

### Fairness & mixing

- **Fairness queue** — next players are chosen by *fewest games played first*,
  then *longest wait*. Keeps everyone within ~1 game of each other.
- **Partner/opponent mixing** — the team split that least reuses past partners
  (`PARTNER_WEIGHT = 3`) and opponents (`OPPONENT_WEIGHT = 1`) is chosen, over a
  small window of the queue, never at the cost of fairness.
- **Hold / return** — bench anyone; returning re-slots them fairly (at the
  current waiting minimum, back of that tier).
- **Latecomers** join at the current minimum game count.
- **Mix all courts** counts every in-progress game as done and redraws all courts
  together for maximum cross-court mixing.

Tunable constants live in `src/engine/constants.ts` (king-of-court defaults are
flagged `confirm with product owner`).

## Scripts

```bash
pnpm install        # install deps
pnpm dev            # dev server
pnpm build          # type-check + production build to dist/
pnpm preview        # preview the production build
pnpm test           # run the Vitest engine suite
pnpm lint           # Biome lint + format check
pnpm format         # Biome format (write)
pnpm typecheck      # tsc --noEmit
pnpm deploy         # build + wrangler deploy (Cloudflare Workers)
```

## Testing

The engine has thorough invariant and property-style tests (a seeded
simulation drives it through many random game completions). Covered: no
double-booking / capacity, bounded games-played spread, hold/return fairness,
latecomers, partner-mixing vs a random baseline, king-of-court cap/losers, and
mid-session mode/format/court switches.

## PWA / offline

`public/manifest.webmanifest` + `public/sw.js` precache the app shell and
runtime-cache the hashed build assets, so the app loads and runs with no network
once installed. The display font (Outfit) is self-hosted and bundled — no runtime
CDNs or external fonts.

## Deploy

`wrangler.jsonc` serves `dist/` as static assets with
`not_found_handling: "single-page-application"` so client routes resolve to the
app shell. Run `pnpm deploy` to publish to Cloudflare Workers.

## Out of scope (structured for later)

No backend, auth, or database in this version. A roster is just an array of
player objects, so a later v2 can additively load clubs/members from a Workers
API (D1/KV) without changing the engine.
