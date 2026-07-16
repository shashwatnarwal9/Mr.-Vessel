import { useMemo, useState } from "react";
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

  const reload = (r: SavedRun) => {
    const st = useStore.getState();
    st.setPi(r.disruptions.hormuz ?? 0);
    st.setDraftDisruption("redsea", r.disruptions.redsea ?? 0);
    st.setDraftDisruption("opec", r.disruptions.opec ?? 0);
    // ships are stored without live positions; reload keeps disruptions only
    st.setTab("Simulation Dashboard");
  };

  const toggleCompare = (id: number) =>
    setCompare((c) =>
      c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id],
    );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <PageIntro
          page="pastsims"
          intro="Every simulation you save lands here — reopen it, reload it into the dashboard, or compare two runs side by side."
          hint="Tick 'compare' on two runs to overlay their petrol-price and growth curves."
        />

        {runs.length === 0 && (
          <div className="rounded-xl border border-white/15 bg-white/10 p-8 text-center text-sm text-slate-400 backdrop-blur-md">
            No saved simulations yet — run one on the Simulation Dashboard and
            press 💾 Save.
          </div>
        )}

        <ul className="grid gap-3 md:grid-cols-2">
          {runs.map((r) => (
            <li
              key={r.id}
              className={`rounded-xl border p-4 backdrop-blur-md ${openId === r.id ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/15 bg-white/10"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">{r.name}</h3>
                  <p className="text-[11px] text-slate-400">
                    {new Date(r.ts).toLocaleString()} · {summary(r)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    deleteRun(r.id);
                    bump();
                  }}
                  aria-label={`Delete ${r.name}`}
                  className="rounded px-1.5 text-slate-500 hover:bg-white/10 hover:text-white"
                >
                  ×
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-100/90">{r.headline}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <button
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  className="rounded border border-white/15 bg-white/5 px-2 py-1 text-slate-200 hover:bg-white/10"
                >
                  {openId === r.id ? "hide graphs" : "view graphs"}
                </button>
                <button
                  onClick={() => reload(r)}
                  className="rounded border border-white/15 bg-white/5 px-2 py-1 text-slate-200 hover:bg-white/10"
                >
                  reload into dashboard
                </button>
                <label className="flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-slate-300">
                  <input
                    type="checkbox"
                    checked={compare.includes(r.id)}
                    onChange={() => toggleCompare(r.id)}
                  />
                  compare
                </label>
              </div>
            </li>
          ))}
        </ul>

        {open && (
          <div className="flex flex-col gap-4 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
            <h3 className="text-sm font-semibold text-white">{open.name}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {open.fanFuel.length > 0 ? (
                <FanChart
                  title="Petrol price (₹/L)"
                  bands={open.fanFuel}
                  color={BLUE}
                  format={(v) => `₹${v.toFixed(1)}`}
                  width={340}
                  height={150}
                />
              ) : (
                <TrajChart
                  title="Petrol price (₹/L)"
                  series={[{ name: open.name, color: BLUE, values: open.traj.fuel }]}
                  format={(v) => `₹${v.toFixed(1)}`}
                  width={340}
                  height={150}
                />
              )}
              {open.fanGdp.length > 0 ? (
                <FanChart
                  title="Growth impact (pp)"
                  bands={open.fanGdp}
                  color={RED}
                  format={(v) => v.toFixed(2)}
                  width={340}
                  height={150}
                />
              ) : (
                <TrajChart
                  title="Growth impact (pp)"
                  series={[{ name: open.name, color: RED, values: open.traj.gdp }]}
                  format={(v) => v.toFixed(2)}
                  width={340}
                  height={150}
                />
              )}
            </div>
          </div>
        )}

        {compared.length === 2 && (
          <div className="flex flex-col gap-4 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-4 backdrop-blur-md">
            <h3 className="text-sm font-semibold text-white">
              Compare: {compared[0].name} vs {compared[1].name}
            </h3>
            <TrajChart
              title="Petrol price (₹/L)"
              series={compared.map((r, i): TrajSeries => ({
                name: r.name,
                color: i === 0 ? BLUE : AQUA,
                values: r.traj.fuel,
              }))}
              format={(v) => `₹${v.toFixed(1)}`}
            />
            <TrajChart
              title="Growth impact (pp)"
              series={compared.map((r, i): TrajSeries => ({
                name: r.name,
                color: i === 0 ? BLUE : AQUA,
                values: r.traj.gdp,
              }))}
              format={(v) => v.toFixed(2)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
