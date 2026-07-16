import { useState } from "react";
import Backtest from "./Backtest";

/** M9 v4: "Is this accurate?" — collapsible, with the council-mandated
 *  honest framing: the 2022 replay is CALIBRATION on an administered
 *  price episode, not out-of-sample validation. */
export default function ValidationPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-white/15 bg-white/10 backdrop-blur-md">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-white">
          Is this accurate? · the 2022 test
        </span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="mb-3 text-xs leading-relaxed text-slate-300">
            We replayed the real 2022 crude spike through this exact engine
            and compared it with actual Delhi pump prices.{" "}
            <span className="text-slate-400">
              Honest label: 2022 was a <em>policy-administered</em> episode
              (excise cuts, price freezes), and our policy-damping
              coefficient is calibrated on it — so this chart shows the
              model is <em>consistent with</em> history, not independently
              validated by it. An out-of-sample test (e.g. the 2019 Abqaiq
              attack) is on the roadmap.
            </span>
          </p>
          <Backtest />
        </div>
      )}
    </div>
  );
}
