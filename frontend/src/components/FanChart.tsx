import { useState } from "react";
import type { Band } from "../lib/montecarlo";

// palette.md dark-mode chrome tokens
const INK_MUTED = "#8792b8";
const GRID = "rgba(255,255,255,0.12)";

type Props = {
  title: string;
  bands: Band[];
  color: string; // validated series hue
  format: (v: number) => string;
  width?: number;
  height?: number;
  unit?: string; // x-axis unit label
};

export default function FanChart({
  title,
  bands,
  color,
  format,
  width = 260,
  height = 96,
  unit = "d",
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const PAD = { l: 6, r: 56, t: 6, b: 16 };
  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;

  const lo = Math.min(...bands.map((b) => b.p5));
  const hi = Math.max(...bands.map((b) => b.p95));
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (i / (bands.length - 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * ih;

  // forward top edge, then reversed bottom edge
  const area = (loKey: keyof Band, hiKey: keyof Band) =>
    [
      ...bands.map((b, i) => `${x(i)},${y(b[hiKey])}`),
      ...bands.map((_, i) => {
        const j = bands.length - 1 - i;
        return `${x(j)},${y(bands[j][loKey])}`;
      }),
    ].join(" ");

  const median = bands.map((b, i) => `${x(i)},${y(b.p50)}`).join(" ");
  const last = bands[bands.length - 1];
  const h = hover === null ? null : bands[hover];

  return (
    <figure className="m-0">
      {title && (
        <figcaption className="label-caps mb-0.5 text-ink-3">{title}</figcaption>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title || "fan chart"}: median ${format(last.p50)} at ${unit} ${bands.length - 1}, 90% band ${format(last.p5)} to ${format(last.p95)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(
            ((e.clientX - r.left - PAD.l) / iw) * (bands.length - 1),
          );
          setHover(Math.max(0, Math.min(bands.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* hairline grid: min / max (index key — lo===hi when data is flat) */}
        {[lo, hi].map((v, i) => (
          <line key={i} x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
        ))}
        <polygon points={area("p5", "p95")} fill={color} opacity={0.14} />
        <polygon points={area("p25", "p75")} fill={color} opacity={0.28} />
        <polyline points={median} fill="none" stroke={color} strokeWidth={2} />
        {/* direct label: end median (ink token, not series color) */}
        <text x={x(bands.length - 1) + 4} y={y(last.p50) + 3} fontSize={12} fill="#ffffff">
          {format(last.p50)}
        </text>
        <text x={PAD.l} y={height - 3} fontSize={12} fill={INK_MUTED}>
          {unit} 0
        </text>
        <text x={PAD.l + iw} y={height - 3} fontSize={12} fill={INK_MUTED} textAnchor="end">
          {unit} {bands.length - 1}
        </text>
        {hover !== null && h && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke={INK_MUTED} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.p50)} r={3} fill={color} stroke="#0a0e17" strokeWidth={1.5} />
            <text
              x={hover < bands.length / 2 ? x(hover) + 6 : x(hover) - 6}
              y={PAD.t + 10}
              fontSize={12}
              fill="#ffffff"
              textAnchor={hover < bands.length / 2 ? "start" : "end"}
            >
              {unit} {hover}: {format(h.p50)} ({format(h.p5)}–{format(h.p95)})
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
