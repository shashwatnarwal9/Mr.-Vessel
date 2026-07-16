import { mcBands } from "../lib/montecarlo";
import type { SimInput } from "../lib/simulate";

self.onmessage = (e: MessageEvent<{ input: SimInput; runs: number }>) => {
  const { input, runs } = e.data;
  self.postMessage(mcBands(input, runs));
};
