// Strip the machinery out of a minister's reply so only the briefing prose
// reaches the user (and the PDF).
//
// The prompt asks for a ```levers fenced JSON block, but models don't comply
// uniformly: some fence it, some emit a bare "levers" line then JSON, some
// drop the JSON in with no marker at all. All three shapes have leaked into
// the UI, so we handle all three rather than trusting the fence.

/** keys the engine actually understands — used to identify a lever blob */
const LEVER_KEY =
  /"?(resource_reallocation|opec_negotiation|deescalation|spr_release|naval_escort|escalation)"?\s*:/;

export function cleanProse(raw: string): string {
  // 1. a real code fence: everything from it on is machinery
  let t = raw.split("```")[0];

  // 2. unfenced marker — a line that is just "levers" (any case/spacing)
  t = t.split(/^[^\S\n]*levers[^\S\n]*:?[^\S\n]*$/im)[0];

  // 3. no marker at all: drop any JSON object carrying lever keys, but leave
  //    ordinary braces in prose alone
  t = t.replace(/\{[\s\S]*?\}/g, (m) => (LEVER_KEY.test(m) ? "" : m));

  // 4. light markdown the models like to prepend
  t = t.replace(/\*\*|__|`/g, "").replace(/^\s*#+\s*/gm, "").trim();

  // 5. drop a leading meta-label some models emit ("Briefing-room reasoning:",
  //    "Reasoning:", "Analysis:") — it's scaffolding, not the advice
  t = t.replace(
    /^\s*(briefing[- ]room reasoning|reasoning|analysis|assessment|response|briefing)\s*:\s*/i,
    "",
  );

  return t.trim();
}
