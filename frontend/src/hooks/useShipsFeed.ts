// Ships transport: WebSocket (the one real-time stream) with static
// ships.json fallback — backend down or absent never breaks the demo.
import { useEffect } from "react";
import { useStore, type ShipsFC } from "../store";

const WS_URL =
  import.meta.env.VITE_API_WS ?? "ws://localhost:8000/ws/ships";

export function useShipsFeed() {
  const setShips = useStore((s) => s.setShips);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    const fallback = () =>
      fetch("/ships.json")
        .then((r) => r.json())
        .then((fc: ShipsFC) => {
          if (!closed) setShips(fc, "baked");
        })
        .catch(() => {});

    try {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => setShips(JSON.parse(e.data), "live");
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
