import { backtest2022 } from "../lib/backtest";
import Why from "./Why";

// dataviz: two series → legend + direct labels (dark slots 1 & 2 are in
// the CVD floor band, so direct labels are mandatory, not optional)
const MODEL_COLOR = "#3987e5";
const ACTUAL_COLOR = "#199e70";
const INK_MUTED = "#8792b8";
const GRID = "rgba(255,255,255,0.12)";

export default function Backtest() {
  const { months, modelled, actual, matchPct } = backtest2022();
  const W = 480;
  const H = 200;
  const PAD = { l: 40, r: 60, t: 12, b: 22 };
  const all = [...modelled, ...actual];
  const yMin = Math.min(...all) - 2;
  const yMax = Math.max(...all) + 2;
  const x = (i: number) => PAD.l + (i / 11) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const line = (vs: number[]) => vs.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <div className="rounded-xl border border-white/10 bg-panel/90 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-white">
          2022 backtest · modelled vs actual pump price
        </h2>
        <span className="text-lg font-semibold text-white">
          {matchPct.toFixed(1)}% match
          <Why
            tag="derived"
            formula="100 − MAPE(modelled vs actual Delhi EOM petrol, 2022); modelled = Dec-21 base + Δ Brent × pass-through × policy damping — same engine as the live panels"
            sources={["pass_through_inr_per_usd_bbl", "policy_pass_through"]}
          />
        </span>
      </div>
      <svg width={W} height={H} role="img" aria-label={`2022 backtest: ${matchPct.toFixed(1)} percent match between modelled and actual Delhi pump price`}>
        {[yMin + 2, yMax - 2].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={4} y={y(v) + 3} fontSize={12} fill={INK_MUTED}>₹{v.toFixed(0)}</text>
          </g>
        ))}
        {[0, 5, 11].map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize={12} fill={INK_MUTED} textAnchor="middle">
            {months[i]}
          </text>
        ))}
        <polyline points={line(modelled)} fill="none" stroke={MODEL_COLOR} strokeWidth={2} />
        <polyline points={line(actual)} fill="none" stroke={ACTUAL_COLOR} strokeWidth={2} />
        <text x={x(11) + 5} y={y(modelled[11]) + 3} fontSize={12} fill="#e5e9f0">
          modelled
        </text>
        <text x={x(11) + 5} y={y(actual[11]) + 3} fontSize={12} fill="#e5e9f0">
          actual
        </text>
      </svg>
      <div className="caption mt-1 flex items-center gap-4 text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: MODEL_COLOR }} /> modelled (pass-through)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: ACTUAL_COLOR }} /> actual (Delhi EOM)
        </span>
      </div>
      <p className="body-md mt-2 leading-snug text-ink-2">
        Gap in May–Dec is real policy, not model noise: the May 2022 excise cut
        and the OMC retail price freeze held pumps at ₹96.72 while crude stayed
        elevated.
      </p>
    </div>
  );
}
