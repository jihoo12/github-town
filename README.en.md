# GitHub Town

**English** · [한국어](README.md)

**Live: https://jihoo12.github.io/github-town/** (add `?user=<name>` to see anyone else's town)

The deploy workflow pre-fetches jihoo12's town at build time into `snapshots/jihoo12.json`, so visitors do not spend their own API quota on it. Put a token in the repository secret `GH_API_TOKEN` to use it for that fetch (otherwise the built-in Actions token is used).
The snapshot is refreshed daily, and when a visitor runs out of API quota or cannot reach GitHub, the page shows this jihoo12 town instead of the demo.

A web app that turns a GitHub user's repositories into a 3D town. Repositories you
still maintain become buildings with their lights on; neglected ones go dark at the
western end of the same streets, in the foggy **ghost town**. You walk between them in first person.

- Building height = stars (log scale)
- Building color = primary language
- Active repositories → downtown, no push for 90+ days → ruins, archived → tombstones
- Forked repositories are left out of the town entirely

The default user is [`jihoo12`](https://github.com/jihoo12). Build any other town
with `?user=<name>` or the search box; `?user=demo` is a demo town that needs no API
calls.

The interface ships in Korean and English. Use the **KO/EN** button in the header,
or `?lang=en` / `?lang=ko` to pick one explicitly. The choice is remembered in
`localStorage`, and switching languages re-renders in place without refetching.

## Running it

The dev environment is pinned with a Nix flake (Node.js 24 + git).

```bash
nix develop          # enter the devShell
npm install
npm run dev          # http://localhost:5173
```

Build and type checking:

```bash
npm run build        # tsc --noEmit + vite build → dist/
npm run preview      # preview the built output
npm run typecheck
```

## GitHub API

The browser talks to the [GitHub REST API](https://docs.github.com/rest) directly.
There is no server or backend.

- Without a token you get **60 calls per hour** per IP. Every 100 repositories adds
  one more call for the next page.
- A personal access token, entered with the key button in the top right, raises the
  limit to **5,000 calls per hour**. The token is stored only in `localStorage` and
  never sent anywhere else. Reading public repositories needs no extra scopes.
- Successful responses are cached per user for 10 minutes, so reloads are free. The
  refresh button skips the cache and fetches again.
- Rate limits, 404s, invalid tokens, and network failures each get their own
  explanation card.

## Ghost town rules

Everything is based on `pushed_at` (the last real push).

| State | Condition | In the town |
| --- | --- | --- |
| Active | pushed within 90 days | lit buildings downtown |
| Ghost (stale) | no push for over 90 days | dark ruins at the west end of the same streets |
| Ghost (archived) | `archived: true` | tombstones in the ghost town |

To keep the scene readable and fast, at most 150 repositories are rendered in each
district; the number that was cut is shown in the left panel.

## Structure

```
index.html          UI markup (search, profile panel, legend, tooltip, token dialog)
src/main.ts         entry point: load flow, cache, token, URL/localStorage state
src/github.ts       GitHub API calls, fork filter, ghost classification, stats
src/i18n.ts         Korean/English dictionary and locale switching
src/town.ts         layout math and 3D geometry (island, buildings, tombstones, lamps, cars)
src/world.ts        renderer, sky/stars/moon, lights, first-person walking/collision, bloom, aim/click
src/textures.ts     canvas-generated window/sign/label/ground/fog textures
src/theme.ts        language colors, number/date formatting, seeded random
src/ui.ts           DOM rendering plus loading/error/toast state
src/demo.ts         offline demo town data
src/style.css       all styles and the responsive layout
```

## Controls

- Walk the town in first person. Click the scene to capture the mouse and look around
- `WASD`/arrow keys to walk, `Shift` to run, `Space` to jump, `Esc` to release the mouse
- Aim at a building to see repository details, click while aiming to open it on GitHub
- On touch screens, move with the stick at the bottom left, drag to look, tap a building to open it
- `/` focuses the search box

## Technical notes

- three.js 0.187 + Vite 8 + TypeScript 5.9
- Buildings repeat their `BoxGeometry` UVs to world scale so window tiles never
  stretch, and materials are shared per language color.
- Leaves, rocks, road dashes, and debris are merged into `InstancedMesh`es to cut
  draw calls.
- The scene is post-processed with `EffectComposer` + `UnrealBloomPass`.
