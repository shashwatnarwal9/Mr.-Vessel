import { useEffect, useMemo, useState } from "react";
import {
  loadCorridorRisks,
  newsSignalFromHeadlines,
  sanctionsSignalFromFleet,
  type CorridorRisk,
} from "../lib/risk";
import { annotateFleet, loadSanctionsIndex } from "../lib/sanctions";
import { useStore, type ShipFeature } from "../store";

/** Corridor risk with the LIVE signals substituted in — sanctions derived from
 *  the screened fleet, news from the headline feed. One shared source so the
 *  map and the risk panel can never disagree: the map used to paint the baked
 *  snapshot forever (Hormuz 15%) while the panel showed the live value (22%).
 *
 *  Same cited weights and the same prior; only a signal's VALUE is swapped. */
export function useLiveCorridorRisks(): {
  risks: CorridorRisk[];
  fleet: ShipFeature[];
} {
  const [base, setBase] = useState<CorridorRisk[]>([]);
  const [fleet, setFleet] = useState<ShipFeature[]>([]);
  const ships = useStore((s) => s.ships);
  const newsItems = useStore((s) => s.newsItems);

  useEffect(() => {
    loadCorridorRisks().then(setBase).catch(() => {});
  }, []);

  // annotate the fleet once the sanctions index is available
  useEffect(() => {
    if (!ships) return;
    let alive = true;
    loadSanctionsIndex()
      .then(({ idx }) => {
        if (alive) setFleet(annotateFleet(ships.features, idx).features);
      })
      .catch(() => setFleet(ships.features));
    return () => {
      alive = false;
    };
  }, [ships]);

  const risks = useMemo(() => {
    if (fleet.length === 0 && newsItems.length === 0) return base;
    return base.map((r) => {
      const liveSanctions = fleet.length
        ? sanctionsSignalFromFleet(r.corridor, fleet)
        : null;
      const liveNews = newsItems.length
        ? newsSignalFromHeadlines(r.corridor, newsItems)
        : null;
      if (!liveSanctions && !liveNews) return r;
      const contributions = r.contributions.map((x) => {
        const live =
          x.signal === "sanctions"
            ? liveSanctions
            : x.signal === "news"
              ? liveNews
              : null;
        if (!live) return x;
        // logOdds = weight x value; rescale to keep the same cited weight
        return {
          ...x,
          value: live.value,
          logOdds: (x.logOdds / Math.max(x.value, 1e-9)) * live.value,
          live: true,
        };
      });
      const logit0 = Math.log(r.corridor.p0 / (1 - r.corridor.p0));
      const x = logit0 + contributions.reduce((s, t) => s + t.logOdds, 0);
      return { ...r, p: 1 / (1 + Math.exp(-x)), contributions };
    });
  }, [base, fleet, newsItems]);

  return { risks, fleet };
}
