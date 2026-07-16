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
        className="rounded border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/20"
      >
        ▶ Scenarios
      </button>
      {open && (
        <ul className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-white/15 bg-[#101624]/95 shadow-2xl backdrop-blur-md">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setOpen(false);
                  runPreset(p);
                }}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-white/10"
              >
                <span className="text-sm text-amber-100">{p.name}</span>
                <span className="text-[11px] text-slate-400">
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
