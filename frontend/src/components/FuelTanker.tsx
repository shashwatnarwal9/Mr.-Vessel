import type { Mix } from "../lib/coupled";
import type { Supplier } from "../lib/supplier";

/** Supply-mix tanker: a side-profile VLCC whose cargo holds fill as the
 *  import sliders move — each hold is one supplier, its width = share of
 *  the 100% mix. Purely presentational: reads the same suppliers/mix the
 *  sliders edit. Identity is never color-alone: every hold is labeled and
 *  the slider rows carry matching dots. */

// categorical hold palette (labeled everywhere it appears)
const HOLD_COLORS = [
  "#3987e5",
  "#199e70",
  "#e66767",
  "#c98500",
  "#8a63d2",
  "#22d3ee",
  "#d43d8f",
  "#7fb069",
  "#8792b8",
];
export const supplierColor = (i: number) => HOLD_COLORS[i % HOLD_COLORS.length];

// hull interior (the cargo space) in viewBox units
const HULL = { x: 56, y: 64, w: 500, h: 56 };

export default function FuelTanker({
  suppliers,
  mix,
}: {
  suppliers: Supplier[];
  mix: Mix;
}) {
  const total = suppliers.reduce((s, sp) => s + (mix[sp.id] ?? 0), 0);
  const over = total > 1.001;
  const under = total < 0.999;

  // stacked holds, clipped at 100% of the hull
  let acc = 0;
  const holds = suppliers.map((sp, i) => {
    const share = mix[sp.id] ?? 0;
    const x = HULL.x + Math.min(acc, 1) * HULL.w;
    const w = Math.max(0, Math.min(acc + share, 1) - Math.min(acc, 1)) * HULL.w;
    acc += share;
    return { id: sp.id, name: sp.name.split(" (")[0], share, x, w, color: supplierColor(i) };
  });

  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox="0 0 640 150"
        role="img"
        aria-label={`Import mix loaded onto the tanker: ${Math.round(total * 100)}% of capacity`}
        className="w-full"
      >
        {/* waterline */}
        <line x1="0" y1="132" x2="640" y2="132" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeDasharray="6 5" />
        {/* superstructure (aft) + funnel */}
        <rect x="500" y="30" width="44" height="32" rx="2" fill="#16205a" stroke="rgba(255,255,255,0.25)" />
        <rect x="508" y="38" width="8" height="4" fill="#8792b8" />
        <rect x="522" y="38" width="8" height="4" fill="#8792b8" />
        <rect x="546" y="22" width="12" height="40" rx="2" fill="#0a1033" stroke="rgba(255,255,255,0.25)" />
        {/* bow mast */}
        <line x1="70" y1="42" x2="70" y2="62" stroke="#8792b8" strokeWidth="2" />
        {/* hull */}
        <path
          d="M 36 62 L 596 62 L 620 84 L 588 128 L 52 128 L 24 84 Z"
          fill="#0a1033"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1.5"
        />
        {/* cargo holds (clipped to the tank space) */}
        <clipPath id="tanker-holds">
          <rect x={HULL.x} y={HULL.y} width={HULL.w} height={HULL.h} rx="6" />
        </clipPath>
        <g clipPath="url(#tanker-holds)">
          <rect x={HULL.x} y={HULL.y} width={HULL.w} height={HULL.h} fill="#0a0e17" />
          {holds.map((h) => (
            <g key={h.id}>
              <rect
                x={h.x}
                y={HULL.y}
                width={h.w}
                height={HULL.h}
                fill={h.color}
                opacity="0.85"
                style={{ transition: "x 300ms ease, width 300ms ease" }}
              >
                <title>{`${h.name} ${Math.round(h.share * 100)}%`}</title>
              </rect>
              {/* hold divider */}
              <line
                x1={h.x + h.w}
                y1={HULL.y}
                x2={h.x + h.w}
                y2={HULL.y + HULL.h}
                stroke="#0a0e17"
                strokeWidth="2"
                style={{ transition: "x1 300ms ease, x2 300ms ease" }}
              />
              {/* share tag inside the hold when it's wide enough */}
              {h.w > 34 && (
                <text
                  x={h.x + h.w / 2}
                  y={HULL.y + HULL.h / 2 + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill="#0a0e17"
                  style={{ transition: "x 300ms ease" }}
                >
                  {Math.round(h.share * 100)}%
                </text>
              )}
            </g>
          ))}
        </g>
        {/* capacity readout on deck */}
        <text x="40" y="52" fontSize="13" fontFamily="Courier Prime, monospace" fill={over || under ? "#e8871e" : "#4ade80"}>
          CARGO {Math.round(total * 100)}% {over ? "— OVERFILLED" : under ? "— UNDERFILLED" : "— FULL"}
        </text>
      </svg>
      <p className="caption text-ink-3">
        each hold = one supplier's share of the import mix; the hull is 100%
      </p>
    </div>
  );
}
