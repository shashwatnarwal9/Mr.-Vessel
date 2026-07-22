// FinOcean Maximus — the single exported output (M-PDF2).
//
// A TWO-PAGE continuous report. Design goals: minimal text, diagrams carry the
// logic, every number traces to the engine. Charts are drawn as VECTORS from
// the trajectory arrays (not rasterised) so they are crisp at any zoom, on a
// light background, with >=8pt axis labels. Nothing here changes a computed
// value — it is a layout of values produced elsewhere.
//
// The rupee sign forces a real Unicode font: pdf-lib's StandardFonts are
// WinAnsi and cannot encode U+20B9. We embed a subset DejaVu Sans (has the
// glyph) via fontkit; if that fetch ever fails we fall back and downgrade the
// symbol so the export still succeeds.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Trajectory } from "./simulate";
import { BASE } from "./cascade";

const A4: [number, number] = [595, 842];
const M = 40; // ~14mm margin, held constant
const W = A4[0] - M * 2;

const NAVY = rgb(0.05, 0.07, 0.12);
const INK = rgb(0.12, 0.14, 0.2);
const MUTED = rgb(0.45, 0.49, 0.58);
const AMBER = rgb(0.79, 0.52, 0);
const RED = rgb(0.82, 0.23, 0.23);
const GREEN = rgb(0.1, 0.62, 0.44);
const RULE = rgb(0.85, 0.87, 0.91);
const PANEL = rgb(0.955, 0.965, 0.98);
const WHITE = rgb(1, 1, 1);

// characters our subset font can draw; anything else is normalised or dropped
// so embedFont never throws on an odd glyph from a model reply
const SAFE = /[^\x20-\x7E ©₹–—‘’“”•→≈×]/g;
function safe(s: string): string {
  return (s || "")
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(SAFE, "");
}

/** Cap to N words, adding an ellipsis only if we actually cut. */
function words(s: string, n: number): string {
  const w = safe(s).trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ") + "…".replace("…", "...");
}

// ---- 90-day windows, collapsed to <=3 meaningful rows -----------------------
export function ninetyDayRows(t: Trajectory) {
  const base = BASE.pumpInrPerL;
  const n = t.fuel_price.length;
  // six raw 15-day windows first
  const raw = Array.from({ length: 6 }, (_, i) => {
    const a = Math.min(i * 15, n - 1);
    const b = Math.min(a + 14, n - 1);
    return {
      a,
      b,
      d0: t.fuel_price[a] - base,
      d1: t.fuel_price[b] - base,
      runLow: Math.min(...t.run_rate.slice(a, b + 1)) * 100,
    };
  });
  // merge consecutive windows whose end-delta barely moves (< Rs 1.5/L)
  const merged: (typeof raw)[number][][] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(w.d1 - last[last.length - 1].d1) < 1.5) last.push(w);
    else merged.push([w]);
  }
  // keep at most 3 rows: fold the middle groups together if we have >3
  while (merged.length > 3) {
    // find the adjacent pair with the smallest delta change and merge it
    let best = 1,
      bestDiff = Infinity;
    for (let i = 1; i < merged.length; i++) {
      const diff = Math.abs(
        merged[i][merged[i].length - 1].d1 - merged[i - 1][merged[i - 1].length - 1].d1,
      );
      if (diff < bestDiff) (bestDiff = diff), (best = i);
    }
    merged[best - 1] = merged[best - 1].concat(merged[best]);
    merged.splice(best, 1);
  }
  return merged.map((g, i) => {
    const first = g[0];
    const last = g[g.length - 1];
    const runLow = Math.min(...g.map((w) => w.runLow));
    const rising = last.d1 > first.d0 + 0.5;
    const easing = last.d1 < first.d0 - 0.5;
    return {
      window: `Day ${first.a}-${last.b + 1}`,
      pump: `${fmtR(first.d0)} -> ${fmtR(last.d1)}`,
      run: `${runLow.toFixed(0)}%`,
      note:
        i === 0
          ? "Stocks absorb the hit; price spikes first."
          : easing
            ? "Re-sourcing bites; the overshoot eases."
            : rising
              ? "Buffer draws down; pressure still building."
              : "Settled level holds; run-rate binds.",
    };
  });
}

// number formatters (₹ added by the caller via rupee())
const n0 = (v: number) => Math.round(v).toLocaleString("en-IN");
function fmtR(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

// ---- document context -------------------------------------------------------
type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  uni: boolean; // did the Unicode font load? (₹ vs Rs)
  pages: number;
};

const rupee = (c: Ctx, s: string) => (c.uni ? `₹${s}` : `Rs ${s}`);

function addPage(c: Ctx) {
  c.page = c.doc.addPage(A4);
  c.y = A4[1] - M;
  c.pages += 1;
}
function need(c: Ctx, h: number) {
  if (c.y - h < M + 8) addPage(c);
}
function wrap(s: string, f: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(s).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}
function draw(
  c: Ctx,
  s: string,
  { size = 9.5, color = INK, bold = false, x = M, width = W, gap = 3.5 } = {},
) {
  const f = bold ? c.bold : c.font;
  for (const line of wrap(s, f, size, width)) {
    need(c, size + gap);
    c.page.drawText(line, { x, y: c.y - size, size, font: f, color });
    c.y -= size + gap;
  }
}
/** Amber-rule section header with consistent space above → shared rhythm. */
function section(c: Ctx, label: string) {
  c.y -= 14;
  need(c, 22);
  c.page.drawRectangle({ x: M, y: c.y - 2, width: 22, height: 3, color: AMBER });
  c.page.drawText(safe(label), { x: M + 28, y: c.y - 8, size: 11, font: c.bold, color: NAVY });
  c.y -= 18;
}

// ---- vector line chart (light bg, crisp, self-annotating) -------------------
function chart(
  c: Ctx,
  x: number,
  top: number,
  w: number,
  h: number,
  o: {
    title: string;
    values: number[];
    unit: (v: number) => string;
    color: typeof RED;
    baseline?: number;
  },
) {
  const p = c.page;
  const padL = 34,
    padR = 40,
    padT = 16,
    padB = 14;
  p.drawRectangle({ x, y: top - h, width: w, height: h, color: WHITE, borderColor: RULE, borderWidth: 0.8 });
  p.drawText(safe(o.title), { x: x + 8, y: top - 12, size: 8.5, font: c.bold, color: NAVY });

  const vals = o.values;
  const lo = Math.min(...vals, o.baseline ?? Infinity);
  const hi = Math.max(...vals, o.baseline ?? -Infinity);
  const span = hi - lo || 1;
  const gx = x + padL,
    gw = w - padL - padR,
    gy = top - h + padB,
    gh = h - padT - padB;
  const px = (i: number) => gx + (i / (vals.length - 1)) * gw;
  const py = (v: number) => gy + ((v - lo) / span) * gh;

  // y-axis min / max labels (>=8pt)
  p.drawText(safe(o.unit(hi)), { x: x + 5, y: py(hi) - 3, size: 8, font: c.font, color: MUTED });
  p.drawText(safe(o.unit(lo)), { x: x + 5, y: py(lo) - 3, size: 8, font: c.font, color: MUTED });

  // baseline (peacetime) as a faint dashed reference
  if (o.baseline !== undefined) {
    p.drawLine({
      start: { x: gx, y: py(o.baseline) },
      end: { x: gx + gw, y: py(o.baseline) },
      thickness: 0.6,
      color: RULE,
      dashArray: [2, 2],
    });
  }
  // the series
  for (let i = 1; i < vals.length; i++) {
    p.drawLine({
      start: { x: px(i - 1), y: py(vals[i - 1]) },
      end: { x: px(i), y: py(vals[i]) },
      thickness: 1.3,
      color: o.color,
    });
  }
  // final value annotated at the line end
  const endV = vals[vals.length - 1];
  p.drawText(safe(o.unit(endV)), {
    x: gx + gw + 3,
    y: py(endV) - 3,
    size: 8,
    font: c.bold,
    color: o.color,
  });
}

// ---- flow diagram (boxes + amber arrows; optional label on each arrow) ------
function flow(c: Ctx, steps: string[], arrows: string[] = []) {
  const gap = 20;
  const w = (W - gap * (steps.length - 1)) / steps.length;
  const h = 30;
  need(c, h + 14);
  const top = c.y;
  steps.forEach((s, i) => {
    const x = M + i * (w + gap);
    c.page.drawRectangle({ x, y: top - h, width: w, height: h, color: PANEL, borderColor: AMBER, borderWidth: 0.9 });
    wrap(s, c.bold, 7.5, w - 8)
      .slice(0, 2)
      .forEach((ln, li) =>
        c.page.drawText(ln, { x: x + 5, y: top - 13 - li * 9, size: 7.5, font: c.bold, color: NAVY }),
      );
    if (i < steps.length - 1) {
      const ax = x + w + 4,
        ay = top - h / 2,
        aw = gap - 8;
      c.page.drawLine({ start: { x: ax, y: ay }, end: { x: ax + aw, y: ay }, thickness: 1.1, color: AMBER });
      c.page.drawLine({ start: { x: ax + aw - 3, y: ay + 3 }, end: { x: ax + aw, y: ay }, thickness: 1.1, color: AMBER });
      c.page.drawLine({ start: { x: ax + aw - 3, y: ay - 3 }, end: { x: ax + aw, y: ay }, thickness: 1.1, color: AMBER });
      if (arrows[i]) {
        const t = safe(arrows[i]);
        const tw = c.font.widthOfTextAtSize(t, 6.5);
        c.page.drawText(t, { x: ax + aw / 2 - tw / 2, y: ay + 4, size: 6.5, font: c.font, color: MUTED });
      }
    }
  });
  c.y = top - h - 6;
}

// ---- public input shape -----------------------------------------------------
export type MinisterBlock = { role: string; position: string; recommends: string[] } | null;
export type CabinetTurn = { prompt: string; fm: MinisterBlock; dm: MinisterBlock; pmDecision: string };
export type ShipRow = { name: string; effect: string; addedDays: number | null; sanctioned: boolean };
export type MitigationNums = { before: number; after: number } | null;

export type ExportInput = {
  ts: string;
  result: Trajectory | null;
  shocks: { hormuz: number; redsea: number; opec: number } | null;
  modeLabel: string | null; // "coupled" | "macro shock" | "ship-level" | null
  ships: ShipRow[];
  mitigation: MitigationNums;
  cabinet: CabinetTurn[]; // selected turns; index 0 full, rest one-line
  mapDataUrl?: string | null;
};

export async function buildFinOceanPdf(input: ExportInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  let font: PDFFont, bold: PDFFont, uni: boolean;
  try {
    const [r, b] = await Promise.all([
      fetch("/fonts/DejaVuSans.ttf").then((x) => x.arrayBuffer()),
      fetch("/fonts/DejaVuSans-Bold.ttf").then((x) => x.arrayBuffer()),
    ]);
    font = await doc.embedFont(r, { subset: true });
    bold = await doc.embedFont(b, { subset: true });
    uni = true;
  } catch {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
    uni = false;
  }
  const c: Ctx = { doc, page: doc.addPage(A4), y: A4[1] - M, font, bold, uni, pages: 1 };
  const t = input.result;
  const last = (a: number[]) => a[a.length - 1];

  // ── header band ────────────────────────────────────────────────────────
  c.page.drawRectangle({ x: 0, y: A4[1] - 58, width: A4[0], height: 58, color: NAVY });
  c.page.drawText("FinOcean Maximus", { x: M, y: A4[1] - 34, size: 22, font: bold, color: WHITE });
  c.page.drawText(safe(`India oil-disruption simulation  ·  Calibrated ${input.ts} UTC`), {
    x: M,
    y: A4[1] - 48,
    size: 8.5,
    font,
    color: rgb(0.68, 0.72, 0.82),
  });
  c.y = A4[1] - 72;

  // scenario as chips
  const chips = input.shocks
    ? [
        `Hormuz ${Math.round(input.shocks.hormuz * 100)}%`,
        `Red Sea ${Math.round(input.shocks.redsea * 100)}%`,
        `OPEC+ ${Math.round(input.shocks.opec * 100)}%`,
        `${input.ships.length} vessels`,
        input.modeLabel ?? "",
      ].filter(Boolean)
    : ["Cabinet advisory only"];
  let cx = M;
  need(c, 20);
  for (const chip of chips) {
    const tw = font.widthOfTextAtSize(safe(chip), 8) + 12;
    c.page.drawRectangle({ x: cx, y: c.y - 14, width: tw, height: 14, color: PANEL, borderColor: RULE, borderWidth: 0.7 });
    c.page.drawText(safe(chip), { x: cx + 6, y: c.y - 10.5, size: 8, font: c.font, color: INK });
    cx += tw + 6;
  }
  c.y -= 22;

  if (!t) {
    // cabinet-only path → a clean single page (no empty charts)
    section(c, "No simulation run — cabinet advisory only");
    renderCabinet(c, input.cabinet);
    provenance(c);
    return finalize(doc);
  }

  // ── the verdict (largest body text) ────────────────────────────────────
  const dPump = last(t.fuel_price) - BASE.pumpInrPerL;
  const peak = Math.max(...t.fuel_price) - BASE.pumpInrPerL;
  const runLow = Math.min(...t.run_rate) * 100;
  const gdpMean = t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length;
  draw(c, verdict(input.shocks, dPump, gdpMean, c), { size: 15, bold: true, color: NAVY, gap: 5 });

  // ── at a glance ────────────────────────────────────────────────────────
  section(c, "AT A GLANCE");
  kpi(c, [
    { label: "PETROL DAY 90", value: `${rupee(c, fmtR(dPump))}/L`, tone: dPump > 0 ? RED : GREEN },
    { label: "PEAK", value: `${rupee(c, fmtR(peak))}/L`, tone: RED },
    { label: "RUN-RATE LOW", value: `${runLow.toFixed(0)}%`, tone: runLow < 95 ? RED : GREEN },
    { label: "GDP", value: `${gdpMean.toFixed(1)} pp`, tone: gdpMean < 0 ? RED : GREEN },
  ]);

  // ── the four charts (2x2, vector, light) ───────────────────────────────
  section(c, "90-DAY TRAJECTORY");
  const gap = 12;
  const cw = (W - gap) / 2;
  const ch = 96;
  need(c, ch * 2 + gap + 4);
  const rowTop = c.y;
  chart(c, M, rowTop, cw, ch, { title: `Petrol (${c.uni ? "₹" : "Rs"}/L)`, values: t.fuel_price, baseline: BASE.pumpInrPerL, color: RED, unit: (v) => rupee(c, (v - BASE.pumpInrPerL >= 0 ? "+" : "") + (v - BASE.pumpInrPerL).toFixed(0)) });
  chart(c, M + cw + gap, rowTop, cw, ch, { title: "GDP impulse (pp)", values: t.gdp, baseline: 0, color: t.gdp.some((v) => v < 0) ? RED : GREEN, unit: (v) => v.toFixed(1) });
  chart(c, M, rowTop - ch - gap, cw, ch, { title: "Refinery run-rate (%)", values: t.run_rate.map((v) => v * 100), baseline: 100, color: RED, unit: (v) => v.toFixed(0) + "%" });
  chart(c, M + cw + gap, rowTop - ch - gap, cw, ch, { title: "Grid stress (%)", values: t.power_stress.map((v) => v * 100), baseline: 0, color: RED, unit: (v) => v.toFixed(0) + "%" });
  c.y = rowTop - ch * 2 - gap - 4;
  draw(c, "Dashed line = peacetime baseline; end labels = day-90 value. Same engine as the dashboard.", { size: 8, color: MUTED });

  // ── how the 90 days unfold (<=3 rows + arc) ────────────────────────────
  section(c, "HOW THE 90 DAYS UNFOLD");
  sparkline(c, t.fuel_price.map((v) => v - BASE.pumpInrPerL));
  strip(c, ninetyDayRows(t));

  // ═══ page 2 flows continuously from here ═══
  section(c, "WHY IT HAPPENS");
  flow(c, ["Shock × exposure × mix", "Physical shortfall", "Stock draw (capped)", "World crude lifts", "Pump + GDP"]);
  if (input.mitigation) {
    const { before, after } = input.mitigation;
    flow(
      c,
      ["Shortfall", "Re-source crude", "Residual gap", "Buffer + demand absorb"],
      [`${n0(before / 1000)}k → ${n0(after / 1000)}k bbl/d`, "", "SPR draw"],
    );
  }

  // ── affected ships + routes ────────────────────────────────────────────
  if (input.ships.length) {
    section(c, "AFFECTED SHIPS");
    if (input.mapDataUrl) {
      try {
        const png = await doc.embedPng(input.mapDataUrl);
        const h = Math.min(150, (png.height / png.width) * W);
        need(c, h + 6);
        c.page.drawImage(png, { x: M, y: c.y - h, width: W, height: h });
        c.y -= h + 6;
      } catch {
        draw(c, "Route map unavailable in this export — see the Ship Simulator.", { size: 8, color: MUTED });
      }
    } else {
      draw(c, "Route map: open the Ship Simulator to view the reroute lines.", { size: 8, color: MUTED });
    }
    shipStrip(c, input.ships);
  }

  // ── war cabinet ────────────────────────────────────────────────────────
  renderCabinet(c, input.cabinet);

  // ── provenance ─────────────────────────────────────────────────────────
  provenance(c);
  return finalize(doc);
}

// ---- verdict sentence (<=25 words) ------------------------------------------
function verdict(
  shocks: ExportInput["shocks"],
  dPump: number,
  gdpMean: number,
  c: Ctx,
): string {
  const g = Math.abs(gdpMean).toFixed(1);
  const p = `${rupee(c, Math.abs(Math.round(dPump)).toString())}/L`;
  if (!shocks) return "";
  const named = [
    shocks.hormuz > 0 && { n: "Hormuz", v: shocks.hormuz },
    shocks.redsea > 0 && { n: "Red Sea", v: shocks.redsea },
    shocks.opec > 0 && { n: "OPEC+", v: shocks.opec },
  ].filter(Boolean) as { n: string; v: number }[];
  const lead =
    named.length === 0
      ? "This scenario"
      : named.length === 1
        ? `A ${Math.round(named[0].v * 100)}% ${named[0].n} shock`
        : "This combined shock";
  const dir = dPump >= 0 ? "adds about" : "cuts about";
  return `${lead} ${dir} ${p} at the pump and costs roughly ${g} points of growth over 90 days.`;
}

// ---- KPI tiles --------------------------------------------------------------
function kpi(c: Ctx, items: { label: string; value: string; tone: typeof RED }[]) {
  const gap = 10;
  const w = (W - gap * (items.length - 1)) / items.length;
  const h = 46;
  need(c, h + 6);
  const top = c.y;
  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    c.page.drawRectangle({ x, y: top - h, width: w, height: h, color: PANEL, borderColor: RULE, borderWidth: 0.8 });
    c.page.drawText(safe(it.label), { x: x + 8, y: top - 14, size: 7, font: c.bold, color: MUTED });
    const size = c.bold.widthOfTextAtSize(safe(it.value), 16) > w - 14 ? 12 : 16;
    c.page.drawText(safe(it.value), { x: x + 8, y: top - 36, size, font: c.bold, color: it.tone });
  });
  c.y = top - h - 6;
}

// ---- spike→ease→settle sparkline --------------------------------------------
function sparkline(c: Ctx, series: number[]) {
  const h = 22;
  need(c, h + 4);
  const top = c.y;
  const lo = Math.min(...series, 0),
    hi = Math.max(...series, 0),
    span = hi - lo || 1;
  c.page.drawRectangle({ x: M, y: top - h, width: W, height: h, color: PANEL });
  const px = (i: number) => M + 4 + (i / (series.length - 1)) * (W - 8);
  const py = (v: number) => top - h + 3 + ((v - lo) / span) * (h - 6);
  for (let i = 1; i < series.length; i++)
    c.page.drawLine({ start: { x: px(i - 1), y: py(series[i - 1]) }, end: { x: px(i), y: py(series[i]) }, thickness: 1, color: AMBER });
  c.page.drawText("spike", { x: M + 6, y: top - h + 3, size: 7, font: c.font, color: MUTED });
  c.page.drawText("settle", { x: M + W - 34, y: top - h + 3, size: 7, font: c.font, color: MUTED });
  c.y = top - h - 6;
}

// ---- 90-day strip -----------------------------------------------------------
function strip(c: Ctx, rows: ReturnType<typeof ninetyDayRows>) {
  const cols = [
    { w: 70 },
    { w: 110 },
    { w: 52 },
    { w: W - 232 },
  ];
  const rh = 16;
  rows.forEach((r, i) => {
    need(c, rh);
    const top = c.y;
    if (i % 2 === 0) c.page.drawRectangle({ x: M, y: top - rh + 3, width: W, height: rh, color: PANEL });
    const cells = [r.window, rupee(c, "") + r.pump, r.run, r.note];
    let x = M;
    cells.forEach((cell, ci) => {
      c.page.drawText(safe(cell), {
        x: x + 5,
        y: top - 10,
        size: 8.5,
        font: ci === 0 ? c.bold : c.font,
        color: ci === 0 ? NAVY : INK,
      });
      x += cols[ci].w;
    });
    c.y -= rh;
  });
  c.y -= 4;
}

// ---- ship strip -------------------------------------------------------------
function shipStrip(c: Ctx, ships: ShipRow[]) {
  const shown = ships.slice(0, 5);
  for (const s of shown) {
    need(c, 14);
    const top = c.y;
    let x = M + 5;
    c.page.drawText(safe(s.name), { x, y: top - 10, size: 8.5, font: c.bold, color: NAVY });
    x += 150;
    c.page.drawText(safe(`${s.effect}${s.addedDays != null ? `  ·  +${s.addedDays}d` : ""}`), {
      x,
      y: top - 10,
      size: 8.5,
      font: c.font,
      color: INK,
    });
    if (s.sanctioned) {
      c.page.drawText("SANCTIONED", { x: M + W - 68, y: top - 10, size: 7.5, font: c.bold, color: RED });
    }
    c.y -= 14;
  }
  if (ships.length > 5) draw(c, `+${ships.length - 5} more`, { size: 8, color: MUTED });
  c.y -= 2;
}

// ---- cabinet ----------------------------------------------------------------
function renderCabinet(c: Ctx, turns: CabinetTurn[]) {
  if (!turns.length) return;
  section(c, "WAR CABINET");
  draw(c, "A labelled strategic simulation — role-based reasoning, not attributed speech.", { size: 7.5, color: MUTED });
  c.y -= 2;
  turns.forEach((turn, ti) => {
    if (ti === 0) {
      // full block for the first selected prompt
      need(c, 16);
      c.page.drawRectangle({ x: M, y: c.y - 13, width: W, height: 14, color: PANEL });
      draw(c, safe(turn.prompt), { size: 8.5, bold: true, x: M + 5, width: W - 10, color: NAVY });
      c.y -= 2;
      for (const mb of [turn.fm, turn.dm]) {
        if (!mb) continue;
        draw(c, mb.role, { size: 8.5, bold: true, color: AMBER, gap: 2 });
        draw(c, `Position: ${mb.position || "No response available"}`, { size: 8.5, x: M + 6, width: W - 12 });
        for (const b of mb.recommends.slice(0, 3)) draw(c, `• ${b}`, { size: 8.5, x: M + 12, width: W - 18, gap: 2 });
        c.y -= 3;
      }
      // PM decision box — visually distinct
      need(c, 30);
      const top = c.y;
      const lines = wrap(`PM DECISION: ${turn.pmDecision || "No response available"}`, c.bold, 9, W - 16);
      const bh = lines.length * 12 + 10;
      c.page.drawRectangle({ x: M, y: top - bh, width: W, height: bh, color: rgb(0.99, 0.96, 0.9), borderColor: AMBER, borderWidth: 1 });
      lines.forEach((ln, li) => c.page.drawText(ln, { x: M + 8, y: top - 14 - li * 12, size: 9, font: c.bold, color: NAVY }));
      c.y = top - bh - 6;
    } else {
      // every other selected prompt → one line
      draw(c, `• ${words(turn.prompt, 12)} — cabinet advised (see app for detail).`, { size: 8, color: MUTED, gap: 2 });
    }
  });
}

// ---- provenance band --------------------------------------------------------
function provenance(c: Ctx) {
  section(c, "PROVENANCE & LIMITS");
  for (const line of [
    "Coefficients: every value carries a cited source, range and as-of date.",
    "The 2022 backtest is calibration on an administered price series, not validation of accuracy.",
    "Physical impact is logistics friction plus reserve draw, not starvation — India is a solvent price-taker.",
    "Escalation is modelled first-order; no retaliation spiral is claimed.",
  ])
    draw(c, `— ${line}`, { size: 8, color: MUTED, gap: 3 });
}

async function finalize(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}
