import Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "./i18n";

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
}

export interface AnalysisResult {
  summary: string;
  sport: string;
  moments: AnalysisMoment[];
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
}

// ── Language instructions ─────────────────────────────

const LANG_INSTRUCTION: Record<Lang, string> = {
  sr: `\n\nVAŽNO: Piši SVE na srpskom jeziku (latinica). Observation, recommendation, summary, strengths, weaknesses — sve na srpskom. Budi konkretan i koristi sportsku terminologiju.`,
  en: `\n\nIMPORTANT: Write ALL output in English.`,
};

// ── Prompts ───────────────────────────────────────────

const SCAN_SYSTEM = `You are an expert combat sports coach. You will see a sequence of frames from a sparring session, each taken 1 second apart.

YOUR TASK: Identify which timestamps contain technically interesting moments worth analyzing in detail.

A "technically interesting moment" is:
- A punch/kick being thrown or landing
- Guard visibly dropping or being held incorrectly
- A clear defensive movement (slip, roll, block, parry)
- A takedown, sweep, or submission attempt
- A scramble or transition
- Significant footwork — cutting angles, pivoting, retreating flat-footed
- A clean opening that was exploited or missed

DO NOT flag:
- Normal stance with nothing happening
- Walking/circling with no engagement
- Moments where you can't clearly see what's happening (blurry, obstructed)

CRITICAL RULES:
- Only flag what you can CLEARLY SEE in the frame. Never guess or infer.
- If a frame is blurry or obstructed, skip it.
- Better to flag fewer high-confidence moments than many uncertain ones.
- Use the EXACT timestamp labels shown on each frame.`;

function getDetailSystem(lang: Lang) {
  return `You are an expert combat sports coach doing a detailed breakdown of a specific moment in sparring.

You will see 3 consecutive frames (1 second apart) showing a specific moment. Compare the frames to understand the MOTION — what changed between frame 1, 2, and 3.

ANALYSIS RULES:
1. ONLY describe what you can clearly see. If you're not sure, say so or skip it.
2. Compare frames to detect motion: describe what CHANGED between frame 1→2→3.
3. Be specific about WHICH fighter you mean. Use their position ("the fighter on the left") or appearance ("the fighter in the dark shorts").
4. Don't invent techniques you can't see. If someone's hand is low, don't assume they just threw a punch — they might just have bad guard habits.
5. Give concrete, actionable advice. Not "keep your hands up" but "after throwing the jab, immediately return the hand to guard position — your left hand stayed extended for ~1 second, giving your opponent a free line to your chin."
6. The "observation" should describe what is happening and what's wrong or right.
7. The "recommendation" should be specific coaching instruction — what to practice, what to change.${LANG_INSTRUCTION[lang]}`;
}

// ── Pass 1: Scan ──────────────────────────────────────

interface ScanMoment {
  seconds: number;
  reason: string;
}

async function scanForMoments(
  frames: { base64: string; timestampSeconds: number }[]
): Promise<ScanMoment[]> {
  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: `Review these ${frames.length} frames (1 second apart) and identify timestamps with technically interesting moments.

Return JSON array:
[{"seconds": <number>, "reason": "brief reason"}]

Return ONLY the JSON array, no markdown fences. If nothing interesting is happening, return an empty array [].`,
    },
  ];

  for (const frame of frames) {
    const mins = Math.floor(frame.timestampSeconds / 60);
    const secs = String(Math.floor(frame.timestampSeconds % 60)).padStart(2, "0");
    content.push(
      { type: "text", text: `[${mins}:${secs} — second ${frame.timestampSeconds}]` },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: frame.base64 },
      }
    );
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: SCAN_SYSTEM,
    messages: [{ role: "user", content }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(cleaned) as ScanMoment[];
  } catch {
    console.error("Scan parse error, raw:", text);
    return [];
  }
}

// ── Pass 2: Detail ────────────────────────────────────

async function analyzeDetailMoment(
  triplet: { base64: string; timestampSeconds: number }[],
  scanReason: string,
  lang: Lang
): Promise<AnalysisMoment | null> {
  const centerTime = triplet[1]?.timestampSeconds ?? triplet[0].timestampSeconds;
  const mins = Math.floor(centerTime / 60);
  const secs = String(Math.floor(centerTime % 60)).padStart(2, "0");

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: `These 3 consecutive frames (1 sec apart) show a moment flagged as: "${scanReason}"

Analyze the motion across these frames. What technique is being used? What errors or good technique do you see?

Return JSON:
{
  "timestamp": "${mins}:${secs}",
  "seconds": ${centerTime},
  "duration": 3,
  "category": "defense|offense|positioning|movement|critical",
  "severity": "info|warning|critical",
  "observation": "Detailed description comparing what you see across the 3 frames.",
  "recommendation": "Specific, actionable coaching advice. What exactly should the fighter practice or change."
}

RULES:
- Compare frame 1→2→3 to understand motion. Describe what CHANGED.
- Only report what you can clearly see. If uncertain, set severity to "info".
- Return ONLY JSON, no markdown fences.`,
    },
  ];

  triplet.forEach((frame, i) => {
    const fmins = Math.floor(frame.timestampSeconds / 60);
    const fsecs = String(Math.floor(frame.timestampSeconds % 60)).padStart(2, "0");
    content.push(
      { type: "text", text: `Frame ${i + 1} of 3 [${fmins}:${fsecs}]` },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: frame.base64 },
      }
    );
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: getDetailSystem(lang),
    messages: [{ role: "user", content }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(cleaned) as AnalysisMoment;
  } catch {
    console.error("Detail parse error, raw:", text);
    return null;
  }
}

// ── Synthesize final summary ──────────────────────────

async function synthesizeSummary(
  moments: AnalysisMoment[],
  lang: Lang
): Promise<{
  summary: string;
  sport: string;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
}> {
  const momentDescriptions = moments
    .map((m) => `[${m.timestamp}] ${m.category}/${m.severity}: ${m.observation}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: `You are an expert combat sports coach summarizing a sparring analysis.${LANG_INSTRUCTION[lang]}`,
    messages: [
      {
        role: "user",
        content: `Based on these moment-by-moment observations from a sparring session, provide an overall assessment.

${momentDescriptions}

Return JSON:
{
  "summary": "2-3 sentence overall assessment. Be specific — reference actual moments.",
  "sport": "boxing|mma|kickboxing|bjj",
  "overallScore": <1-10>,
  "strengths": ["strength1", "strength2", "strength3"],
  "weaknesses": ["weakness1", "weakness2", "weakness3"]
}

Return ONLY JSON, no markdown fences.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(cleaned);
}

// ── Main pipeline ─────────────────────────────────────

export type ProgressCallback = (step: string, detail: string) => void;

export async function analyzeSparring(
  frames: { base64: string; timestampSeconds: number }[],
  lang: Lang,
  onProgress?: ProgressCallback
): Promise<AnalysisResult> {
  onProgress?.("scan", `Scanning ${frames.length} frames for key moments...`);

  const SCAN_BATCH = 20;
  const scanBatches: { base64: string; timestampSeconds: number }[][] = [];
  for (let i = 0; i < frames.length; i += SCAN_BATCH) {
    scanBatches.push(frames.slice(i, i + SCAN_BATCH));
  }

  const allScanMoments: ScanMoment[] = [];
  for (const batch of scanBatches) {
    const results = await scanForMoments(batch);
    allScanMoments.push(...results);
  }

  // Deduplicate within 2 seconds
  const dedupedMoments: ScanMoment[] = [];
  const sorted = allScanMoments.sort((a, b) => a.seconds - b.seconds);
  for (const m of sorted) {
    const last = dedupedMoments[dedupedMoments.length - 1];
    if (!last || m.seconds - last.seconds > 2) {
      dedupedMoments.push(m);
    }
  }

  onProgress?.(
    "scan",
    `Found ${dedupedMoments.length} interesting moments. Analyzing in detail...`
  );

  if (dedupedMoments.length === 0) {
    const noMoments: Record<Lang, string> = {
      sr: "Nisu detektovani jasni tehnički momenti. Moguće da je kvalitet videa nizak, ugao kamere nije idealan, ili je sparing vrlo čist.",
      en: "No clearly interesting technical moments were detected. This could mean the video quality is too low, the camera angle isn't ideal, or the sparring is very clean.",
    };
    return {
      summary: noMoments[lang],
      sport: "mma",
      moments: [],
      overallScore: 5,
      strengths: [],
      weaknesses: [],
    };
  }

  onProgress?.(
    "detail",
    `Analyzing ${dedupedMoments.length} moments in detail (3 frames each)...`
  );

  // Frame lookup
  const frameBySecond = new Map<number, { base64: string; timestampSeconds: number }>();
  for (const f of frames) {
    frameBySecond.set(Math.round(f.timestampSeconds), f);
  }

  function getClosestFrame(targetSec: number) {
    const exact = frameBySecond.get(Math.round(targetSec));
    if (exact) return exact;
    let closest = frames[0];
    let minDist = Infinity;
    for (const f of frames) {
      const dist = Math.abs(f.timestampSeconds - targetSec);
      if (dist < minDist) {
        minDist = dist;
        closest = f;
      }
    }
    return closest;
  }

  const CONCURRENCY = 3;
  const detailResults: (AnalysisMoment | null)[] = [];

  for (let i = 0; i < dedupedMoments.length; i += CONCURRENCY) {
    const chunk = dedupedMoments.slice(i, i + CONCURRENCY);
    const promises = chunk.map((m) => {
      const triplet = [
        getClosestFrame(m.seconds - 1),
        getClosestFrame(m.seconds),
        getClosestFrame(m.seconds + 1),
      ];
      return analyzeDetailMoment(triplet, m.reason, lang);
    });

    const results = await Promise.all(promises);
    detailResults.push(...results);

    onProgress?.(
      "detail",
      `Analyzed ${Math.min(i + CONCURRENCY, dedupedMoments.length)}/${dedupedMoments.length} moments...`
    );
  }

  const validMoments = detailResults.filter((m): m is AnalysisMoment => m !== null);
  validMoments.sort((a, b) => a.seconds - b.seconds);

  onProgress?.("summary", "Generating overall assessment...");
  const summary = await synthesizeSummary(validMoments, lang);

  return {
    ...summary,
    moments: validMoments,
  };
}
