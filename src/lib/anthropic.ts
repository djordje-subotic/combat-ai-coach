import Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "./i18n";
import type { BiomechanicalReport } from "./biomechanics";
import type { SelectedFrame } from "./frame-selector";
import { getSportRulesPrompt, SPORT_RULES } from "./sport-rules";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ── Types ──────────────────────────────────────────────

export interface AnalysisMoment {
  timestamp: string;
  seconds: number;
  duration: number;
  category: "defense" | "offense" | "positioning" | "movement" | "critical";
  severity: "info" | "warning" | "critical";
  observation: string;
  recommendation: string;
  telemetry?: {
    guardHeight?: { left: number; right: number };
    stanceWidth?: number;
    strikeVelocity?: number;
  };
}

export interface AnalysisResult {
  summary: string;
  sport: string;
  moments: AnalysisMoment[];
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
}

// ── Language ──────────────────────────────────────────

const LANG_INSTRUCTION: Record<Lang, string> = {
  sr: `\nOBVEZNO piši SVE na srpskom jeziku (latinica). Observation, recommendation, summary, strengths, weaknesses — SVE na srpskom. Budi konkretan, koristi sportsku terminologiju.`,
  en: `\nWrite ALL output in English.`,
};

// ── Single-Pass Analysis ─────────────────────────────

function buildSystemPrompt(sport: string, lang: Lang, negatives: string[]): string {
  const sportName = SPORT_RULES[sport]?.name ?? "MMA";
  const sportRules = getSportRulesPrompt(sport);

  const negativesBlock = negatives.length > 0
    ? `\nTHINGS THE TELEMETRY DID NOT DETECT — DO NOT MENTION THESE:\n${negatives.map((n) => `- ${n}`).join("\n")}\n`
    : "";

  return `You are an elite ${sportName} coach reviewing sparring footage through biomechanical telemetry.

== YOUR DATA SOURCES ==

1. BIOMECHANICAL TELEMETRY — pose tracking computed joint angles, guard heights, wrist velocities, and stance measurements at every frame. These numbers are FACTS.
2. KEY FRAMES — a few still images from moments where telemetry flagged an event. Use these ONLY to add visual context (which fighter, what gear, ring position). Do NOT try to analyze technique from images — the telemetry is far more precise.

== ABSOLUTE RULES (VIOLATION = FAILURE) ==

1. You may ONLY discuss events that appear in the DETECTED EVENTS list. If an event is not listed, it DID NOT HAPPEN. Do not invent events.
2. Every observation you make MUST cite a specific telemetry number. Not "guard was low" but "guard at 28% for 2.1s starting at 0:04".
3. NEVER claim a specific technique (jab, cross, hook, kick, takedown, etc.) unless the telemetry explicitly lists it as a detected event. If the telemetry says "punch" you may say punch. If it doesn't say "kick" you MUST NOT say kick.
4. Do NOT describe what you "see" in frames. The frames are low-resolution still images — you cannot reliably identify techniques from them. Trust the numbers only.
5. If the telemetry detected few or no events, that is fine. Say the session was clean. Do NOT fill the analysis with imagined problems.
6. Each recommendation must be a specific, drillable exercise. Not "improve your guard" but "Practice 3-minute shadow boxing rounds where you touch your chin with your glove after every punch to build the habit of hand return."
${negativesBlock}
== ${sportName.toUpperCase()} TECHNIQUE STANDARDS ==
${sportRules}

== OUTPUT CONSTRAINTS ==
- Moments array must correspond 1:1 to detected events. One moment per event, no extras.
- If there are 0 events, return an empty moments array and focus summary on overall metrics (average guard, stance, lean).
- severity must match: guard_drop > 3s = critical, > 1.5s = warning, else info. punch = info.
- overallScore: 8-10 = very few issues, 5-7 = some guard/stance problems, 1-4 = persistent critical issues.
${LANG_INSTRUCTION[lang]}`;
}

function buildTelemetrySummary(report: BiomechanicalReport): string {
  const ts = report.timeSeries;
  const events = report.events;

  let summary = `=== BIOMECHANICAL TELEMETRY (${report.fps}fps, ${report.personCount} person(s) tracked) ===\n\n`;

  summary += `SESSION AVERAGES:\n`;
  summary += `- Guard height: Left=${(ts.guardHeightAvg.left * 100).toFixed(0)}%, Right=${(ts.guardHeightAvg.right * 100).toFixed(0)}% (100%=above nose, 0%=at waist)\n`;
  summary += `- Stance width: ${ts.avgStanceWidth.toFixed(2)}x shoulder width\n`;
  summary += `- Torso lean: ${ts.avgTorsoLean.toFixed(1)}° from vertical\n`;
  summary += `- Total guard drops detected: ${ts.guardDropCount} (total duration: ${ts.guardDropTotalDuration.toFixed(1)}s)\n`;
  summary += `- Total punches detected: ${ts.punchCount}\n\n`;

  summary += `DETECTED EVENTS (${events.length} total):\n`;
  if (events.length > 0) {
    for (const e of events) {
      const mins = Math.floor(e.timestampSeconds / 60);
      const secs = Math.floor(e.timestampSeconds % 60);
      summary += `  [${mins}:${String(secs).padStart(2, "0")}] ${e.type.toUpperCase()} (${e.severity}): ${e.details} [confidence: ${(e.confidence * 100).toFixed(0)}%]\n`;
    }
  } else {
    summary += `  (none — session was clean or telemetry had insufficient data)\n`;
  }

  return summary;
}

export type ProgressCallback = (step: string, detail: string) => void;

export async function analyzeWithTelemetry(
  report: BiomechanicalReport,
  keyFrames: SelectedFrame[],
  lang: Lang,
  onProgress?: ProgressCallback
): Promise<AnalysisResult> {
  const sport = report.detectedSport.sport;
  onProgress?.("analysis", `AI coach analyzing (${sport}, ${keyFrames.length} key frames, ${report.events.length} events)...`);

  const telemetrySummary = buildTelemetrySummary(report);

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: `${telemetrySummary}

=== KEY FRAMES (${keyFrames.length}) — for visual context only ===

Analyze this sparring session based on the telemetry above.

Return JSON:
{
  "summary": "2-3 sentences. Reference specific telemetry numbers and timestamps. If few events: focus on overall averages.",
  "sport": "${sport}",
  "moments": [
    {
      "timestamp": "M:SS",
      "seconds": <must match a DETECTED EVENT timestamp>,
      "duration": 3,
      "category": "defense|offense|positioning|movement|critical",
      "severity": "info|warning|critical",
      "observation": "Describe the event using EXACT telemetry numbers. What happened biomechanically.",
      "recommendation": "A specific drill or correction. Must be actionable and practicable."
    }
  ],
  "overallScore": <1-10>,
  "strengths": ["cite specific metrics that were good"],
  "weaknesses": ["cite specific metrics that need work"]
}

REMEMBER: Only create moments for events in the DETECTED EVENTS list. No extras. No guessing.
Return ONLY valid JSON, no markdown fences.`,
    },
  ];

  for (const frame of keyFrames) {
    const mins = Math.floor(frame.timestampSeconds / 60);
    const secs = String(Math.floor(frame.timestampSeconds % 60)).padStart(2, "0");
    content.push(
      { type: "text", text: `--- Visual context: ${mins}:${secs} ---\n${frame.telemetryContext}` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame.base64 } }
    );
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    system: buildSystemPrompt(sport, lang, report.negatives),
    messages: [{ role: "user", content }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const result = JSON.parse(cleaned) as AnalysisResult;

  // POST-PROCESSING: Filter out any moments that don't correspond to a real event
  result.moments = result.moments.filter((moment) => {
    const matchingEvent = report.events.find(
      (e) => Math.abs(e.timestampSeconds - moment.seconds) <= 2
    );
    return matchingEvent !== undefined;
  });

  // Enrich with telemetry data
  for (const moment of result.moments) {
    const metrics = report.frameMetrics.find(
      (m) => Math.abs(m.timestampSeconds - moment.seconds) < 1.5
    );
    if (metrics) {
      moment.telemetry = {
        guardHeight: metrics.guardHeight.left >= 0 ? metrics.guardHeight : undefined,
        stanceWidth: metrics.stanceWidth >= 0 ? metrics.stanceWidth : undefined,
      };
    }
  }

  return result;
}
