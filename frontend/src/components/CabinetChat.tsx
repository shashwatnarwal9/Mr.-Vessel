// War Cabinet — slide-in scrollable chat panel (M-CABINET-CHAT).
//
// Reuses the existing cabinet logic entirely (convene/sendPrompt/exchanges live
// in FinOcean and come in as props). This is a presentation + interaction
// surface only: a right-edge panel that slides in, a scrollable conversation
// with grouped FM/DM/PM turns, a pinned composer, and per-turn export
// selection. No change to model routing or reasoning.
import { useEffect, useLayoutEffect, useRef } from "react";
import { CABINET_MARK, ROLE_META, type MinisterKey } from "../lib/cabinetBrands";
import { cleanProse as clean } from "../lib/ministerProse";
import type { Advice } from "../lib/warCabinet";

export type Exchange = {
  id: number;
  prompt: string;
  fm: Advice | null;
  dm: Advice | null;
  pm: Advice | null;
  selected: boolean;
};

const ORDER: MinisterKey[] = ["fm", "dm", "pm"];

/** small provider chip: the brand logo + role, shown on each minister reply */
function Chip({ role }: { role: MinisterKey }) {
  const m = CABINET_MARK[role];
  return (
    <span className="flex items-center gap-1.5">
      <span className="label-caps text-secondary">{ROLE_META[role].title}</span>
      <img
        src={m.src}
        alt={m.alt}
        title={m.title}
        className={`${m.chip} w-auto object-contain opacity-80`}
      />
    </span>
  );
}

function ReplyBlock({ role, adv, live }: { role: MinisterKey; adv: Advice | null; live?: string }) {
  const text = live !== undefined ? clean(live) : clean(adv?.pov ?? "");
  const source = adv?.source === "glm-fallback";
  return (
    <div className="rounded-lg border border-hairline bg-navy-deep p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Chip role={role} />
        {source && (
          <span
            className="caption rounded-full border border-elevated/50 px-1.5 text-elevated"
            title="this minister's own endpoint was unavailable; answered by the fallback model"
          >
            fallback
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
        {text ||
          (live !== undefined ? (
            <span className="text-ink-3">…deliberating</span>
          ) : adv?.error ? (
            <span className="text-elevated">No response available</span>
          ) : (
            <span className="text-ink-3">No response available</span>
          ))}
        {live !== undefined && text && <span className="animate-pulse">▋</span>}
      </p>
    </div>
  );
}

export default function CabinetChat({
  open,
  onClose,
  exchanges,
  busy,
  stream,
  pending,
  cabErr,
  prompt,
  setPrompt,
  onSend,
  onToggleSelect,
  onClearHistory,
}: {
  open: boolean;
  onClose: () => void;
  exchanges: Exchange[];
  busy: boolean;
  stream: { fm: string; dm: string; pm: string };
  pending: string;
  cabErr: string;
  prompt: string;
  setPrompt: (s: string) => void;
  onSend: () => void;
  onToggleSelect: (id: number) => void;
  onClearHistory?: () => void;
}) {
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const selectedCount = exchanges.filter((e) => e.selected).length;

  // track whether the user is at the bottom (so streaming doesn't yank them
  // while they read history)
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // auto-scroll to newest only when already at the bottom
  useLayoutEffect(() => {
    if (atBottomRef.current)
      endRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }, [exchanges.length, stream.fm, stream.dm, stream.pm, busy, open, reduceMotion]);

  // Esc closes; focus the composer on open; light focus-trap on Tab
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => taRef.current?.focus(), reduceMotion ? 0 : 200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'button, textarea, input, [tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, reduceMotion]);

  const jumpTo = (id: number) => {
    document
      .getElementById(`cab-turn-${id}`)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* scrim */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/55 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="War Cabinet chat"
        className={`absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col border-l border-hairline bg-panel shadow-2xl transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(.22,.9,.35,1)] will-change-transform motion-reduce:transition-opacity motion-reduce:duration-150 ${
          open
            ? "translate-x-0 opacity-100"
            : "translate-x-full opacity-0 motion-reduce:translate-x-0"
        }`}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-secondary">
              forum
            </span>
            <h2 className="headline-sm text-ink">War Cabinet</h2>
            <span className="caption rounded-full border border-hairline px-2 py-0.5 text-ink-3">
              strategic simulation
            </span>
          </div>
          <div className="flex items-center gap-2">
            {exchanges.length > 1 && (
              <select
                onChange={(e) => e.target.value && jumpTo(Number(e.target.value))}
                value=""
                aria-label="Jump to a past prompt"
                className="micro-mono max-w-[150px] rounded border border-hairline bg-navy-deep px-1.5 py-1 text-ink-2 focus:border-secondary focus:outline-none"
              >
                <option value="">History…</option>
                {exchanges.map((e, i) => (
                  <option key={e.id} value={e.id}>
                    #{i + 1} {e.prompt.slice(0, 34)}
                  </option>
                ))}
              </select>
            )}
            {exchanges.length > 0 && onClearHistory && (
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear the whole cabinet transcript? This cannot be undone.",
                    )
                  )
                    onClearHistory();
                }}
                aria-label="Clear chat history"
                title="Clear chat history"
                className="material-symbols-outlined rounded-full border border-hairline p-1 text-[18px] text-ink-3 transition-colors hover:border-critical hover:text-critical-text"
              >
                delete_sweep
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close cabinet chat"
              className="material-symbols-outlined rounded-full border border-hairline p-1 text-[18px] text-ink-2 transition-colors hover:border-secondary hover:text-ink"
            >
              close
            </button>
          </div>
        </div>

        {/* conversation */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        >
          <p className="caption text-ink-3">
            A labelled war-game of role-based reasoning — never speech attributed
            to real officials.
          </p>

          {exchanges.length === 0 && !busy && (
            <div className="flex flex-col gap-2">
              {ORDER.map((role) => (
                <div
                  key={role}
                  className="rounded-lg border border-hairline bg-navy-deep p-3"
                >
                  <Chip role={role} />
                  <p className="caption text-ink-3">{ROLE_META[role].mandate}</p>
                  <p className="mt-1 text-[13px] text-ink-3">awaiting a prompt…</p>
                </div>
              ))}
            </div>
          )}

          {exchanges.map((ex, i) => (
            <div key={ex.id} id={`cab-turn-${ex.id}`} className="flex flex-col gap-2">
              {/* user prompt */}
              <div className="flex items-start justify-between gap-2">
                <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-secondary/15 px-3 py-2">
                  <span className="micro-mono mr-1 text-ink-3">#{i + 1}</span>
                  <span className="text-[13px] text-ink">{ex.prompt}</span>
                </div>
              </div>
              {ORDER.map((role) => (
                <ReplyBlock key={role} role={role} adv={ex[role]} />
              ))}
              <label className="flex cursor-pointer items-center gap-2 self-end">
                <input
                  type="checkbox"
                  checked={ex.selected}
                  onChange={() => onToggleSelect(ex.id)}
                  className="accent-[#c98500]"
                />
                <span className="caption text-ink-3">include in PDF</span>
              </label>
            </div>
          ))}

          {/* live streaming turn */}
          {busy && (
            <div className="flex flex-col gap-2">
              <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-secondary/15 px-3 py-2">
                <span className="text-[13px] text-ink">{pending}</span>
              </div>
              {ORDER.map((role) => (
                <ReplyBlock key={role} role={role} adv={null} live={stream[role]} />
              ))}
            </div>
          )}

          {cabErr && <p className="text-[13px] text-elevated">⚠ {cabErr}</p>}
          <div ref={endRef} />
        </div>

        {/* composer (pinned) */}
        <div className="border-t border-hairline p-3">
          {exchanges.length > 0 && (
            <p className="caption mb-1 text-ink-3">
              {selectedCount} of {exchanges.length} selected · ministers see the
              last 3 turns
            </p>
          )}
          <div className="flex gap-2">
            <textarea
              ref={taRef}
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSend()
              }
              disabled={busy}
              placeholder="Ask the cabinet — e.g. 'Iran mines Hormuz; hold petrol under ₹120?'"
              className="flex-1 rounded border border-hairline bg-navy-deep p-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-secondary focus:outline-none"
            />
            <button
              onClick={onSend}
              disabled={busy || !prompt.trim()}
              className="label-caps rounded bg-secondary px-4 text-navy-deep transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
