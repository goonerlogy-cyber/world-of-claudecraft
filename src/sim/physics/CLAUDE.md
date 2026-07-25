# src/sim/physics - the character physics engine

The collision and traversal solver behind player movement. Pure, deterministic,
host-agnostic: the same code runs the offline browser Sim, the authoritative
server, the headless RL env, and the client's display-only self extrapolator.

## Why this is in-house and not a physics library
The sim's contract is a fixed 20 Hz step, one seeded `Rng`, and byte-identical
behavior across three hosts (root `CLAUDE.md`, Invariants). A third-party engine
(Rapier, Ammo, Cannon) brings its own solver, its own float behavior, and in
several cases its own RNG and broadphase iteration order, none of which the
parity gate could hold still. It would also violate the tiny-dependency rule for
a feature that is, in this world's geometry, a few hundred lines of exact math.

## What the world's collision geometry actually is
EXTRUDED 2D. Every obstacle is a circle or an oriented box in XZ that rises from
the ground to a known top (`Collider.moveTopY`, absent = full height), and the
walkable surface is a heightfield (`world.ts` `groundHeight`). So a body capsule
reduces EXACTLY to a circle sweep in XZ plus scalar height tests: cheaper than a
general 3D solver and exact rather than approximate for this content.

## The two files
- `sweep.ts`: the math leaf. Continuous time-of-impact for a moving body circle
  against a circle or an OBB (slab test plus rounded corners via the Minkowski
  sum), and the minimum-translation overlap query used for depenetration.
  Returns contact normals; no state, no allocation.
- `character.ts`: the solver. Depenetrate, then up to four sweep-and-slide
  passes, with STEP UP when a blocking obstacle is standable and its top is
  within `MAX_STEP_HEIGHT`, then the terrain wall gate with contour sliding.
  Also `floorHeightAt`, the support query the kernel's vertical pass lands on.

`index.ts` is the barrel; import from it, never from the files directly.

## Rules that are load-bearing here
- **Step-up applies to COLLIDERS, never to the heightfield.** A per-tick step
  allowance on terrain is a cliff-climbing ladder: a body covers about 0.35 yd
  per tick, so a step-height rise every tick would raise the effective climb limit to
  `stepHeight / 0.35` and defeat `PLAYER_MAX_CLIMB_SLOPE`. Terrain keeps the
  original wall rule; the contour retry is height-neutral and therefore safe.
- **Grounded bodies step; airborne bodies mantle.** `blocksAt` grants the
  `MANTLE_REACH` lift only when airborne over a standable top, mirroring
  `colliders.ts` `passesOver`, so a jump that falls just short of a rim still
  carries over. Grounded climbing goes through `steppableAt` alone.
- **Every step-up is headroom-gated** (`isClear`): climbing must never push a
  body into a wall.
- **Open world only.** Instanced interiors (dungeon, delve, arena, Yumi maze)
  keep the long-standing `resolveMove` path in `player_motion.ts`; they are flat
  rooms of full-height walls where step-up has nothing to act on, and their
  delve bounds/door clamps live on that path.
- **Allocation-free steady state.** Module scratch (`candidates`, `hit`, `push`)
  is reused; `moveCharacter` fills a caller-owned result. The kernel owns one
  params/result pair (`player_motion.ts`).
- **No rng, no wall clock.** Guarded by `tests/architecture.test.ts`.

## Tuning
`MAX_STEP_HEIGHT` (character.ts) is the one knob that decides what a player
strides over. It is chosen against MEASURED world geometry, not taste: rock
heights come from `src/sim/decoration_dims.ts`, which is derived from the
shipped GLB bounds. Changing either one without the other re-opens the bug this
engine was built to fix (a collider top that does not match the silhouette).

## Tests
`tests/physics_character.test.ts` pins the solver directly (sweeps, sliding,
no-tunnelling, depenetration, step-up and its refusals, the terrain gate, the
floor query, and the rock size model). `tests/parkour.test.ts` covers the same
behavior end to end through a live `Sim`, including kernel-vs-Sim parity.
