// FinOcean Maximus — one page, three cards, one exportable output.
//
// The wiring backbone is "Load = commit": a card opens its full sub-page (the
// existing dashboard / ship-simulator views, reused wholesale), and only LOAD
// writes into the shared world state. Editing a sub-page without loading never
// changes what a run reads, so the cards are always an honest picture of what
// will actually be simulated.
import { useEffect, useRef, useState } from "react";
import { useStore, type SimShip } from "../store";
import SimDashboard from "./SimDashboard";
import ShipSimulator from "./ShipSimulator";
import { simulate, type Trajectory } from "../lib/simulate";
import { aggregateShortfall, effectDelayDays } from "../lib/impact";
import { coupledShortfall, normalizeMix, optimizeMitigation } from "../lib/coupled";
import type { Supplier } from "../lib/supplier";
import type { PolicyLevers } from "../lib/runPlans";
import {
  buildFacts,
  parseCrisis,
  streamMinister,
  streamPM,
  type Advice,
} from "../lib/warCabinet";
import { saveRun } from "../lib/pastSims";
import { BASE } from "../lib/cascade";
import { buildFinOceanPdf } from "../lib/finoceanPdf";
import CabinetChat from "./CabinetChat";
import StrategyBrief, { HDR_LINK, Underline } from "./StrategyBrief";

// levers → plain-English recommendations for the PDF (no variable names, no
// raw weights — the action only, per the export's no-plumbing rule)
const LEVER_LABEL: Record<string, string> = {
  resource_reallocation: "Re-source crude from spare suppliers",
  opec_negotiation: "Negotiate OPEC+ output up",
  deescalation: "Open diplomacy to reopen the corridor",
  spr_release: "Draw the strategic petroleum reserve",
  naval_escort: "Escort Red Sea convoys",
};
function leverLabels(l: PolicyLevers | undefined): string[] {
  if (!l) return [];
  const out = Object.keys(LEVER_LABEL)
    .filter((k) => (l as Record<string, unknown>)[k])
    .map((k) => LEVER_LABEL[k]);
  if (l.escalation?.length) out.push("Escalate — a strike on the chokepoint");
  return out;
}
const EFFECT_LABEL: Record<string, string> = {
  closure: "chokepoint closed",
  sanction: "sanctioned — cargo halted",
  reroute: "rerouted",
  delay: "delayed",
};
/** first sentence, word-capped — how a minister Position is derived */
function firstSentence(s: string, n: number): string {
  const m = (s || "").match(/^.*?[.!?](\s|$)/);
  const w = (m ? m[0] : s).trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ") + "...";
}
const capWords = (s: string, n: number) => {
  const w = (s || "").trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ") + "...";
};
/** σ=0 peacetime reference the minister fact-sheet is measured against */
const REF = simulate({ disruptions: {} });

import { cleanProse as clean } from "../lib/ministerProse";

type Exchange = {
  id: number;
  prompt: string;
  fm: Advice | null;
  dm: Advice | null;
  pm: Advice | null;
  selected: boolean; // only selected exchanges reach the PDF
};

type Sub = "dashboard" | "ships" | "brief" | null;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Human summary of what a loaded card will contribute to the run. */
function shockSummary(d: { hormuz: number; redsea: number; opec: number }) {
  const on = [
    d.hormuz > 0 && `Hormuz ${pct(d.hormuz)}`,
    d.redsea > 0 && `Red Sea ${pct(d.redsea)}`,
    d.opec > 0 && `OPEC+ ${pct(d.opec)}`,
  ].filter(Boolean) as string[];
  return on.length ? on.join(" · ") : "no shock";
}

/** Status chip shared by both card shapes. */
function StatusChip({ loaded, stale }: { loaded: boolean; stale: boolean }) {
  return (
    <span
      className={`caption shrink-0 rounded-full border px-2 py-0.5 backdrop-blur-sm ${
        stale
          ? "border-elevated bg-navy-deep/70 text-elevated"
          : loaded
            ? "border-good/40 bg-good/20 text-good-text"
            : "border-hairline bg-navy-deep/70 text-ink-2"
      }`}
    >
      {stale ? "edited · not loaded" : loaded ? "loaded" : "not loaded"}
    </span>
  );
}

/** Full-bleed photo card: the title always reads (over a scrim), and hovering
 *  blurs the photo back so the detail + actions surface. The whole tile is the
 *  click target; CLEAR stops propagation so it doesn't also open the sub-page. */
function ImageCard({
  title, image, loaded, summary, stale, onOpen, onClear,
}: {
  title: string;
  image: string;
  loaded: boolean;
  summary: string;
  stale: boolean;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${title} — ${loaded ? "loaded" : "not loaded"}. Open to configure.`}
      className={`group relative h-52 cursor-pointer overflow-hidden rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
        loaded ? "border-secondary" : "border-hairline hover:border-secondary"
      }`}
    >
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:blur-[5px] motion-reduce:transform-none motion-reduce:transition-none"
      />
      {/* base scrim — the title must read against a bright photo */}
      <div className="absolute inset-0 bg-gradient-to-t from-navy-deep via-navy-deep/55 to-navy-deep/10" />
      {/* hover scrim — darkens further so the revealed copy is legible */}
      <div className="absolute inset-0 bg-navy-deep/60 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex h-full flex-col justify-end gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="headline-sm text-ink drop-shadow-lg">{title}</h2>
          <StatusChip loaded={loaded} stale={stale} />
        </div>
        {/* revealed on hover */}
        <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:max-h-40 group-hover:opacity-100 motion-reduce:max-h-40 motion-reduce:opacity-100">
          <p className="body-md text-ink-2">{summary}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="label-caps text-secondary">
              {loaded ? "EDIT" : "CONFIGURE"} →
            </span>
            {loaded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="label-caps text-ink-3 transition-colors hover:text-elevated"
              >
                CLEAR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Image action card — same footprint AND same hover animation as the
 *  dashboard/ship image cards (image blurs + scales, detail slides up on
 *  hover). For actions that open a panel/sub-page: War Cabinet, Strategy Brief. */
function ActionCard({
  title, icon, chipText, status, cta, onOpen, disabled, accent, image, imgPos,
}: {
  title: string;
  icon: string;
  chipText?: string;
  status: string;
  cta: string;
  onOpen: () => void;
  disabled?: boolean;
  accent?: boolean;
  image: string;
  imgPos?: string; // object-position tweak (e.g. centre the ship)
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={`${title} — ${cta}`}
      className={`group relative flex h-52 flex-col overflow-hidden rounded-lg border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:opacity-45 ${
        accent ? "border-secondary/60" : "border-hairline hover:border-secondary"
      }`}
    >
      <img
        src={image}
        alt=""
        aria-hidden="true"
        style={imgPos ? { objectPosition: imgPos } : undefined}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover brightness-[1.2] saturate-125 transition-all duration-300 group-hover:scale-105 group-hover:blur-[5px] motion-reduce:transform-none motion-reduce:transition-none"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-deep via-navy-deep/40 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-navy-deep/55 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex h-full flex-col justify-end gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="headline-sm flex items-center gap-2 text-ink drop-shadow-lg">
            <span className="material-symbols-outlined text-[20px] text-secondary">
              {icon}
            </span>
            {title}
          </h2>
          {chipText && (
            <span className="caption shrink-0 rounded-full border border-hairline bg-navy-deep/70 px-2 py-0.5 text-ink-2 backdrop-blur-sm">
              {chipText}
            </span>
          )}
        </div>
        {/* detail slides up on hover, exactly like the image cards */}
        <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:max-h-40 group-hover:opacity-100 motion-reduce:max-h-40 motion-reduce:opacity-100">
          <p className="body-md text-ink-2">{status}</p>
          <span className="label-caps mt-2 inline-flex items-center gap-1 text-secondary">
            {cta}
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </span>
        </div>
      </div>
    </button>
  );
}

export default function FinOcean() {
  const [sub, setSub] = useState<Sub>(null);
  const world = useStore((s) => s.world);
  const commitDashboard = useStore((s) => s.commitDashboard);
  const commitShips = useStore((s) => s.commitShips);
  const clearWorldCard = useStore((s) => s.clearWorldCard);
  const draft = useStore((s) => s.draft);
  // ---- sub-page back navigation (Back / Load / discard guard) ----
  const dashRef = useRef<{
    mix: Record<string, number>;
    disruptions: { hormuz: number; redsea: number; opec: number };
    dirty: boolean;
  }>({ mix: {}, disruptions: { hormuz: 0, redsea: 0, opec: 0 }, dirty: false });
  // "edited · not loaded" for the dashboard card: SimDashboard reports its own
  // snapshot-based dirtiness. We do NOT derive this from the live store shocks —
  // `pi` (Hormuz) is auto-driven by news-fusion, so comparing against it flipped
  // the card to "edited" with no user edit at all.
  const [dashDirty, setDashDirty] = useState(false);
  const shipsSnapRef = useRef<number[]>([]);
  const [confirmBack, setConfirmBack] = useState<(() => void) | null>(null);
  const confirmOpenRef = useRef(false);
  const [result, setResult] = useState<Trajectory | null>(null);
  // ---- War Cabinet (multi-prompt) ----
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [cabErr, setCabErr] = useState("");
  const [stream, setStream] = useState({ fm: "", dm: "", pm: "" });
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [showCabinetHint, setShowCabinetHint] = useState(false);
  const [pending, setPending] = useState(""); // the prompt currently streaming
  const [gateMsg, setGateMsg] = useState<string | null>(null); // "run first" card
  // conversation persists across reload (survives the session)
  const [exchanges, setExchanges] = useState<Exchange[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("mrvessel.cabinet.v1") ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mrvessel.cabinet.v1", JSON.stringify(exchanges));
    } catch {
      /* quota / private mode — the in-memory state still works */
    }
  }, [exchanges]);
  const [exporting, setExporting] = useState("");
  const bumpPastSims = useStore((s) => s.bumpPastSims);

  // suppliers power the coupled shortfall; absent (fetch failed) the run
  // degrades to the ship-only path rather than breaking
  const supRef = useRef<Supplier[]>([]);
  useEffect(() => {
    fetch("/supplier_dependency.json")
      .then((r) => r.json())
      .then((d) => {
        supRef.current = d.suppliers;
      })
      .catch(() => {});
  }, []);

  // dashboard "stale" = the user has pending edits in the editor (SimDashboard's
  // snapshot dirtiness), NOT autonomous fusion drift of the global shock slider.
  const dashStale = !!world.dashboard && dashDirty;
  // ships drift IS user-driven (draft only changes on add/remove), so a live
  // compare is safe here.
  const shipsStale =
    !!world.ships &&
    (world.ships.length !== draft.ships.length ||
      world.ships.some(
        (s, i) => s.props.mmsi !== draft.ships[i]?.props.mmsi,
      ));

  // ---- sub-page navigation ------------------------------------------------
  // ships dirtiness read live (draft lives in the store); dashboard dirtiness
  // is reported up by SimDashboard into dashRef.
  const shipsDirty = () => {
    const cur = useStore.getState().draft.ships.map((s) => s.props.mmsi);
    const snap = shipsSnapRef.current;
    return cur.length !== snap.length || cur.some((m, i) => m !== snap[i]);
  };
  // close the sub-page. fromPop = the browser already popped our guard entry,
  // so we must NOT call history.back() again (that would exit the app).
  const closeSub = (fromPop = false) => {
    confirmOpenRef.current = false;
    setConfirmBack(null);
    setSub(null);
    if (!fromPop) window.history.back();
  };
  const requestBack = (fromPop = false) => {
    if (confirmOpenRef.current) return; // guard already up
    // the brief is read-only → never dirty; only editors can have unsaved edits
    const dirty =
      sub === "ships"
        ? shipsDirty()
        : sub === "dashboard"
          ? dashRef.current.dirty
          : false;
    if (!dirty) {
      closeSub(fromPop);
      return;
    }
    if (fromPop) window.history.pushState({ finoceanSub: sub }, ""); // re-enter to stay
    confirmOpenRef.current = true;
    setConfirmBack(() => () => closeSub(false)); // Discard unwinds one history entry
  };
  const loadSub = () => {
    if (sub === "dashboard") {
      commitDashboard({ mix: dashRef.current.mix, disruptions: dashRef.current.disruptions });
      dashRef.current.dirty = false;
      setDashDirty(false); // committed → the card reads "loaded", not "edited"
    } else if (sub === "ships") commitShips([...useStore.getState().draft.ships]);
    closeSub(false);
  };

  // Esc + browser-back both route through requestBack so all three exits behave
  // identically. A guard history entry is pushed on open so the browser arrow
  // closes the sub-page instead of leaving the app.
  useEffect(() => {
    if (!sub) return;
    window.history.pushState({ finoceanSub: sub }, "");
    if (sub === "ships")
      shipsSnapRef.current = useStore.getState().draft.ships.map((s) => s.props.mmsi);
    if (sub === "dashboard") dashRef.current.dirty = false;
    const onPop = () => requestBack(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmOpenRef.current) {
          confirmOpenRef.current = false;
          setConfirmBack(null); // Esc in the confirm = keep editing
        } else requestBack(false);
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-line react-hooks/exhaustive-deps
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps

  // loadLabel null → no header LOAD (the ships page loads from its result card)
  const subHeader = (hint: string, loadLabel: string | null) => (
    // no bar: text sits straight on the page. A text-shadow keeps it legible
    // where content scrolls under the sticky row.
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 bg-transparent px-4 py-3 [text-shadow:0_1px_4px_rgba(0,0,0,.9)]">
      <button
        onClick={() => requestBack(false)}
        title="Back to FinOcean Maximus"
        className={`${HDR_LINK} text-ink-2 hover:text-ink`}
      >
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Back
        <Underline />
      </button>
      <span className="body-md hidden text-ink-3 md:block">{hint}</span>
      {loadLabel ? (
        <button
          onClick={loadSub}
          className={`${HDR_LINK} text-secondary hover:text-gold-hover`}
        >
          {loadLabel} →
          <Underline />
        </button>
      ) : (
        <span aria-hidden className="w-px" />
      )}
    </div>
  );

  const discardModal = confirmBack && (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-lg border border-hairline bg-panel p-5 shadow-2xl">
        <h3 className="headline-sm text-ink">Discard changes?</h3>
        <p className="body-md mt-1 text-ink-2">
          You have edits since the last Load. Go back without committing them?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => {
              confirmOpenRef.current = false;
              setConfirmBack(null);
            }}
            className="label-caps rounded border border-hairline px-3 py-2 text-ink-2 transition-colors hover:text-ink"
          >
            Keep editing
          </button>
          <button
            onClick={() => confirmBack()}
            className="label-caps rounded bg-critical px-3 py-2 text-ink transition-colors hover:bg-critical/80"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );

  if (sub === "dashboard") {
    return (
      // one continuous surface behind header + content, so the header row has
      // no seam behind it — the "bar" was the navy body showing through
      <div className="flex h-full flex-col">
        {subHeader("Set the import mix and the shock, then Load.", "LOAD")}
        <div className="min-h-0 flex-1 overflow-hidden">
          <SimDashboard
            initialMix={world.dashboard?.mix}
            onReport={(s) => {
              dashRef.current = {
                mix: s.mix,
                disruptions: {
                  hormuz: s.disruptions.hormuz ?? 0,
                  redsea: s.disruptions.redsea ?? 0,
                  opec: s.disruptions.opec ?? 0,
                },
                dirty: s.dirty,
              };
              setDashDirty(s.dirty); // drives the home card's "edited" chip
            }}
          />
        </div>
        {discardModal}
      </div>
    );
  }
  if (sub === "ships") {
    return (
      <div className="flex h-full flex-col">
        {subHeader(
          "Pick a ship, simulate it, then LOAD SHIP → RUN from the result.",
          null, // loads from the result card's LOAD SHIP → RUN button
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ShipSimulator onLoad={loadSub} />
        </div>
        {discardModal}
      </div>
    );
  }
  if (sub === "brief") {
    return (
      <StrategyBrief
        result={result}
        world={world}
        suppliers={supRef.current}
        onBack={() => requestBack(false)}
      />
    );
  }

  // ---- the single page ----------------------------------------------------
  const dashLoaded = !!world.dashboard;
  const shipsLoaded = !!world.ships && world.ships.length > 0;
  const canRun = dashLoaded || shipsLoaded;

  /** Run modes are a pure function of what's committed — no new math. The
   *  dashboard contributes the macro shock + coupled physical shortfall; the
   *  ships contribute their India-bound cargo loss. Both = they combine. */
  const runSimulation = async () => {
    const disruptions = world.dashboard?.disruptions ?? {
      hormuz: 0,
      redsea: 0,
      opec: 0,
    };
    const ships = world.ships ?? [];
    let physicalShortfallOverride: number | undefined;
    if (world.dashboard && supRef.current.length) {
      const norm = normalizeMix(world.dashboard.mix);
      physicalShortfallOverride = coupledShortfall(
        supRef.current,
        norm.mix,
        disruptions,
      ).shortfallBblPerDay;
    }
    // affected ships feed the shortfall BEFORE the trajectory is computed —
    // their India-bound cargo loss is part of the same engine input
    const traj = simulate({
      disruptions,
      shortfallBblPerDay: aggregateShortfall(ships),
      physicalShortfallOverride,
    });
    setResult(traj);

    // every run is filed in Past Simulations
    const dPump = traj.fuel_price[traj.fuel_price.length - 1] - BASE.pumpInrPerL;
    saveRun({
      id: Date.now(),
      name: `FinOcean — ${shockSummary(disruptions)}${ships.length ? ` · ${ships.length} ships` : ""}`,
      ts: new Date().toISOString(),
      disruptions,
      ships: ships.map((s) => ({
        mmsi: s.props.mmsi,
        name: s.props.name,
        type: s.props.type,
        effect: s.effect,
      })),
      headline: `Petrol ${dPump >= 0 ? "+" : ""}₹${dPump.toFixed(1)}/L at day 90; run-rate trough ${(Math.min(...traj.run_rate) * 100).toFixed(0)}%.`,
      traj: {
        fuel: traj.fuel_price,
        gdp: traj.gdp,
        run: traj.run_rate,
        stress: traj.power_stress,
      },
      fanFuel: [],
      fanGdp: [],
      // the exact committed world this run read — a click in Past Sims
      // re-loads it verbatim so the scenario is ready to run again
      world: { dashboard: world.dashboard, ships: world.ships },
    });
    bumpPastSims();

    // the cabinet auto-convenes on the run context (in the BACKGROUND — we don't
    // yank the chat open). A hint modal invites the user to open the War Cabinet
    // once they're ready; the deliberation is already streaming when they do.
    setShowCabinetHint(true);
    await convene(
      `Scenario ${exchanges.length + 1} on the table.`,
      scenarioContext(disruptions, ships, traj),
      disruptions,
      traj,
      false, // background convene — the hint modal opens the chat, not this
    );
  };

  /** The full scenario briefing the ministers READ: the shock, India's
   *  committed import mix, the interdicted volume, and every affected vessel
   *  with its route and effect. The chat only shows a one-line label, so this
   *  detail buys specific advice without a wall of text on screen. */
  const scenarioContext = (
    d: { hormuz: number; redsea: number; opec: number },
    ships: SimShip[],
    traj: Trajectory,
  ): string => {
    const L: string[] = [
      `SHOCK: ${shockSummary(d)}, over a ${traj.day.length}-day horizon.`,
    ];

    if (world.dashboard && supRef.current.length) {
      const mix = normalizeMix(world.dashboard.mix).mix;
      const named = Object.entries(mix)
        .map(([id, share]) => ({
          name: supRef.current.find((s) => s.id === id)?.name ?? id,
          share: share as number,
        }))
        .filter((m) => m.share > 0.005)
        .sort((a, b) => b.share - a.share);
      L.push(
        "INDIA CRUDE IMPORT MIX (as committed): " +
          named.map((m) => `${m.name} ${(m.share * 100).toFixed(0)}%`).join(", "),
      );
      const c = coupledShortfall(supRef.current, mix, d);
      L.push(
        `INTERDICTED SUPPLY: ${Math.round(c.shortfallBblPerDay / 1000)}k bbl/d before mitigation.`,
      );
      const m = optimizeMitigation(supRef.current, mix, d);
      if (m)
        L.push(
          `RE-SOURCING HEADROOM: spare capacity elsewhere cuts that to ${Math.round(m.after / 1000)}k bbl/d; the residual cannot be re-sourced within cited caps.`,
        );
    }

    if (ships.length) {
      L.push(`AFFECTED VESSELS (${ships.length}):`);
      for (const s of ships.slice(0, 8)) {
        const days = effectDelayDays(s.effect);
        const when =
          days === Infinity ? "cargo never arrives" : `+${Math.round(days)}d on its route`;
        L.push(
          `  - ${s.props.name} (${s.props.type}) bound for ${s.props.dest}: ${EFFECT_LABEL[s.effect.kind] ?? s.effect.kind}, ${when}`,
        );
      }
    } else {
      L.push("AFFECTED VESSELS: none loaded.");
    }

    L.push("Advise on this specific scenario.");
    return L.join("\n");
  };

  /** Shared cabinet path: RUN auto-convenes with the run context, and the
   *  chat box sends follow-ups. Same grounding either way.
   *
   *  The session is a CONVERSATION: prior turns are replayed into the crisis
   *  brief so ministers build on what was already decided instead of restarting
   *  cold each time. Capped at the last 3 turns and trimmed per reply — the
   *  whole transcript would blow the context and slow an already-queued model. */
  const convene = async (
    // `label` is what the transcript SHOWS (short); `context` is what the
    // ministers actually READ (the full scenario). Splitting them keeps the
    // chat readable while still briefing the models properly.
    label: string,
    context: string,
    d: { hormuz: number; redsea: number; opec: number },
    baseline: Trajectory,
    open = true, // RUN convenes in the background; the hint modal opens the chat
  ) => {
    setBusy(true);
    setCabErr("");
    setPending(label);
    if (open) setCabinetOpen(true); // surface the deliberation as it streams
    setStream({ fm: "", dm: "", pm: "" });
    try {
      const facts = buildFacts(d, baseline, REF);
      const prior = exchanges.slice(-3);
      const brief = prior.length
        ? "EARLIER IN THIS SESSION (oldest first) — build on it, don't repeat it:\n" +
          prior
            .map((e, i) => {
              const cut = (s?: string) => clean(s ?? "").slice(0, 320);
              return [
                `[${i + 1}] ASKED: ${e.prompt}`,
                e.fm?.pov && `    FM said: ${cut(e.fm.pov)}`,
                e.dm?.pov && `    DM said: ${cut(e.dm.pov)}`,
                e.pm?.pov && `    PM decided: ${cut(e.pm.pov)}`,
              ]
                .filter(Boolean)
                .join("\n");
            })
            .join("\n\n") +
          "\n\nNEW QUESTION: "
        : "";
      const crisis = brief + context;

      const [fm, dm] = await Promise.all([
        streamMinister("fm", crisis, facts, (t) =>
          setStream((s) => ({ ...s, fm: s.fm + t })),
        ),
        streamMinister("dm", crisis, facts, (t) =>
          setStream((s) => ({ ...s, dm: s.dm + t })),
        ),
      ]);
      const pm = await streamPM(crisis, facts, fm, dm, (t) =>
        setStream((s) => ({ ...s, pm: s.pm + t })),
      );
      // store the user's own words, not the replayed brief
      setExchanges((x) => [
        ...x,
        { id: Date.now(), prompt: label, fm, dm, pm, selected: true },
      ]);
    } catch (e) {
      setCabErr(
        `Cabinet unavailable (${String(e).slice(0, 80)}). The engine result is unaffected.`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** Convene the cabinet on a typed prompt. Grounding order: a committed
   *  dashboard shock wins; otherwise the prompt itself is parsed for one
   *  (speculation-gated upstream, so a threat contributes nothing). The
   *  ministers argue strategy — every number they're given is engine-computed. */
  const sendPrompt = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    let d = world.dashboard?.disruptions;
    if (!d) {
      const p = await parseCrisis(text);
      d = {
        hormuz: p.disruptions.hormuz ?? 0,
        redsea: p.disruptions.redsea ?? 0,
        opec: p.disruptions.opec ?? 0,
      };
    }
    const baseline =
      result ??
      simulate({
        disruptions: d,
        shortfallBblPerDay: aggregateShortfall(world.ships ?? []),
      });
    setPrompt("");
    // a typed question is shown verbatim, but the ministers still get the
    // committed scenario underneath it so follow-ups stay grounded
    await convene(
      text,
      `${text}\n\nSCENARIO CONTEXT:\n${scenarioContext(d, world.ships ?? [], baseline)}`,
      d,
      baseline,
    );
  };

  /** Export is gated on an explicit cabinet selection — the report is a
   *  deliberation document, not just charts. */
  const exportPdf = async () => {
    if (!selectedCount || exporting) return;
    setExporting("Rendering…");
    try {
      const d = world.dashboard?.disruptions ?? null;
      const modeLabel =
        dashLoaded && shipsLoaded
          ? "coupled"
          : dashLoaded
            ? "macro shock"
            : shipsLoaded
              ? "ship-level"
              : null;
      // mitigation numbers for the flow arrows (before/after re-sourcing)
      let mitigation: { before: number; after: number } | null = null;
      if (world.dashboard && supRef.current.length && d) {
        const m = optimizeMitigation(
          supRef.current,
          normalizeMix(world.dashboard.mix).mix,
          d,
        );
        mitigation = { before: m.before, after: m.after };
      }
      const ships = (world.ships ?? []).map((s) => ({
        name: s.props.name,
        effect: EFFECT_LABEL[s.effect.kind] ?? s.effect.kind,
        addedDays: s.effect.delayDays ?? null,
        sanctioned: !!s.props.sanction,
      }));
      const minister = (a: Advice | null, role: string) =>
        a
          ? {
              role,
              position: firstSentence(clean(a.pov), 18),
              recommends: leverLabels(a.levers).slice(0, 3),
            }
          : null;

      const blob = await buildFinOceanPdf({
        ts: new Date().toISOString().slice(0, 16).replace("T", " "),
        result,
        shocks: d,
        modeLabel,
        ships,
        mitigation,
        cabinet: exchanges
          .filter((e) => e.selected)
          .map((e) => ({
            prompt: e.prompt,
            fm: minister(e.fm, "Foreign Minister"),
            dm: minister(e.dm, "Defence Minister"),
            pmDecision: capWords(clean(e.pm?.pov ?? ""), 30),
          })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finocean-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setExporting("");
    } catch (e) {
      setExporting(`Export failed: ${String(e).slice(0, 70)}`);
    }
  };

  const selectedCount = exchanges.filter((e) => e.selected).length;
  // live stream first, then the last completed verdict
  const mode = dashLoaded && shipsLoaded
    ? "coupled — macro shock × ship effects"
    : dashLoaded
      ? "macro shock on the loaded mix"
      : shipsLoaded
        ? "ship-level effects only"
        : null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
        <div>
          <h1 className="headline-lg text-ink">FinOcean Maximus</h1>
          <p className="body-md text-ink-3">
            Load a shock, load ships, or neither — then convene the cabinet and
            export one report. Cards commit their values when you press Load.
          </p>
        </div>

        {/* INPUTS — the two editors */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ImageCard
            title="SIMULATION DASHBOARD"
            image="/crude-oil.jpg"
            loaded={dashLoaded}
            stale={dashStale}
            onOpen={() => setSub("dashboard")}
            onClear={() => clearWorldCard("dashboard")}
            summary={
              world.dashboard
                ? `Import mix set · ${shockSummary(world.dashboard.disruptions)}`
                : "India's oil-import mix and the Hormuz / Red Sea / OPEC+ shock. Not loaded — the run will ignore it."
            }
          />
          <ImageCard
            title="SHIP SIMULATOR"
            image="/tanker.jpg"
            loaded={shipsLoaded}
            stale={shipsStale}
            onOpen={() => setSub("ships")}
            onClear={() => clearWorldCard("ships")}
            summary={
              shipsLoaded
                ? `${world.ships!.length} vessel${world.ships!.length === 1 ? "" : "s"} affected — their India-bound cargo feeds the shortfall`
                : "Select vessels and apply closure / sanction / reroute / delay. Not loaded — the run will ignore them."
            }
          />
        </div>

        {/* RUN — sits between the inputs and the outputs */}
        <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="label-caps text-ink-3">RUN MODE</span>
              <p className="body-md mt-1 text-ink">
                {mode ??
                  "Nothing loaded — load a card, or send a cabinet prompt for a cabinet-only run."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void runSimulation()}
                disabled={!canRun || busy}
                title={
                  canRun
                    ? "Compute on the committed world state"
                    : "Load the dashboard or ships first"
                }
                className="label-caps flex items-center justify-center gap-2 rounded bg-secondary px-5 py-3 text-navy-deep transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                {busy ? "CONVENING CABINET…" : "RUN SIMULATION"}
              </button>
              <button
                onClick={() => void exportPdf()}
                // a run is required: cabinet selections persist across reloads,
                // so selectedCount alone could unlock export with no result
                disabled={!result || !selectedCount || !!exporting}
                title={
                  !result
                    ? "Run a simulation first — the report is built on its result"
                    : selectedCount
                      ? "Export the report as one PDF"
                      : "Select at least one cabinet response to export"
                }
                className="label-caps flex items-center justify-center gap-2 rounded border border-secondary px-5 py-3 text-secondary transition-colors hover:bg-secondary hover:text-navy-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                {exporting || "EXPORT PDF"}
              </button>
            </div>
          </div>
          {(!result || !selectedCount) && (
            <p className="caption text-ink-3">
              {!result
                ? "Export unlocks after you run a simulation and select a cabinet response."
                : "Export unlocks once a cabinet response is selected (in the chat)."}
            </p>
          )}
        </div>

        {/* OUTPUTS — the War Cabinet + Brief. Both unlock only after a run. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ActionCard
            title="WAR CABINET"
            icon="forum"
            chipText="strategic simulation"
            image="/india-navy.jpg"
            imgPos="center 30%"
            accent
            status={
              busy
                ? "Ministers are deliberating…"
                : exchanges.length
                  ? `${exchanges.length} turn${exchanges.length === 1 ? "" : "s"} in the thread`
                  : result
                    ? "Convene the Foreign, Defence and Prime Ministers on the result."
                    : "Run a simulation to convene the cabinet."
            }
            cta={
              exchanges.length || busy ? "OPEN CHAT" : "CONVENE — OPEN CHAT"
            }
            onOpen={() =>
              result || exchanges.length || busy
                ? setCabinetOpen(true)
                : setGateMsg(
                    "The cabinet convenes on a simulation result. Load the Simulation Dashboard (and/or Ship Simulator), then press Run Simulation.",
                  )
            }
          />
          <ActionCard
            title="STRATEGY BRIEF"
            icon="insights"
            image="/economy-growth.jpg"
            status={
              result
                ? "Suggested mitigation, per-refinery run-rates, affected ships, and how to do better."
                : "Run a simulation to unlock the brief."
            }
            cta="OPEN BRIEF"
            onOpen={() =>
              result
                ? setSub("brief")
                : setGateMsg(
                    "Load the Ship Simulator or Simulation Dashboard, then Run Simulation to see the brief.",
                  )
            }
          />
        </div>

      </div>

      {/* "run first" gate card for the output tiles */}
      {gateMsg && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setGateMsg(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border border-secondary bg-panel p-5 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">
                play_circle
              </span>
              <h3 className="headline-sm text-ink">No results yet</h3>
            </div>
            <p className="body-md mt-2 text-ink-2">{gateMsg}</p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setGateMsg(null)}
                className="label-caps rounded bg-secondary px-4 py-2 text-navy-deep transition-colors hover:bg-gold-hover"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* post-run hint: invite the user into the War Cabinet instead of
          yanking the chat open the moment the run finishes */}
      {showCabinetHint && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowCabinetHint(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-secondary bg-panel p-5 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">forum</span>
              <h3 className="headline-sm text-ink">Simulation ready</h3>
            </div>
            <p className="body-md mt-2 text-ink-2">
              Three AI ministers (Foreign, Defence, PM) are deliberating this
              scenario. A labelled strategic simulation.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCabinetHint(false)}
                className="label-caps rounded border border-hairline px-4 py-2 text-ink-2 transition-colors hover:text-ink"
              >
                Not now
              </button>
              <button
                onClick={() => {
                  setShowCabinetHint(false);
                  setCabinetOpen(true);
                }}
                className="label-caps flex items-center gap-1 rounded bg-secondary px-4 py-2 font-semibold text-navy-deep transition-colors hover:bg-gold-hover"
              >
                <span className="material-symbols-outlined text-[16px]">forum</span>
                Open War Cabinet →
              </button>
            </div>
          </div>
        </div>
      )}

      <CabinetChat
        open={cabinetOpen}
        onClose={() => setCabinetOpen(false)}
        exchanges={exchanges}
        busy={busy}
        stream={stream}
        pending={pending}
        cabErr={cabErr}
        prompt={prompt}
        setPrompt={setPrompt}
        onSend={() => void sendPrompt()}
        onToggleSelect={(id) =>
          setExchanges((xs) =>
            xs.map((x) => (x.id === id ? { ...x, selected: !x.selected } : x)),
          )
        }
        onClearHistory={() => {
          setExchanges([]); // the persist effect clears localStorage too
          setStream({ fm: "", dm: "", pm: "" });
          setPending("");
          setCabErr("");
        }}
      />
    </div>
  );
}
