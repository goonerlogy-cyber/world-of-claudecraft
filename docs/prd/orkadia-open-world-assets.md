# Orkadia Open World asset generation report

Starting Tripo balance: 3850 credits (0 frozen)

Ending Tripo balance: 2660 credits (0 frozen)

| Name | Height | Prompt used | Concept image used | Job id | QA result | GLB byte size | Credit cost |
| --- | ---: | --- | --- | --- | --- | ---: | --- |
| orkadia_spiked_barricade | 2.2 | from provided concept image only | docs/screenshots/orkadia/concept/spiked-barricade.jpg | prop_orkadia_spiked_barricade_mrun772k | PASS | 55500 | 50 Tripo credits |
| orkadia_war_totem | 3.2 | from provided concept image only | docs/screenshots/orkadia/concept/orc-war-totem.jpg | prop_orkadia_war_totem_mruneeij | PASS | 74852 | 50 Tripo credits |
| orkadia_war_banner | 3.5 | from provided concept image only | docs/screenshots/orkadia/concept/orc-war-banner.jpg | prop_orkadia_war_banner_mrunjxjw | PASS | 59288 | 50 Tripo credits |
| orkadia_green_brazier | 1.6 | from provided concept image only | docs/screenshots/orkadia/concept/green-brazier.jpg | prop_orkadia_green_brazier_mrunnulk | PASS | 62064 | 50 Tripo credits |
| orkadia_skull_pile | 1.0 | from provided concept image only | docs/screenshots/orkadia/concept/skull-pile.jpg | prop_orkadia_skull_pile_mrunr2xp | PASS | 75952 | 50 Tripo credits |
| orkadia_weapon_rack | 2.0 | from provided concept image only | docs/screenshots/orkadia/concept/orc-weapon-rack.jpg | prop_orkadia_weapon_rack_mrunt60p | PASS | 63252 | 50 Tripo credits |
| orkadia_volcanic_cliff | 6.0 | from provided concept image only | docs/screenshots/orkadia/concept/volcanic-wall-texture.jpg | prop_orkadia_volcanic_cliff_mrunuog2 | PASS | 53812 | 50 Tripo credits |
| orkadia_war_gate | 7.0 | from provided concept image only | docs/screenshots/orkadia/concept/orkadia-portal-gate.jpg | prop_orkadia_war_gate_mrunwdqi | PASS | 59132 | 50 Tripo credits |
| orkadia_war_hall | 9.0 | from provided concept image only | docs/screenshots/orkadia/concept/war-hall-interior.jpg | prop_orkadia_war_hall_mrunxuu1 | PASS | 51588 | 50 Tripo credits |
| orkadia_skull_dais | 1.4 | from provided concept image only | docs/screenshots/orkadia/concept/dais-of-skulls.jpg | prop_orkadia_skull_dais_mrunzl23 | PASS | 63788 | 50 Tripo credits |
| orkadia_watchtower | 8.0 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_watchtower_mruo12dz | PASS | 67184 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_palisade | 3.0 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_palisade_mruo6yy8 | PASS | 61476 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_war_drum | 1.4 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_war_drum_mruocca7 | PASS | 63116 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_prisoner_cage | 2.6 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_prisoner_cage_mruohp77 | PASS | 66024 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_bone_throne | 2.8 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_bone_throne_mruon810 | PASS | 66576 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_torch_post | 2.4 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_torch_post_mruosijh | PASS | 55044 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_trophy_pole | 3.0 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_trophy_pole_mruox8wx | PASS | 62588 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_supply_crates | 1.2 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_supply_crates_mrup2ore | PASS | 61960 | 50 Tripo + 0.2115 USD (OpenAI concept) |

## Hard won notes
- QA initially reported no local preview rendering available for some early runs, which blocked PASS checks. The fix was to set `BROWSER_PATH` to a local Chromium binary and run `pipeline.mjs preview --file ... --out ...` before re-running QA.
- `orkadia_war_hall` was under the 40 KB minimum after first optimization. I regenerated it from the job raw GLB with `--texture-compress webp --compress meshopt --texture-size 512 --simplify-ratio 1` and replaced the applied GLB with the resulting file so it is now 51588 bytes.
- All props were verified as meshopt-compressed (no Draco extension detected) and all QA results are PASS.

## Applied summary
- Applied props: 18 out of 18 requested.
- Skipped props: none.
