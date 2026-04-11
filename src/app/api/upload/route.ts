import { NextRequest, NextResponse } from "next/server";
import { getUploadUrl } from "@/lib/s3";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const { filename, contentType } = await req.json();

  if (!filename || !contentType) {
    return NextResponse.json(
      { error: "filename and contentType required" },
      { status: 400 }
    );
  }

  if (!contentType.startsWith("video/")) {
    return NextResponse.json(
      { error: "Only video files are accepted" },
      { status: 400 }
    );
  }

  const videoId = randomUUID();
  const ext = filename.split(".").pop() || "mp4";
  const key = `uploads/${videoId}/original.${ext}`;

  const uploadUrl = await getUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl, videoId, key });
}
