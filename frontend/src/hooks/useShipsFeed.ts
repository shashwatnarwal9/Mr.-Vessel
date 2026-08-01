// Ships transport: WebSocket (the one real-time stream) with static
// ships.json fallback — backend down or absent never breaks the demo.
import { useEffect } from "react";
import { useStore, type ShipsFC } from "../store";

// VITE_API_WS is an ORIGIN (render.yaml sets it without a path), so the route
// is appended here — same shape as VITE_API_HTTP everywhere else. Baking the
// path into the fallback instead made this work locally and fail only on
// deploy, where the socket hit the bare origin and fell back to ships.json.
const WS_URL =
  (import.meta.env.VITE_API_WS ?? "ws://localhost:8000") + "/ws/ships";

// A berth is on land, so moored vessels render as ships sitting on the quay.
// Measured 235 of 400. A corridor map wants vessels under way.
const UNDER_WAY_KN = 0.5;

const underWay = (fc: ShipsFC): ShipsFC => ({
  ...fc,
  features: fc.features.filter((f) => (f.properties.speed ?? 0) >= UNDER_WAY_KN),
});

export function useShipsFeed() {
  const setShips = useStore((s) => s.setShips);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    const fallback = () =>
      fetch("/ships.json")
        .then((r) => r.json())
        .then((fc: ShipsFC) => {
          if (!closed) setShips(underWay(fc), "baked");
        })
        .catch(() => {});

    try {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => setShips(underWay(JSON.parse(e.data)), "live");
      ws.onerror = () => fallback();
      ws.onclose = (e) => {
        if (!e.wasClean) fallback();
      };
    } catch {
      fallback();
    }

    return () => {
      closed = true;
      ws?.close();
    };
  }, [setShips]);
}
