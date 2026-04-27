import { NextRequest } from "next/server";
import { analyzeWithTelemetry } from "@/lib/anthropic";
import { computeBiomechanics, type FramePoseData } from "@/lib/biomechanics";
import { selectKeyFrames } from "@/lib/frame-selector";
import type { Lang } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    frames: { base64: string; timestampSeconds: number }[];
    framePoses: FramePoseData[];
    subjectIndices?: number[];
    sport?: string;
    lang?: Lang;
    fps?: number;
  };

  const { frames, framePoses, subjectIndices, sport, lang = "sr", fps = 1 } = body;

  if (!frames || frames.length === 0) {
    return Response.json({ error: "No frames provided" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(step: string, detail: string) {
        const msg = JSON.stringify({ type: "progress", step, detail }) + "\n";
        controller.enqueue(encoder.encode(msg));
      }

      try {
        emit("biomechanics", "Computing biomechanical metrics...");
        const report = computeBiomechanics(framePoses, fps, subjectIndices);

        // Override sport detection with user selection if provided
        if (sport) {
          report.detectedSport = { sport, confidence: 1.0 };
        }

        emit("biomechanics", `${report.detectedSport.sport} — ${report.events.length} events found.`);

        emit("frames", `Selecting key frames from ${frames.length} total...`);
        const keyFrames = selectKeyFrames(report, frames, 8);
        emit("frames", `Selected ${keyFrames.length} key frames.`);

        emit("analysis", `AI coach analyzing (${report.detectedSport.sport})...`);
        const result = await analyzeWithTelemetry(report, keyFrames, lang, (step, detail) => emit(step, detail));

        controller.enqueue(encoder.encode(JSON.stringify({ type: "result", data: result }) + "\n"));
        controller.close();
      } catch (error) {
        console.error("Analysis error:", error);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: String(error) }) + "\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
