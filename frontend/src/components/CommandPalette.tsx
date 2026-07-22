import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Tab } from "../store";
import { PRESETS } from "../lib/presets";
import { runPreset } from "./PresetMenu";
import { loadCorridorRisks, type CorridorRisk } from "../lib/risk";
import {
  gotoCorridor,
  gotoPlant,
  gotoShip,
  loadPlants,
  type PlantFeature,
} from "../lib/navigate";

/** M-COHESION ⌘K command palette: fuzzy-jump to any ship/plant/corridor,
 *  run any scenario preset, switch views, toggle context layers — fully
 *  keyboard-operable. No command-bar framework; state + a subsequence
 *  scorer. Presentation/navigation only. */

type Item = {
  kind: "view" | "preset" | "toggle" | "ship" | "plant" | "corridor";
  icon: string;
  label: string;
  sub: string;
  run: () => void;
};

// subsequence fuzzy score: -1 = no match; contiguity scores higher
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 0;
  let i = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const j = s.indexOf(ch, i);
    if (j < 0) return -1;
    streak = j === i ? streak + 2 : 1;
    score += streak;
    i = j + 1;
  }
  return score + (s.startsWith(q) ? 10 : 0);
}

const VIEWS: Tab[] = ["Command Map", "FinOcean Maximus", "Past Simulations"];

export default function CommandPalette({
  enterCommand,
}: {
  enterCommand: (t?: Tab) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [plants, setPlants] = useState<PlantFeature[]>([]);
  const [corridors, setCorridors] = useState<CorridorRisk[]>([]);
  const ships = useStore((s) => s.ships);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // global hotkey: Ctrl/⌘ + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // lazy entity data, fetched once on first open
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (plants.length === 0) loadPlants().then(setPlants).catch(() => {});
    if (corridors.length === 0)
      loadCorridorRisks().then(setCorridors).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setOpen(false);

  const items: Item[] = useMemo(() => {
    if (!open) return [];
    const st = useStore.getState();
    const actions: Item[] = [
      ...VIEWS.map((t): Item => ({
        kind: "view",
        icon: "grid_view",
        label: t,
        sub: "switch view",
        run: () => enterCommand(t),
      })),
      ...PRESETS.map((p): Item => ({
        kind: "preset",
        icon: "play_arrow",
        label: p.name,
        sub: `run scenario · σ → ${p.sigma}`,
        run: () => {
          enterCommand("Command Map");
          runPreset(p);
        },
      })),
      ...(["israel", "egypt"] as const).map((c): Item => ({
        kind: "toggle",
        icon: "layers",
        label: `Toggle ${c[0].toUpperCase()}${c.slice(1)} context layer`,
        sub: st.contextLayers[c] ? "currently ON" : "currently OFF",
        run: () => useStore.getState().toggleContextLayer(c),
      })),
      ...corridors.map((r): Item => ({
        kind: "corridor",
        icon: "explore",
        label: r.corridor.name,
        sub: `corridor · ${(r.p * 100).toFixed(0)}% / 30d`,
        run: () => {
          enterCommand("Command Map");
          gotoCorridor(r.corridor.id, r.corridor.centroid);
        },
      })),
    ];
    const shipItems: Item[] = (ships?.features ?? []).map((f) => ({
      kind: "ship" as const,
      icon: "directions_boat",
      label: f.properties.name,
      sub: `ship · ${f.properties.type} · MMSI ${f.properties.mmsi}`,
      run: () => {
        enterCommand("Command Map");
        gotoShip(f.properties, f.geometry.coordinates);
      },
    }));
    const plantItems: Item[] = plants.map((f) => ({
      kind: "plant" as const,
      icon: "bolt",
      label: f.properties.name,
      sub: `plant · ${f.properties.primary_fuel} · ${f.properties.capacity_mw} MW`,
      run: () => {
        enterCommand("Command Map");
        gotoPlant(f.properties, f.geometry.coordinates);
      },
    }));

    if (!q.trim()) {
      // empty query: suggested actions (views + presets + corridors)
      return actions.slice(0, 10);
    }
    return [...actions, ...shipItems, ...plantItems]
      .map((it) => ({ it, s: fuzzy(q.trim(), it.label) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map((x) => x.it);
  }, [open, q, ships, plants, corridors, enterCommand]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;

  const exec = (it: Item) => {
    close();
    it.run();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={close}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-navy-deep/70 pt-[15vh] backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[36rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4">
          <span className="material-symbols-outlined text-[18px] text-secondary">
            terminal
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
                listRef.current?.children[
                  Math.min(active + 1, items.length - 1)
                ]?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
                listRef.current?.children[Math.max(active - 1, 0)]?.scrollIntoView(
                  { block: "nearest" },
                );
              } else if (e.key === "Enter" && items[active]) {
                exec(items[active]);
              }
            }}
            placeholder="Jump to a ship, plant, corridor… or run a scenario"
            aria-label="Command palette search"
            className="body-md h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
          <span className="caption shrink-0 rounded border border-hairline px-1.5 py-0.5 text-ink-3">
            esc
          </span>
        </div>
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="body-md px-4 py-3 text-ink-3">no matches</li>
          )}
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.label}`}>
              <button
                onClick={() => exec(it)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                  i === active ? "bg-gold-wash" : ""
                }`}
              >
                <span className="material-symbols-outlined text-[16px] text-ink-3">
                  {it.icon}
                </span>
                <span className="body-md flex-1 truncate text-ink">
                  {it.label}
                </span>
                <span className="micro-mono shrink-0 text-ink-3">{it.sub}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="caption flex items-center gap-4 border-t border-hairline px-4 py-1.5 text-ink-3">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
