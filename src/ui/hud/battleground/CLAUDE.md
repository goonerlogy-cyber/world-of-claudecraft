# HUD domain: battleground (Ravenrift)

The Ravenrift 5v5 capture-the-flag HUD surface. Two component pairs behind the
`index.ts` barrel, both composed by `Hud`:

- `battleground_window_view.ts` + `battleground_window.ts`: the queue window
  (#battleground-window, static markup in BOTH index.html and play.html). A cold
  sig-diffed innerHTML window in the `arena_window.ts` shape: standing, the
  queue/leave affordance, and the all-time board fetched best-effort from
  `GET /api/battleground/leaderboard`.
- `battleground_scoreboard_view.ts` + `battleground_scoreboard_painter.ts`: the
  in-match strip (#bg-scoreboard, self-mounted) plus the wave-respawn overlay
  (#bg-respawn) and spawn-protection line (#bg-protected). The `ValeCupHud`
  shape: structural sig gates the skeleton; every per-second value rides the
  PainterHost elided writers.

Rules that bind here: the pure cores are registered in `UI_PURE_CORES`
(tests/architecture.test.ts) and stay DOM/i18n-free; flag states and the
carrier marker are ACTIONABLE information and are never tier-gated (the
graphics-settings fairness invariant); one-shot juice (banners, audio) rides
the bg SimEvents in `hud.handleEvents`, never these models.
