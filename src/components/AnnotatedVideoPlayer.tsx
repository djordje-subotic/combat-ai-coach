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
import { t } from "@/lib/i18n";

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
}

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
}

const SEVERITY_STYLES = {
  info: {
    border: "border-blue-500",
    bg: "bg-blue-500/10",
    icon: "border-blue-400 text-blue-400",
    bar: "bg-blue-500",
  },
  warning: {
    border: "border-yellow-500",
    bg: "bg-yellow-500/10",
    icon: "border-yellow-400 text-yellow-400",
    bar: "bg-yellow-500",
  },
  critical: {
    border: "border-red-500",
    bg: "bg-red-500/10",
    icon: "border-red-400 text-red-400",
    bar: "bg-red-500",
  },
};

const SEVERITY_ICONS = {
  info: "\u2139",      // ℹ
  warning: "\u26A0",   // ⚠
  critical: "\u2757",  // ❗
};

const AnnotatedVideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  function AnnotatedVideoPlayer({ videoUrl, moments, lang }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [activeMoment, setActiveMoment] = useState<Moment | null>(null);
    const [isPausedForMoment, setIsPausedForMoment] = useState(false);
    const pausedMomentsRef = useRef<Set<number>>(new Set());
    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        const video = videoRef.current;
        if (video) {
          // Reset paused tracking so moment can trigger again
          pausedMomentsRef.current.clear();
          setIsPausedForMoment(false);
          setActiveMoment(null);
          video.currentTime = seconds;
          video.play();
        }
      },
    }));

    // Check every 100ms if we've hit a moment
    const startChecking = useCallback(() => {
      if (checkIntervalRef.current) return;
      checkIntervalRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.paused) return;

        const time = video.currentTime;
        for (const m of moments) {
          // Trigger within 0.3s window of the moment start
          if (
            time >= m.seconds - 0.15 &&
            time <= m.seconds + 0.3 &&
            !pausedMomentsRef.current.has(m.seconds)
          ) {
            pausedMomentsRef.current.add(m.seconds);
            video.pause();
            video.currentTime = m.seconds;
            setActiveMoment(m);
            setIsPausedForMoment(true);
            return;
          }
        }
      }, 100);
    }, [moments]);

    const stopChecking = useCallback(() => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    }, []);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const onPlay = () => startChecking();
      const onPause = () => {
        if (!isPausedForMoment) stopChecking();
      };
      const onSeeked = () => {
        // If user manually seeks, dismiss the overlay
        if (isPausedForMoment) {
          setIsPausedForMoment(false);
          setActiveMoment(null);
        }
      };

      video.addEventListener("play", onPlay);
      video.addEventListener("pause", onPause);
      video.addEventListener("seeked", onSeeked);

      return () => {
        video.removeEventListener("play", onPlay);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("seeked", onSeeked);
        stopChecking();
      };
    }, [startChecking, stopChecking, isPausedForMoment]);

    // Cleanup on unmount
    useEffect(() => () => stopChecking(), [stopChecking]);

    const handleContinue = useCallback(() => {
      const video = videoRef.current;
      setIsPausedForMoment(false);
      setActiveMoment(null);
      if (video) {
        video.play();
      }
    }, []);

    const styles = activeMoment ? SEVERITY_STYLES[activeMoment.severity] : null;

    return (
      <div className="space-y-2">
        <div className="relative rounded-2xl overflow-hidden border border-neutral-700">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="w-full block"
            playsInline
          />

          {/* Coach overlay — shown when paused at a moment */}
          {isPausedForMoment && activeMoment && styles && (
            <div className="absolute inset-0 flex items-end justify-center p-4 pointer-events-none">
              {/* Dim overlay */}
              <div className="absolute inset-0 bg-black/40" />

              {/* Coach card */}
              <div
                className={`relative pointer-events-auto w-full max-w-2xl rounded-xl border-2 ${styles.border} ${styles.bg} backdrop-blur-sm overflow-hidden`}
              >
                {/* Severity bar */}
                <div className={`h-1 ${styles.bar}`} />

                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className={`w-8 h-8 rounded-full border-2 ${styles.icon} flex items-center justify-center text-sm font-bold shrink-0`}
                    >
                      {SEVERITY_ICONS[activeMoment.severity]}
                    </span>
                    <div>
                      <span className="font-mono text-sm text-neutral-400">
                        {activeMoment.timestamp}
                      </span>
                      <span className="text-neutral-600 mx-2">|</span>
                      <span className="text-xs uppercase tracking-wider text-neutral-500">
                        {activeMoment.category}
                      </span>
                    </div>
                  </div>

                  {/* Observation */}
                  <div className="mb-3">
                    <p className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                      {t(lang, "observation")}
                    </p>
                    <p className="text-white text-sm leading-relaxed">
                      {activeMoment.observation}
                    </p>
                  </div>

                  {/* Recommendation */}
                  <div className="mb-4">
                    <p className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                      {t(lang, "recommendation")}
                    </p>
                    <p className="text-neutral-300 text-sm leading-relaxed italic">
                      {activeMoment.recommendation}
                    </p>
                  </div>

                  {/* Continue button */}
                  <button
                    onClick={handleContinue}
                    className="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white text-sm font-medium"
                  >
                    {t(lang, "continueVideo")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Timeline dots */}
        {moments.length > 0 && videoRef.current && (
          <div className="relative h-2 bg-neutral-800 rounded-full mx-1">
            {moments.map((m, i) => {
              const video = videoRef.current;
              const duration = video?.duration || 1;
              const left = (m.seconds / duration) * 100;
              const color =
                m.severity === "critical"
                  ? "bg-red-500"
                  : m.severity === "warning"
                    ? "bg-yellow-500"
                    : "bg-blue-500";
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (video) {
                      pausedMomentsRef.current.clear();
                      setIsPausedForMoment(false);
                      setActiveMoment(null);
                      video.currentTime = m.seconds;
                      video.play();
                    }
                  }}
                  className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${color} hover:scale-150 transition-transform cursor-pointer`}
                  style={{ left: `${Math.min(98, Math.max(2, left))}%` }}
                  title={`${m.timestamp} — ${m.observation.slice(0, 50)}`}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

export default AnnotatedVideoPlayer;
