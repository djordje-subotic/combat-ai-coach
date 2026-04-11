import { NextRequest } from "next/server";
import { analyzeSparring } from "@/lib/anthropic";
import type { Lang } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { frames, lang = "sr" } = (await req.json()) as {
    frames: { base64: string; timestampSeconds: number }[];
    lang?: Lang;
  };

  if (!frames || frames.length === 0) {
    return Response.json({ error: "No frames provided" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await analyzeSparring(frames, lang, (step, detail) => {
          const msg = JSON.stringify({ type: "progress", step, detail }) + "\n";
          controller.enqueue(encoder.encode(msg));
        });

        const msg = JSON.stringify({ type: "result", data: result }) + "\n";
        controller.enqueue(encoder.encode(msg));
        controller.close();
      } catch (error) {
        console.error("Analysis error:", error);
        const msg =
          JSON.stringify({ type: "error", error: String(error) }) + "\n";
        controller.enqueue(encoder.encode(msg));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
