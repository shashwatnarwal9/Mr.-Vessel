// π_fused via SSE. Backend absent → fused mode simply stays unavailable
// and the manual slider keeps working.
import { useEffect } from "react";
import { useStore } from "../store";

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";
const SSE_URL = API + "/sse/pi";
const BRENT_POLL_MS = 5 * 60_000; // the print moves slowly; don't hammer it

export function useFusionFeed() {
  const setFused = useStore((s) => s.setFused);
  const setBrentUsd = useStore((s) => s.setBrentUsd);

  useEffect(() => {
    const es = new EventSource(SSE_URL);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      setFused(d.pi_fused, d.confidence, d.driver ?? null);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [setFused]);

  // Live Brent → the corridor-risk MARKET signal. Guarded with a typeof check:
  // an error body has no `brent_usd` field at all, and a `!== null` test would
  // let undefined through into the model.
  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch(`${API}/market/brent`)
        .then((r) => r.json())
        .then((d) => {
          if (alive && typeof d.brent_usd === "number") setBrentUsd(d.brent_usd);
        })
        .catch(() => {}); // offline → the baked market snapshot stands
    pull();
    const t = setInterval(pull, BRENT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [setBrentUsd]);
}
