import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 300;

const execAsync = promisify(exec);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB buffer for ffmpeg stderr

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("video") as File | null;
  const fpsParam = formData.get("fps") as string | null;
  const fps = fpsParam ? parseFloat(fpsParam) : 1;

  if (!file) {
    return NextResponse.json(
      { error: "No video file provided" },
      { status: 400 }
    );
  }

  if (file.size > 500 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large. Max 500MB for local processing." },
      { status: 413 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "frames-"));
  const videoPath = path.join(tmpDir, "input.mp4");
  const framesDir = path.join(tmpDir, "frames");
  await fs.mkdir(framesDir);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(videoPath, buffer);

    // Get video duration
    const { stdout: durationOut } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { maxBuffer: MAX_BUFFER }
    );
    const duration = parseFloat(durationOut.trim());

    if (isNaN(duration) || duration <= 0) {
      return NextResponse.json(
        { error: "Could not read video duration. Is this a valid video file?" },
        { status: 400 }
      );
    }

    // Extract frames: resize to 720p max width, keeps aspect ratio
    // -q:v 5 gives decent quality at smaller file size (~30-60KB per frame)
    await execAsync(
      `ffmpeg -i "${videoPath}" -vf "fps=${fps},scale='min(720,iw)':-2" -q:v 5 "${framesDir}/frame_%04d.jpg"`,
      { timeout: 300000, maxBuffer: MAX_BUFFER }
    );

    const frameFiles = (await fs.readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort();

    if (frameFiles.length === 0) {
      return NextResponse.json(
        { error: "No frames extracted. The video may be too short or corrupted." },
        { status: 400 }
      );
    }

    const frames = await Promise.all(
      frameFiles.map(async (filename, index) => {
        const data = await fs.readFile(path.join(framesDir, filename));
        return {
          base64: data.toString("base64"),
          timestampSeconds: index / fps,
        };
      })
    );

    return NextResponse.json({
      frameCount: frames.length,
      duration: Math.round(duration * 10) / 10,
      fps,
      frames,
    });
  } catch (err) {
    console.error("Frame extraction error:", err);
    const message =
      err instanceof Error ? err.message : "Frame extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
