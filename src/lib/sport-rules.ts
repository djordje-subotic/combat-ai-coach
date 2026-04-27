export interface SportRules {
  name: string;
  /** Guard height thresholds (0-1, 1=above nose level) */
  guard: { good: number; warning: number; critical: number };
  /** Stance width as multiple of shoulder width */
  stanceWidth: { min: number; ideal: number; max: number };
  /** Max elbow angle when in guard (degrees) */
  elbowTuck: number;
  /** Max time (seconds) hand should stay extended after strike */
  handReturnTime: number;
  /** Wrist velocity threshold to detect a strike (pixels/frame) */
  strikeVelocityThreshold: number;
  /** Text rules for Claude's system prompt */
  rules: string[];
}

export const SPORT_RULES: Record<string, SportRules> = {
  boxing: {
    name: "Boxing",
    guard: { good: 0.65, warning: 0.4, critical: 0.2 },
    stanceWidth: { min: 0.8, ideal: 1.2, max: 1.6 },
    elbowTuck: 50,
    handReturnTime: 0.4,
    strikeVelocityThreshold: 30,
    rules: [
      "Guard must be at chin level at all times when not striking. Left hand protects chin, right hand at cheek (orthodox).",
      "After throwing a jab, the hand must return to guard within 0.4 seconds. A lazy jab return exposes the chin.",
      "Stance should be shoulder-width apart, lead foot at 12 o'clock, rear foot at 2 o'clock. Too narrow = no power, too wide = no mobility.",
      "Elbows must be tucked to protect the body. Flared elbows expose the liver and ribs.",
      "Chin should be tucked behind the lead shoulder. If chin is forward of the shoulder line, it's exposed.",
      "Head should move off the center line after every combination. Returning to the same position is predictable.",
      "Weight distribution should be roughly 60/40 on the back foot in neutral, shifting forward when attacking.",
    ],
  },
  mma: {
    name: "MMA",
    guard: { good: 0.55, warning: 0.35, critical: 0.15 },
    stanceWidth: { min: 1.0, ideal: 1.4, max: 2.0 },
    elbowTuck: 60,
    handReturnTime: 0.5,
    strikeVelocityThreshold: 25,
    rules: [
      "Guard can be slightly lower than boxing to defend takedowns, but hands should still be above chin when in striking range.",
      "Wider stance than boxing is acceptable for takedown defense, but not so wide that lateral movement is compromised.",
      "When throwing kicks, the opposite hand MUST stay high to protect the chin. Most MMA knockouts come from counter punches during kicks.",
      "Watch for level changes — dropping hips signals a potential takedown. Weight should drop into the hips, not by bending at the waist.",
      "After sprawling a takedown, return to base immediately. Don't stay bent over on the opponent.",
      "In the clinch, underhooks are dominant position. Double underhooks = full control of opponent's hips.",
    ],
  },
  kickboxing: {
    name: "Kickboxing",
    guard: { good: 0.6, warning: 0.38, critical: 0.18 },
    stanceWidth: { min: 0.9, ideal: 1.3, max: 1.7 },
    elbowTuck: 55,
    handReturnTime: 0.4,
    strikeVelocityThreshold: 28,
    rules: [
      "Guard similar to boxing but slightly wider to check kicks. Lead hand can be lower for range-finding.",
      "When throwing a kick, chamber the knee first — a straight-leg kick telegraphs and has no power.",
      "Check incoming kicks by lifting the knee on the same side. The shin should be vertical, not angled.",
      "After throwing a combination, always end with a defensive movement (step back, head movement, or guard reset).",
      "Maintain distance awareness — punching range is closer than kicking range. Don't throw kicks at punching range.",
    ],
  },
  bjj: {
    name: "BJJ",
    guard: { good: 0.3, warning: 0.15, critical: 0.05 },
    stanceWidth: { min: 1.2, ideal: 1.8, max: 2.5 },
    elbowTuck: 90,
    handReturnTime: 1.0,
    strikeVelocityThreshold: 15,
    rules: [
      "Base is everything. Knees should be wide, hips low, weight centered. If your head goes past your knees, you can be swept.",
      "Elbows should stay tight to the body to prevent arm isolations. A flared elbow in guard is an armbar invitation.",
      "When passing guard, maintain chest-to-chest pressure. Space between you and your opponent = they can re-guard.",
      "In guard, posture up — straight back, hands on opponent's hips. Broken posture = submission threats.",
      "Head position determines the scramble. The person whose head is on the inside usually wins the exchange.",
    ],
  },
};

export function getSportRulesPrompt(sport: string): string {
  const rules = SPORT_RULES[sport] ?? SPORT_RULES.mma;
  return rules.rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

export function detectSportFromPoses(
  avgStanceWidth: number,
  avgGuardHeight: number,
  hasKicks: boolean,
  hasGround: boolean
): { sport: string; confidence: number } {
  if (hasGround) return { sport: "bjj", confidence: 0.8 };
  if (hasKicks && avgStanceWidth > 1.3)
    return { sport: avgGuardHeight > 0.5 ? "kickboxing" : "mma", confidence: 0.7 };
  if (avgGuardHeight > 0.6 && avgStanceWidth < 1.5)
    return { sport: "boxing", confidence: 0.75 };
  return { sport: "mma", confidence: 0.5 };
}
