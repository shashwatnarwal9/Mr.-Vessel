# Changelog

All notable changes to Mr. Vessel. Newest first.

---

## v8 — FinOcean Maximus, live corridor risk, landing film

### Added

**FinOcean Maximus** — one page that composes a whole scenario, replacing the
separate Simulation Dashboard / Ship Simulator / War Cabinet tabs.

- "Load = commit": editing a card never changes what a run reads until you
  press Load, so every run is reproducible from the committed world state.
- Run mode derives from what's loaded (coupled / macro-only / ships-only).
- **Strategy Brief** sub-page: 90-day trajectories, suggested mitigation with a
  re-sourcing table, per-refinery run rates on a map of India, affected ships,
  and a "how to do better" summary composed from the same numbers.
- One **PDF report** for the whole scenario (pdf-lib + an embedded DejaVu
  subset, since the standard WinAnsi fonts cannot encode `₹`).

**War Cabinet** — now a slide-in chat rather than a page.

- FM / DM / PM replies grouped per prompt; transcript persists across reloads;
  past prompts browsable; clearable.
- Ministers receive the **full scenario** (import mix, interdicted volume,
  re-sourcing headroom, every affected vessel with route and effect) while the
  chat shows only a one-line label, so advice is specific without a wall of text.
- A run convenes the cabinet **in the background** and invites you in, instead
  of hijacking the screen.

**Landing** — a full-bleed film with the headline and three counters fading up
over it. The CTA surfaces 5s before the clip ends; 1.5s before the end the hero
hands off to the instrument on its own (once per session). Counters are read
from shipped data, not marketing figures.

**Past Simulations**

- Runs store the **full committed world**, so **Load again** restores the exact
  scenario ready to re-run (previously only disruptions were restored).
- Seeded with two engine-computed example runs so a first visit opens on a
  ready-made comparison.
- List and comparison are equally-sized scrollable cards.

**Knowledge graph** — Neo4j Browser port (7474) exposed alongside bolt, plus
seeding/verification in one command. `/kg/cascade` reports `mode: "live"` when
served from the graph and `"baked"` from the identical Python BFS.

### Changed

**Corridor risk now reacts to the news.** The `news` signal was a baked
snapshot that never moved, so 33 severity-5 headlines about active strikes on
Hormuz left its risk unchanged at ~15%. It is now derived live from the tagged
headline feed, with severity dominating volume (one CRITICAL report of shooting
near a strait says more about the next 30 days than five routine mentions).
Hormuz ~15% → **22%**, Bab el-Mandeb 44% → **47%** under a live war feed.

Same cited weights and the same prior — only a signal's *value* is swapped. The
speculation gate on closure detection is untouched: a *threat* to close a strait
still never reads as a closure, but it does raise the disruption probability,
which is a different question.

**Map and panel share one risk source.** `useLiveCorridorRisks()` — the map used
to paint the snapshot it read once at init and never refresh, so it disagreed
with the panel on screen.

**News feed** — Google News (India-positioned, `lr=en-IN`) is primary, with
GDELT and a Guardian 7-day backfill merged into a rolling, de-duplicated
**7-day window**. The Signals rail groups by day so you can scroll back a week.

**Simulation Dashboard / Ship Simulator** are now FinOcean sub-pages. The ship
result card commits directly (`LOAD SHIP → RUN`), and committed vessels are
listed in an "Affected ships · loaded" strip so nothing is a hidden input.

**Expert mode only** — the plain-English toggle is gone from the story banner.

**Cascade carousel** no longer auto-advances; step it with next/prev or ▶.

### Fixed

- **`<main>` could be scrolled programmatically.** It was `overflow-hidden`,
  which still creates a scroll container; the browser scrolled it 410px down and
  544px right on the landing → FinOcean transition, dragging the page content
  off-screen. Now `overflow-clip`, which creates no scroll container at all.
- An empty `h-full` sibling made `<main>` twice its own height on the FinOcean
  tab; the keyed view wrapper is no longer rendered there.
- **"edited · not loaded" appeared with no edit.** The dashboard card compared
  the committed shock against the live `pi`, which news-fusion drives on its
  own. It now reads SimDashboard's snapshot dirtiness.
- **Export PDF unlocked without a run** — cabinet selections persist across
  reloads, so a stale selection was enough. Now gated on a result too.
- Ship Simulator had two Load buttons; the header one is gone.
- Refinery count on the landing said 7; the real count is 6. It is now derived
  from `REFINERIES`, and the historical-shock count is asserted against the
  corpus in `history.test.ts`, so neither can drift from the data again.

### Removed

- `components/WarCabinet.tsx` (309 lines, orphaned by the chat panel) and the
  dead `loadSupplierRisks()` cluster in `lib/supplier.ts`.
- The plain-English mode and its store state.
- Result graphs from the FinOcean home (they live in the Strategy Brief).

---

## Earlier

See `PROGRESS.md` for the v1–v7 milestone history (core cascade, Monte Carlo,
sanctions screening, reroute solver, RAG analogs, knowledge graph, fusion).
