// π_fused via SSE. Backend absent → fused mode simply stays unavailable
// and the manual slider keeps working.
import { useEffect } from "react";
import { useStore } from "../store";

const SSE_URL =
  (import.meta.env.VITE_API_HTTP ?? "http://localhost:8000") + "/sse/pi";

export function useFusionFeed() {
  const setFused = useStore((s) => s.setFused);

  useEffect(() => {
    const es = new EventSource(SSE_URL);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      setFused(d.pi_fused, d.confidence, d.driver ?? null);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [setFused]);
}
