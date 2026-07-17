import { useState } from "react";
import { PRESETS, RAMP_INTERVAL_MS, RAMP_STEPS, type Preset } from "../lib/presets";
import { mapHandle } from "../lib/mapHandle";
import { useStore } from "../store";

let rampTimer: ReturnType<typeof setInterval> | null = null;

export function runPreset(p: Preset) {
  const s = useStore.getState();
  s.setTab("Command Map");
  s.setPiMode("manual");
  s.setPi(0);
  s.setActiveScenario(p.scenario);
  s.setActiveZone(p.zoneName);
  s.setNarrative(`${p.name} — ${p.narrative}`);
  mapHandle.current?.flyTo({ ...p.camera, duration: 2500 });
  if (rampTimer) clearInterval(rampTimer);
  let t = 0;
  rampTimer = setInterval(() => {
    t += 1;
    useStore.getState().setPi(Math.min(p.sigma, (t / RAMP_STEPS) * p.sigma));
    if (t >= RAMP_STEPS && rampTimer) clearInterval(rampTimer);
  }, RAMP_INTERVAL_MS);
}

export default function PresetMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="label-caps flex items-center gap-1 rounded bg-secondary px-4 py-2 font-bold text-navy transition-colors hover:bg-gold-hover"
      >
        <span>▶</span> Scenarios
      </button>
      {open && (
        <ul className="absolute right-0 top-full z-30 mt-1 w-64 rounded border border-hairline bg-navy-deep shadow-2xl">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setOpen(false);
                  runPreset(p);
                }}
                className="flex w-full flex-col px-3 py-2 text-left transition-colors hover:bg-gold-wash"
              >
                <span className="body-md text-ink">{p.name}</span>
                <span className="micro-mono text-ink-3">
                  σ → {p.sigma} · {p.mode}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
