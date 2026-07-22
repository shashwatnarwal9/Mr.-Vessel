import { useMemo, useState } from "react";
import { useTween } from "../lib/tween";
import { useStore } from "../store";
import { deleteRun, listRuns, type SavedRun } from "../lib/pastSims";
import TrajChart, { type TrajSeries } from "./TrajChart";
import FanChart from "./FanChart";
import PageIntro from "./PageIntro";

const BLUE = "#3987e5";
const RED = "#e66767";
const AQUA = "#199e70";

function summary(r: SavedRun): string {
  const d = Object.entries(r.disruptions)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`)
    .join(" + ");
  const s = r.ships.length ? `${r.ships.length} ship${r.ships.length > 1 ? "s" : ""}` : "";
  return [d, s].filter(Boolean).join(" · ") || "baseline";
}

export default function PastSims() {
  const version = useStore((s) => s.pastSimsVersion);
  const bump = useStore((s) => s.bumpPastSims);
  const runs = useMemo(() => listRuns(), [version]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [compare, setCompare] = useState<number[]>([]);

  const open = runs.find((r) => r.id === openId) ?? null;
  const compared = runs.filter((r) => compare.includes(r.id));
  // the right-hand card exists only when it has content to hold
  const showAnalysis = !!open || compared.length === 2;

  // M-COHESION delta diffing: compare = animated, labeled Δs (B vs A)
  const gdpMeanOf = (r: SavedRun) =>
    r.traj.gdp.reduce((a, b) => a + b, 0) / r.traj.gdp.length;
  const dPump = useTween(
    compared.length === 2
      ? compared[1].traj.fuel[89] - compared[0].traj.fuel[89]
      : 0,
  );
  const dGdp = useTween(
    compared.length === 2 ? gdpMeanOf(compared[1]) - gdpMeanOf(compared[0]) : 0,
  );

  const reload = (r: SavedRun) => {
    const st = useStore.getState();
    if (r.world) {
      // full re-load: mix + disruptions + ships (with positions) → ready to RUN
      st.loadRunWorld(r.world);
    } else {
      // legacy run (saved before the world field): disruptions only
      st.setPi(r.disruptions.hormuz ?? 0);
      st.setDraftDisruption("redsea", r.disruptions.redsea ?? 0);
      st.setDraftDisruption("opec", r.disruptions.opec ?? 0);
    }
    st.setTab("FinOcean Maximus");
  };

  const toggleCompare = (id: number) =>
    setCompare((c) =>
      c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id],
    );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="headline-lg text-ink">Past Simulations</h1>
          <PageIntro
            page="pastsims"
            intro="Every simulation you save lands here — reopen it, reload it into the dashboard, or compare two runs side by side."
            hint="Tick 'compare' on two runs to overlay their petrol-price and growth curves."
          />
        </div>

        {runs.length === 0 && (
          <div className="body-md rounded-lg border border-hairline bg-panel p-8 text-center text-ink-3">
            No saved simulations yet — run one on the Simulation Dashboard and
            press Save.
          </div>
        )}

        <div
          className={`grid grid-cols-1 gap-6 lg:items-stretch ${
            showAnalysis ? "lg:grid-cols-2" : ""
          }`}
        >
          {/* cards column — one scrollable card so many runs don't stack down
              the page; stretches to match the comparison panel's height */}
          <div className="min-h-0 overflow-y-auto rounded-lg border border-hairline bg-panel/40 p-3 lg:max-h-[calc(100vh_-_12rem)]">
          <ul className="flex flex-col gap-4">
            {runs.map((r) => {
              const active = Object.values(r.disruptions).some((v) => (v ?? 0) > 0);
              const selected = openId === r.id;
              return (
                <li
                  key={r.id}
                  className={`group flex flex-col gap-2 rounded-lg bg-panel p-4 transition-colors ${
                    selected
                      ? "border-2 border-secondary"
                      : "border border-hairline hover:border-secondary"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="headline-sm flex items-center gap-2 text-ink">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${active ? "bg-elevated" : "bg-good"}`}
                        />
                        {r.name}
                      </h3>
                      <div className="micro-mono mt-1 text-ink-3">
                        {new Date(r.ts).toLocaleString()} · {summary(r)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          checked={compare.includes(r.id)}
                          onChange={() => toggleCompare(r.id)}
                          className="h-4 w-4 rounded-sm border-hairline bg-navy-deep accent-[#ffb956]"
                        />
                        <span className="label-caps text-ink-3 transition-colors group-hover:text-ink">
                          Compare
                        </span>
                      </label>
                      <button
                        onClick={() => {
                          deleteRun(r.id);
                          bump();
                        }}
                        aria-label={`Delete ${r.name}`}
                        className="rounded px-1.5 text-ink-3 hover:text-ink"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <p
                    className={`body-md mt-1 ${active ? "text-elevated" : "text-ink-2"}`}
                  >
                    {r.headline}
                  </p>
                  <div
                    className={`mt-2 flex gap-2 transition-opacity ${
                      selected ? "" : "opacity-50 group-hover:opacity-100"
                    }`}
                  >
                    <button
                      onClick={() => setOpenId(selected ? null : r.id)}
                      className="label-caps flex items-center gap-1 rounded border border-hairline bg-transparent px-2 py-1 text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        bar_chart
                      </span>
                      {selected ? "Hide Graphs" : "View Graphs"}
                    </button>
                    <button
                      onClick={() => reload(r)}
                      title="Load this run's full scenario and open FinOcean, ready to run"
                      className="label-caps flex items-center gap-1 rounded bg-secondary px-2 py-1 font-semibold text-navy-deep transition-colors hover:bg-secondary/85"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        bolt
                      </span>
                      Load again
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>

          {/* analysis / compare column — SAME card wrapper as the list, so the
              two columns are structurally identical boxes and always match.
              Rendered ONLY when it has something to show; with nothing open or
              compared there is no empty box at all. */}
          {showAnalysis && (
          <div className="min-h-0 overflow-y-auto rounded-lg border border-hairline bg-panel/40 p-3 lg:max-h-[calc(100vh_-_12rem)]">
            <div className="flex flex-col gap-4">
            {open && (
              <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-panel p-4">
                <h4 className="label-caps mb-1 text-ink-3">
                  Single Run Analysis: {open.name}
                </h4>
                <div className="relative overflow-hidden rounded border border-hairline bg-dim p-2">
                  {open.fanFuel.length > 0 ? (
                    <FanChart
                      title="Petrol price (₹/L)"
                      bands={open.fanFuel}
                      color={BLUE}
                      format={(v) => `₹${v.toFixed(1)}`}
                      width={440}
                      height={130}
                    />
                  ) : (
                    <TrajChart
                      title="Petrol price (₹/L)"
                      series={[{ name: open.name, color: BLUE, values: open.traj.fuel }]}
                      format={(v) => `₹${v.toFixed(1)}`}
                      width={440}
                      height={130}
                    />
                  )}
                </div>
                <div className="relative overflow-hidden rounded border border-hairline bg-dim p-2">
                  {open.fanGdp.length > 0 ? (
                    <FanChart
                      title="Growth impact (pp)"
                      bands={open.fanGdp}
                      color={RED}
                      format={(v) => v.toFixed(2)}
                      width={440}
                      height={130}
                    />
                  ) : (
                    <TrajChart
                      title="Growth impact (pp)"
                      series={[{ name: open.name, color: RED, values: open.traj.gdp }]}
                      format={(v) => v.toFixed(2)}
                      width={440}
                      height={130}
                    />
                  )}
                </div>
              </div>
            )}

            {compared.length === 2 && (
              <div className="relative overflow-hidden rounded-lg border border-secondary bg-panel p-4">
                <div className="pointer-events-none absolute inset-0 bg-gold-wash" />
                <div className="relative z-10 flex flex-col gap-2">
                  <h4 className="label-caps mb-2 border-b border-hairline pb-1 text-secondary">
                    Compare: {compared[0].name} vs {compared[1].name}
                  </h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`micro-mono rounded px-2 py-1 ${dPump > 0.05 ? "bg-critical/20 text-critical-text" : dPump < -0.05 ? "bg-good/20 text-good-text" : "bg-bright text-ink-2"}`}
                    >
                      petrol Δ {dPump > 0 ? "+" : ""}₹{dPump.toFixed(1)}/L
                    </span>
                    <span
                      className={`micro-mono rounded px-2 py-1 ${dGdp < -0.05 ? "bg-critical/20 text-critical-text" : dGdp > 0.05 ? "bg-good/20 text-good-text" : "bg-bright text-ink-2"}`}
                    >
                      growth Δ {dGdp > 0 ? "+" : ""}{dGdp.toFixed(2)} pp
                    </span>
                    <span className="caption text-ink-3">
                      {compared[1].name} vs {compared[0].name}
                    </span>
                  </div>
                  <div className="rounded border border-hairline bg-dim p-2">
                    <TrajChart
                      title="Petrol price (₹/L)"
                      series={compared.map((r, i): TrajSeries => ({
                        name: r.name,
                        color: i === 0 ? BLUE : AQUA,
                        values: r.traj.fuel,
                      }))}
                      format={(v) => `₹${v.toFixed(1)}`}
                      width={440}
                      height={180}
                    />
                  </div>
                  <div className="rounded border border-hairline bg-dim p-2">
                    <TrajChart
                      title="Growth impact (pp)"
                      series={compared.map((r, i): TrajSeries => ({
                        name: r.name,
                        color: i === 0 ? BLUE : AQUA,
                        values: r.traj.gdp,
                      }))}
                      format={(v) => v.toFixed(2)}
                      width={440}
                      height={180}
                    />
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
