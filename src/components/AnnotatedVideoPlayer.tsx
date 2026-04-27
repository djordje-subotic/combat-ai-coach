"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { Lang } from "@/lib/i18n";
import type { Pose } from "@/lib/pose-types";

interface Moment {
  timestamp: string;
  seconds: number;
  duration: number;
  category: string;
  severity: "info" | "warning" | "critical";
  observation: string;
  recommendation: string;
}

interface Props {
  videoUrl: string;
  moments: Moment[];
  lang: Lang;
  onActiveMomentChange?: (moment: Moment | null) => void;
  subjectIndex?: number;
}

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
}

function computeZoomTarget(
  pose: Pose,
  videoW: number,
  videoH: number
): { x: number; y: number; scale: number } {
  const MIN_SCORE = 0.25;
  // Upper body focus: shoulders, elbows, wrists, hips
  const indices = [5, 6, 7, 8, 9, 10, 11, 12];
  let sumX = 0, sumY = 0, count = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const idx of indices) {
    const kp = pose.keypoints[idx];
    if (kp && kp.score >= MIN_SCORE) {
      sumX += kp.x; sumY += kp.y; count++;
      minX = Math.min(minX, kp.x); minY = Math.min(minY, kp.y);
      maxX = Math.max(maxX, kp.x); maxY = Math.max(maxY, kp.y);
    }
  }

  if (count === 0) return { x: 0.5, y: 0.5, scale: 1.0 };

  const cx = (sumX / count) / videoW;
  const cy = (sumY / count) / videoH;
  const bboxW = (maxX - minX) / videoW;
  const bboxH = (maxY - minY) / videoH;
  const regionSize = Math.max(bboxW, bboxH, 0.25);
  const scale = Math.min(1.7, Math.max(1.25, 0.55 / regionSize));

  const halfView = 0.5 / scale;
  return {
    x: Math.max(halfView, Math.min(1 - halfView, cx)),
    y: Math.max(halfView, Math.min(1 - halfView, cy)),
    scale,
  };
}

const AnnotatedVideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  function AnnotatedVideoPlayer({ videoUrl, moments, lang, onActiveMomentChange, subjectIndex = -1 }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const [activeMoment, setActiveMoment] = useState<Moment | null>(null);
    const [poseReady, setPoseReady] = useState(false);
    const [poseLoading, setPoseLoading] = useState(false);
    const [zoomState, setZoomState] = useState<{ x: number; y: number; scale: number } | null>(null);
    const wasInMomentRef = useRef(false);
    const activeMomentRef = useRef<Moment | null>(null);
    const poseEngineRef = useRef<typeof import("@/lib/pose-engine") | null>(null);
    const rendererRef = useRef<typeof import("@/lib/futuristic-renderer") | null>(null);

    // Load pose engine
    useEffect(() => {
      let cancelled = false;
      setPoseLoading(true);
      (async () => {
        try {
          const [pe, renderer] = await Promise.all([import("@/lib/pose-engine"), import("@/lib/futuristic-renderer")]);
          if (cancelled) return;
          poseEngineRef.current = pe; rendererRef.current = renderer;
          await pe.initPoseDetector();
          if (!cancelled) setPoseReady(true);
        } catch (err) { console.warn("Pose detection failed:", err); }
        finally { if (!cancelled) setPoseLoading(false); }
      })();
      return () => { cancelled = true; };
    }, []);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        const video = videoRef.current;
        if (video) {
          wasInMomentRef.current = false;
          video.playbackRate = 1.0;
          setActiveMoment(null); setZoomState(null);
          activeMomentRef.current = null;
          rendererRef.current?.clearTrails();
          video.currentTime = seconds;
          video.play();
        }
      },
    }));

    // Notify parent
    useEffect(() => { onActiveMomentChange?.(activeMoment); }, [activeMoment, onActiveMomentChange]);

    // ── Cinematic render loop ────────────────────────
    const renderLoop = useCallback(async () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) { animFrameRef.current = requestAnimationFrame(renderLoop); return; }

      const ctx = canvas.getContext("2d");
      if (!ctx) { animFrameRef.current = requestAnimationFrame(renderLoop); return; }

      const rect = video.getBoundingClientRect();
      const dpr = window.devicePixelRatio;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (poseReady && poseEngineRef.current && rendererRef.current && video.readyState >= 2) {
        const poses = await poseEngineRef.current.detectPoses(video);

        if (poses.length > 0) {
          // ── Find active moment ──────────────────────
          const time = video.currentTime;
          let currentMoment: Moment | null = null;
          let annotation: import("@/lib/futuristic-renderer").ActiveAnnotation | null = null;

          for (const m of moments) {
            if (time >= m.seconds - 0.5 && time <= m.seconds + m.duration) {
              currentMoment = m;
              const elapsed = time - (m.seconds - 0.5);
              const total = m.duration + 0.5;
              annotation = {
                text: m.observation,
                recommendation: m.recommendation,
                type: m.severity === "critical" ? "error" : m.severity === "warning" ? "warning" : "info",
                progress: elapsed / total,
              };
              break;
            }
          }

          // ── Update state if moment changed ──────────
          if (currentMoment !== activeMomentRef.current) {
            activeMomentRef.current = currentMoment;
            setActiveMoment(currentMoment);
          }

          // ── Cinematic: zoom + slowmo ────────────────
          if (currentMoment && !video.paused) {
            const subjectPose = subjectIndex >= 0 && subjectIndex < poses.length
              ? poses[subjectIndex] : poses[0];
            const target = computeZoomTarget(subjectPose, video.videoWidth, video.videoHeight);
            setZoomState(target);

            if (!wasInMomentRef.current) {
              video.playbackRate = 0.25;
              wasInMomentRef.current = true;
            }
          } else if (!currentMoment) {
            if (wasInMomentRef.current) {
              video.playbackRate = 1.0;
              wasInMomentRef.current = false;
            }
            setZoomState(null);
          }

          // ── Render skeleton + annotations ───────────
          const showDetails = annotation !== null || video.paused;
          rendererRef.current.renderPoses(
            ctx, poses, rect.width, rect.height,
            video.videoWidth, video.videoHeight,
            showDetails, subjectIndex, annotation
          );
        }
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    }, [poseReady, subjectIndex, moments]);

    useEffect(() => {
      animFrameRef.current = requestAnimationFrame(renderLoop);
      return () => cancelAnimationFrame(animFrameRef.current);
    }, [renderLoop]);

    // CSS transform for zoom
    const transformStyle = zoomState
      ? `scale(${zoomState.scale}) translate(${((0.5 - zoomState.x) * 100) / zoomState.scale}%, ${((0.5 - zoomState.y) * 100) / zoomState.scale}%)`
      : "scale(1) translate(0%, 0%)";

    return (
      <div className="space-y-3">
        <div
          className="relative rounded-xl overflow-hidden bg-black ring-1 ring-zinc-800"
          style={{
            transform: transformStyle,
            transition: "transform 0.8s cubic-bezier(0.33, 0, 0.2, 1)",
            transformOrigin: "center center",
          }}
        >
          <video ref={videoRef} src={videoUrl} controls className="w-full block" playsInline />
          <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />

          {poseLoading && (
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-md px-2.5 py-1 text-[9px] text-white/40 uppercase tracking-widest">
              <div className="animate-spin h-2 w-2 border border-white/40 border-t-transparent rounded-full" />
              Loading
            </div>
          )}
          {poseReady && !poseLoading && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/40 backdrop-blur-md rounded-md px-2 py-0.5 text-[9px] text-white/30 uppercase tracking-widest">
              <span className="w-1 h-1 rounded-full bg-white/50 animate-pulse" />Tracking
            </div>
          )}

          {/* Slow-mo indicator */}
          {zoomState && (
            <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-md rounded-md px-2 py-0.5 text-[9px] text-white/50 uppercase tracking-widest">
              0.25x
            </div>
          )}
        </div>

        {/* Timeline */}
        {moments.length > 0 && (
          <TimelineDots
            moments={moments}
            videoRef={videoRef}
            onSeek={() => {
              wasInMomentRef.current = false;
              setZoomState(null); setActiveMoment(null);
              activeMomentRef.current = null;
              rendererRef.current?.clearTrails();
            }}
          />
        )}
      </div>
    );
  }
);

function TimelineDots({ moments, videoRef, onSeek }: {
  moments: Moment[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSeek: () => void;
}) {
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const onMeta = () => setDuration(video.duration);
    video.addEventListener("loadedmetadata", onMeta);
    if (video.duration) setDuration(video.duration);
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, [videoRef]);

  if (!duration) return null;

  return (
    <div className="relative h-1.5 bg-zinc-800/80 rounded-full">
      {moments.map((m, i) => {
        const left = (m.seconds / duration) * 100;
        const bg = m.severity === "critical" ? "bg-red-500" : m.severity === "warning" ? "bg-yellow-500" : "bg-blue-500";
        return (
          <button key={i} onClick={() => {
            const video = videoRef.current;
            if (video) { onSeek(); video.playbackRate = 1.0; video.currentTime = m.seconds; video.play(); }
          }}
            className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${bg} hover:scale-[1.8] transition-transform cursor-pointer ring-2 ring-black`}
            style={{ left: `${Math.min(98, Math.max(2, left))}%` }}
            title={m.timestamp}
          />
        );
      })}
    </div>
  );
}

export default AnnotatedVideoPlayer;
