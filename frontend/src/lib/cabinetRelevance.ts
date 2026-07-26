// Is a typed prompt something the War Cabinet can actually deliberate on?
//
// WHY THIS EXISTS: `sendPrompt` only ran `parseCrisis` when NO dashboard shock
// was committed. With one committed, the typed text went straight through as a
// framing label ("CRISIS: i am hungry") with the real scenario appended below
// it — so three ministers produced a confident Hormuz policy for a prompt that
// asked nothing. Nothing was hallucinated; nothing was ever checked.
//
// Deterministic keyword pass, on the CLIENT, on purpose:
//   * scenario_parse.py sets the precedent — "Intentionally NOT LLM-backed:
//     this is the first interactive step, and an LLM fallback would hang the
//     UI". Asking three queued models whether a question is on-topic costs
//     minutes to say "no".
//   * client-side means it still answers instantly when the API is cold
//     (Render free tier sleeps), which is exactly when a hang is worst.
//
// BIAS: conservative — reject ONLY when there is no domain signal at all. A
// false reject blocks a real question, which is far worse than letting a
// borderline one through to ministers who can handle it.
// ponytail: vocabulary gate, revisit only if real questions get bounced.

const DOMAIN =
  /hormuz|red ?sea|bab[- ]?el|mandeb|suez|malacca|cape|strait|chokepoint|corridor|gulf|persian|arabian|\b(iran|iraq|saudi|uae|kuwait|oman|qatar|russia|nigeria|houthi|yemen|india|china|opec)\b|\boil\b|crude|petrol|diesel|\bfuel\b|\bgas\b|\blng\b|brent|barrel|\bbbl\b|refin|suppl|shortfall|import|export|cargo|tanker|\bship|vessel|freight|shipping|reroute|\broute|transit|convoy|escort|\bport\b|terminal|\bspr\b|reserve|stockpile|diplomat|negotiat|escalat|sanction|embargo|tariff|naval|\bnavy\b|militar|strike|blockad|mitigat|re-?sourc|allocat|price|inflation|\bgdp\b|growth|economy|\bcost|impact|\brisk|stress|grid|power|electric|minister|cabinet|\bplan\b|option|recommend|advis|decide|decision|strateg|scenario|what if|should we|alternativ|shock|closure|disrupt/i;

/** True if the prompt carries any energy/security/policy signal the cabinet
 *  can act on. Empty or whitespace-only is never a question. */
export function isCabinetQuestion(text: string): boolean {
  return DOMAIN.test(text.trim());
}

/** Shown instead of convening. Names what the cabinet is FOR, so the user's
 *  next attempt succeeds — a bare "invalid input" teaches nothing. */
export const OFF_TOPIC_HINT =
  "The cabinet only deliberates energy-security questions — corridors (Hormuz, Red Sea, Suez), " +
  "supply and prices, or the levers it can pull (re-sourcing, OPEC+ talks, diplomacy, SPR release, " +
  "naval escort). Try “should we escort tankers through the Red Sea?” or “what if Hormuz closes fully?”";
