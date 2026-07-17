import { useState } from "react";

// dataviz tokens
const INK_MUTED = "#8792b8";
const GRID = "rgba(255,255,255,0.12)";

export type TrajSeries = { name: string; color: string; values: number[] };

type Props = {
  title: string;
  series: TrajSeries[]; // equal lengths
  format: (v: number) => string;
  width?: number;
  height?: number;
};

/** Multi-line trajectory chart: one line per simulation, legend +
 *  end labels (identity never color-alone), crosshair on hover. */
export default function TrajChart({
  title,
  series,
  format,
  width = 560,
  height = 200,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const PAD = { l: 44, r: 70, t: 10, b: 20 };
  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const n = series[0]?.values.length ?? 0;
  if (n === 0) return null;

  const all = series.flatMap((s) => s.values);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (i / (n - 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * ih;

  return (
    <figure className="m-0">
      {title && (
        <figcaption className="label-caps mb-1 text-ink-3">{title}</figcaption>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={title || series.map((s) => s.name).join(", ")}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - PAD.l) / iw) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[lo, hi].map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={4} y={y(v) + 3} fontSize={12} fill={INK_MUTED}>
              {format(v)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
            />
            <text
              x={x(n - 1) + 5}
              y={y(s.values[n - 1]) + 3}
              fontSize={12}
              fill="#ffffff"
            >
              {s.name}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={height - 4} fontSize={12} fill={INK_MUTED}>
          d 0
        </text>
        <text x={PAD.l + iw} y={height - 4} fontSize={12} fill={INK_MUTED} textAnchor="end">
          d {n - 1}
        </text>
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke={INK_MUTED} />
            <text x={x(hover) < width / 2 ? x(hover) + 6 : x(hover) - 6} y={PAD.t + 10} fontSize={12} fill="#ffffff" textAnchor={x(hover) < width / 2 ? "start" : "end"}>
              d {hover}:{" "}
              {series.map((s) => `${s.name} ${format(s.values[hover])}`).join(" · ")}
            </text>
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={3} fill={s.color} stroke="#0a0e17" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      <div className="micro-mono mt-1 flex flex-wrap items-center gap-3 text-ink-3">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </figure>
  );
}
