"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { Pose, Keypoint } from "@/lib/pose-types";
import { BODY_CONNECTIONS } from "@/lib/pose-types";
import type { Lang } from "@/lib/i18n";

interface Props {
  videoUrl: string;
  poses: Pose[];
  lang: Lang;
  onSelect: (poseIndex: number, sport: string) => void;
}

function kp(pose: Pose, idx: number): Keypoint | null {
  const p = pose.keypoints[idx];
  return p && p.score >= 0.25 ? p : null;
}

function poseBounds(pose: Pose) {
  const pts = pose.keypoints.filter((k) => k.score >= 0.25);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pad = (maxX - minX) * 0.15;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

const SPORTS = [
  { id: "boxing", label: "Boxing", labelSr: "Boks" },
  { id: "mma", label: "MMA", labelSr: "MMA" },
  { id: "kickboxing", label: "Kickboxing", labelSr: "Kikboks" },
  { id: "bjj", label: "BJJ", labelSr: "BJJ" },
];

export default function FighterSelector({ videoUrl, poses, lang, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [sport, setSport] = useState("boxing");
  const [videoReady, setVideoReady] = useState(false);
  const boundsRef = useRef<ReturnType<typeof poseBounds>[]>([]);

  useEffect(() => { boundsRef.current = poses.map(poseBounds); }, [poses]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !videoReady) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio;
    const dispW = canvas.clientWidth;
    const dispH = (video.videoHeight / video.videoWidth) * dispW;
    canvas.width = dispW * dpr; canvas.height = dispH * dpr;
    canvas.style.height = `${dispH}px`;
    ctx.scale(dpr, dpr);
    ctx.drawImage(video, 0, 0, dispW, dispH);
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, dispW, dispH);

    const scaleX = dispW / video.videoWidth;
    const scaleY = dispH / video.videoHeight;

    for (let pi = 0; pi < poses.length; pi++) {
      const pose = poses[pi];
      const bounds = boundsRef.current[pi];
      const isHovered = pi === hoveredIdx;
      const isSelected = pi === selectedIdx;

      if (bounds) {
        const bx = bounds.x * scaleX; const by = bounds.y * scaleY;
        const bw = bounds.w * scaleX; const bh = bounds.h * scaleY;

        ctx.fillStyle = isSelected ? "rgba(255, 255, 255, 0.1)" : isHovered ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.02)";
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill();

        ctx.strokeStyle = isSelected ? "rgba(255, 255, 255, 0.7)" : isHovered ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.stroke();

        const label = lang === "sr" ? `Borac ${pi + 1}` : `Fighter ${pi + 1}`;
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.fillStyle = isSelected ? "rgba(255,255,255,0.95)" : isHovered ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)";
        ctx.textAlign = "center";
        ctx.fillText(label, bx + bw / 2, by - 6);
        ctx.textAlign = "start";
      }

      for (const [a, b] of BODY_CONNECTIONS) {
        const pa = kp(pose, a); const pb = kp(pose, b);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * scaleX, pa.y * scaleY);
        ctx.lineTo(pb.x * scaleX, pb.y * scaleY);
        ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.8)" : isHovered ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();
      }
    }
  }, [poses, hoveredIdx, selectedIdx, videoReady, lang]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; const video = videoRef.current;
    if (!canvas || !video) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (video.videoWidth / rect.width);
    const my = (e.clientY - rect.top) * (video.videoHeight / rect.height);
    let found = -1;
    for (let i = 0; i < poses.length; i++) {
      const b = boundsRef.current[i];
      if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) { found = i; break; }
    }
    setHoveredIdx(found);
  }, [poses]);

  const handleClick = useCallback(() => {
    if (hoveredIdx >= 0) setSelectedIdx(hoveredIdx);
  }, [hoveredIdx]);

  const handleConfirm = useCallback(() => {
    if (selectedIdx >= 0) onSelect(selectedIdx, sport);
  }, [selectedIdx, sport, onSelect]);

  return (
    <div className="space-y-5">
      {/* Video with pose overlay */}
      <div className="rounded-xl overflow-hidden ring-1 ring-white/10">
        <video
          ref={videoRef} src={videoUrl} muted playsInline className="hidden"
          onLoadedData={() => { videoRef.current!.currentTime = 0.5; }}
          onSeeked={() => setVideoReady(true)}
        />
        <canvas
          ref={canvasRef} className="w-full cursor-pointer"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIdx(-1)}
          onClick={handleClick}
        />
      </div>

      {/* Sport selection */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
          {lang === "sr" ? "Izaberi sport" : "Select sport"}
        </p>
        <div className="flex gap-2">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSport(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sport === s.id
                  ? "bg-white text-black"
                  : "bg-zinc-800/80 text-zinc-400 hover:text-white border border-zinc-700/50"
              }`}
            >
              {lang === "sr" ? s.labelSr : s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Confirm button */}
      <button
        onClick={handleConfirm}
        disabled={selectedIdx < 0}
        className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
          selectedIdx >= 0
            ? "bg-white text-black hover:bg-zinc-200"
            : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
        }`}
      >
        {selectedIdx >= 0
          ? (lang === "sr" ? `Analiziraj borca ${selectedIdx + 1}` : `Analyze fighter ${selectedIdx + 1}`)
          : (lang === "sr" ? "Klikni na borca iznad" : "Click a fighter above")}
      </button>
    </div>
  );
}
