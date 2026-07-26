# Physics asset audit: every prop against the traversal engine

The v0.29 parkour pass audit: each prop category, the physical model it
carries, and the deliberate exceptions. The traversal ladder the models feed
(constants in `src/sim/physics/character.ts`, `src/sim/colliders.ts`,
`src/sim/physics/ledge.ts`): a rise inside `MAX_STEP_HEIGHT` is a stride, a
top inside jump apex + `MANTLE_REACH` is a silent vault, a lip inside apex +
`LEDGE_GRAB_MAX` is a grab-and-climb, and everything above is a wall. Tops
may be flat or shaped (`TopSlope`), sampled through `colliderTopAt`.

## Open world

| Category | Model | Notes |
|---|---|---|
| Houses, inn, blacksmith | full-height OBB | Single merged meshes with no per-part data; roofs are out of climb reach by design. |
| Chapel | composed: full-height tower OBB + standable gabled hall roof | Composition single-sourced in `prop_layout.ts` (CHAPEL_TOWER/CHAPEL_HALL); the entry hall is the climbable low roof section. |
| Market stalls | full-height circle with a standable CONE canopy top | Counters block walks; the canopy climbs and walks up to its peak. |
| Stall dressing (crates, barrels, anvil, weapon stand) | standable circles at measured heights | Stride or vault per the ladder. |
| Wells | full-height circle | Roof (3.6) is deliberately out of climb reach. |
| Dock decks | raised walkable ground (`world.ts`) | Planks are floor, not colliders. |
| Dock hut | OBB with a standable gabled roof | Ridge along the hut's long axis. |
| Dock loose dressing (two barrels, one crate) | standable circles at measured heights | Stride/vault; tops ride the deck surface via groundHeight. |
| Moored rowboat | standable OBB deck (stride height) | Afloat at the waterline or hauled on the bank, same predicate the renderer seats the mesh with; you can step in and stand. |
| Tents | full-height circle | Cloth cones are not standable on purpose. |
| Crates | standable circle (CRATE_TOP 1.35) | The classic vault. |
| Campfires | pass-over top, NOT standable | A jump clears the flame; nobody perches in it. |
| Mud huts (murloc mushrooms) | stem-only circle (r 1.1) | The cap overhangs; extruded-2D cannot model overhangs, so walking under the cap is the honest choice. |
| Ruin columns | full-height circles | 4.3 tall: walls. |
| Fences | rail OBBs (`isFence`) | Grounded collide, jumps clear. |
| Field rocks | standable circles, heights from `decoration_dims.ts` | Stride/vault/climb by size; tops are flat (small enough that a dome profile would read identically). |
| Graveyard headstones | standable circles at per-shape heights | The cross is the town's classic climb. |
| Town/station furniture | standable per `town_props.ts` sizes | Everything except open flame. |
| Editor placements | full-height circles | Custom maps author `collideRadius` only. |

## Dungeon interiors

| Category | Model | Notes |
|---|---|---|
| Walls, chamber stubs, pillars | full-height | Reach the ceiling. |
| Boss dais | raised FLOOR (`dungeon_floor.ts`, DAIS_HEIGHT 0.6) | Real elevation through `groundHeight`: mobs and players stand ON it, the rim strides up and down, jumps arc onto it. Flat rooms (arena, Nythraxis raid) have no lift. |
| Tomb slots, `coffins` dressing | one standable OBB lid per slot, height by the shared `tombSlotRoll` | Plain 1.72 / decorated 1.17, matching the drawn prop exactly. |
| Tomb slots, `cargo` dressing (Sunken Bastion) | two standables per slot: crate/box stack OBB + barrel/keg circle | Stack (2.14/1.99) is a grab-and-climb; cask (1.70/1.85) vaults. The gap between them is now walkable, as drawn. |
| Tomb slots, temple altars | full-height (no dressing field) | Candle shrines are sacred, not furniture. |

## Instanced bands left flat by contract

Delves, the arena, and the Yumi maze keep flat floors and full-height wall
sets (their own `CLAUDE.md` contracts). KNOWN GAP: the delve finale rooms
draw the same dais platform visually but their floor stays flat; lifting it
means extending `dungeon_floor.ts` to the delve module frames, a follow-up.

## Forced movement obeys the same ladder

Heroic Leap's landing sweep re-resolves diverted points at the arc's crest
(takeoff feet + FLIGHT_APEX), so a canopy or crate stack under the crest is
flown over and landed ON (at its sampled sloped height), while a full-height
wall still ends the sweep at its face; knockback seats keep the mover's own
feet height and can never embed a body in a prop; warrior Charge requires
line of sight and paths around standable props at ground level (they are
walls to a runner). Pinned by `tests/physics_audit_interactions.test.ts`,
which also pins client-predictor parity inside dungeons, persistence on a
roof, and the step-smooth easing for the dais rim.

## Verification anchors

`tests/dungeon_parkour.test.ts` (dais walk/jump, coffin mantle, cargo climb,
temple walls, delve inertness), `tests/climb.test.ts` (roof reach pins, the
stall cone walk), `tests/parkour.test.ts` + `tests/physics_character.test.ts`
(the ladder itself), captures under `docs/screenshots/dungeon-parkour-roofs/`
and `docs/screenshots/ledge-climb-roofs/`.
