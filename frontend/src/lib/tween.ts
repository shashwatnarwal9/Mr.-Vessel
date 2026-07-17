// M-COHESION animation tokens: value tweens ~400ms easeOutCubic, motion
// only on CHANGE; prefers-reduced-motion = instant set. Presentation only.
import { useEffect, useRef, useState } from "react";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Tween a displayed number to its new value. */
export function useTween(target: number, ms = 400): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced() || !isFinite(target)) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const val = from + (target - from) * ease(p);
      cur.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Elementwise tween of a numeric series — charts MORPH between states.
 *  `initial` (optional) seeds the first paint (e.g. fan bands collapsed
 *  to the median, so Monte Carlo bands visibly unfold on arrival).
 *  Length changes set instantly. */
export function useTweenArray(
  target: number[],
  ms = 400,
  initial?: number[],
): number[] {
  const [v, setV] = useState(
    initial && initial.length === target.length ? initial : target,
  );
  const cur = useRef(v);
  useEffect(() => {
    const from = cur.current;
    if (reduced() || from.length !== target.length) {
      cur.current = target;
      setV(target);
      return;
    }
    if (from.every((x, i) => x === target[i])) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = ease(p);
      const val = target.map((t2, i) => from[i] + (t2 - from[i]) * e);
      cur.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.join(","), ms]);
  return v;
}
