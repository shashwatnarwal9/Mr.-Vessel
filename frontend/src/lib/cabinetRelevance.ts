// Does this prompt give the cabinet anything to deliberate on? Without it,
// "i am hungry" reached three ministers and came back as a Hormuz policy.
// Deterministic and client-side: queued models take minutes to say "no".
// Biased to allow — bouncing a real question is the worse failure.

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
