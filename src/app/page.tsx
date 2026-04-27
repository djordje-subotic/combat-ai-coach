"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import AnnotatedVideoPlayer, {
  type VideoPlayerHandle,
} from "@/components/AnnotatedVideoPlayer";
import { type Lang, t, CATEGORY_LABELS } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import FighterSelector from "@/components/FighterSelector";
import { FighterTracker, autoSelectFighter } from "@/lib/fighter-tracker";

interface AnalysisMoment {
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
  };
}

interface AnalysisResult {
  summary: string;
  sport: string;
  moments: AnalysisMoment[];
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
}

type PipelineStep = "idle" | "extracting" | "fighter-select" | "pose-collecting" | "analyzing" | "done" | "error";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <span className="font-mono text-zinc-500 tabular-nums">
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const pct = score / 10;
  const circumference = 2 * Math.PI * 45;
  const offset = circumference * (1 - pct);
  const color = score >= 7 ? "#22c55e" : score >= 4 ? "#eab308" : "#ef4444";

  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#1a1a2e" strokeWidth="6" />
        <circle
          cx="50" cy="50" r="45" fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="score-ring"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">/10</span>
      </div>
    </div>
  );
}

async function collectPoseData(
  videoUrl: string,
  frameTimestamps: number[],
  onProgress: (done: number, total: number) => void
) {
  const { initPoseDetector, detectPoses } = await import("@/lib/pose-engine");
  await initPoseDetector();
  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve) => { video.onloadeddata = () => resolve(); video.load(); });

  const results: { timestampSeconds: number; poses: { keypoints: { x: number; y: number; score: number; name: string }[] }[] }[] = [];
  for (let i = 0; i < frameTimestamps.length; i++) {
    video.currentTime = frameTimestamps[i];
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    await new Promise((r) => setTimeout(r, 50));
    const poses = await detectPoses(video);
    results.push({ timestampSeconds: frameTimestamps[i], poses });
    onProgress(i + 1, frameTimestamps.length);
  }
  video.remove();
  return results;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("sr");
  const [step, setStep] = useState<PipelineStep>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeMomentIdx, setActiveMomentIdx] = useState<number>(-1);
  const [selectedSubjectIdx, setSelectedSubjectIdx] = useState<number>(-1);
  const playerRef = useRef<VideoPlayerHandle>(null);

  // Intermediate data stored between pipeline phases
  const pipelineDataRef = useRef<{
    frames: { base64: string; timestampSeconds: number }[];
    firstFramePoses: { keypoints: { x: number; y: number; score: number; name: string }[] }[];
  } | null>(null);

  // Phase 1: Extract frames + detect poses on first frame
  const startPipeline = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) { setStep("error"); setError(t(lang, "invalidFile")); return; }
    if (file.size > MAX_FILE_SIZE) { setStep("error"); setError(`${t(lang, "fileTooLarge")} (${formatFileSize(file.size)})`); return; }
    setError(""); setResult(null); setSelectedSubjectIdx(-1);
    const objUrl = URL.createObjectURL(file);
    setVideoUrl(objUrl);

    try {
      setStep("extracting"); setStatusText(lang === "sr" ? "Izvlačenje frame-ova..." : "Extracting frames..."); setProgress(5);
      const formData = new FormData(); formData.append("video", file); formData.append("fps", "1");
      const extractRes = await fetch("/api/extract-frames", { method: "POST", body: formData });
      if (!extractRes.ok) { const body = await extractRes.json().catch(() => null); throw new Error(body?.error || "Frame extraction failed"); }
      const { frames } = await extractRes.json();
      setProgress(15);

      // Detect poses on first frame to allow fighter selection
      setStatusText(lang === "sr" ? "Detekcija boraca..." : "Detecting fighters...");
      const { initPoseDetector, detectPoses } = await import("@/lib/pose-engine");
      await initPoseDetector();

      const video = document.createElement("video");
      video.src = objUrl; video.muted = true; video.playsInline = true;
      await new Promise<void>((resolve) => { video.onloadeddata = () => resolve(); video.load(); });
      video.currentTime = 0.5;
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
      await new Promise((r) => setTimeout(r, 100));
      const firstPoses = await detectPoses(video);
      video.remove();

      pipelineDataRef.current = { frames, firstFramePoses: firstPoses };

      // Always show fighter select so user picks sport (and fighter if 2+ people)
      setStep("fighter-select");
      setProgress(20);
    } catch (err) { setStep("error"); setError(err instanceof Error ? err.message : "Something went wrong"); }
  }, [lang]);

  // Phase 2 (after fighter selection): Collect all poses + analyze
  const runAnalysis = useCallback(async (
    objUrl: string,
    frames: { base64: string; timestampSeconds: number }[],
    initialSubjectIdx: number,
    sport: string = "boxing"
  ) => {
    try {
      const { initPoseDetector, detectPoses } = await import("@/lib/pose-engine");
      await initPoseDetector();

      setStep("pose-collecting"); setProgress(25);
      const timestamps = frames.map((f) => f.timestampSeconds);

      // Create video for pose collection
      const video = document.createElement("video");
      video.src = objUrl; video.muted = true; video.playsInline = true;
      await new Promise<void>((resolve) => { video.onloadeddata = () => resolve(); video.load(); });

      // Detect poses on first frame to init tracker
      video.currentTime = timestamps[0] || 0;
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
      await new Promise((r) => setTimeout(r, 50));
      const firstPoses = await detectPoses(video);

      const tracker = new FighterTracker(firstPoses[initialSubjectIdx] ?? firstPoses[0]);
      const subjectIndices: number[] = [];
      const allPoses: { timestampSeconds: number; poses: { keypoints: { x: number; y: number; score: number; name: string }[] }[] }[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        video.currentTime = timestamps[i];
        await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
        await new Promise((r) => setTimeout(r, 50));
        const poses = await detectPoses(video);
        const subjectIdx = tracker.identify(poses);
        subjectIndices.push(subjectIdx);
        allPoses.push({ timestampSeconds: timestamps[i], poses });
        setProgress(Math.round(25 + ((i + 1) / timestamps.length) * 30));
        setStatusText(lang === "sr" ? `Praćenje borca: ${i + 1}/${timestamps.length}` : `Tracking fighter: ${i + 1}/${timestamps.length}`);
      }
      video.remove();
      setProgress(55);

      // Send to analysis
      setStep("analyzing"); setStatusText(lang === "sr" ? "AI trener analizira..." : "AI coach analyzing..."); setProgress(60);
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames, framePoses: allPoses, subjectIndices, lang, fps: 1, sport }),
      });
      if (!analyzeRes.ok) { const body = await analyzeRes.json().catch(() => null); throw new Error(body?.error || "Analysis failed"); }

      const reader = analyzeRes.body!.getReader(); const decoder = new TextDecoder(); let buffer = ""; let analysisResult: AnalysisResult | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "progress") { setStatusText(msg.detail); if (msg.step === "biomechanics") setProgress(65); else if (msg.step === "frames") setProgress(70); else if (msg.step === "analysis") setProgress(80); }
            else if (msg.type === "result") { analysisResult = msg.data; }
            else if (msg.type === "error") { throw new Error(msg.error); }
          } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }
      if (!analysisResult) throw new Error("No analysis result received");
      setProgress(100); setStep("done"); setResult(analysisResult);
    } catch (err) { setStep("error"); setError(err instanceof Error ? err.message : "Something went wrong"); }
  }, [lang]);

  const [selectedSport, setSelectedSport] = useState("boxing");

  const handleFighterSelect = useCallback((poseIndex: number, sport: string) => {
    setSelectedSubjectIdx(poseIndex);
    setSelectedSport(sport);
    const data = pipelineDataRef.current;
    if (data && videoUrl) {
      runAnalysis(videoUrl, data.frames, poseIndex, sport);
    }
  }, [videoUrl, runAnalysis]);

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) startPipeline(file); }, [startPipeline]);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) startPipeline(file); }, [startPipeline]);
  const seekToMoment = useCallback((seconds: number) => { playerRef.current?.seekTo(seconds); }, []);
  const reset = useCallback(() => { setStep("idle"); setResult(null); setError(""); setProgress(0); setActiveMomentIdx(-1); setSelectedSubjectIdx(-1); pipelineDataRef.current = null; if (videoUrl) URL.revokeObjectURL(videoUrl); setVideoUrl(null); }, [videoUrl]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleActiveMomentChange = useCallback((moment: any) => {
    if (!result || !moment) { setActiveMomentIdx(-1); return; }
    const idx = result.moments.findIndex((m) => m.seconds === moment.seconds);
    setActiveMomentIdx(idx);
    // Auto-scroll moment into view
    if (idx >= 0) {
      setTimeout(() => {
        document.getElementById(`moment-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [result]);

  const PIPELINE = [
    { key: "extracting", label: "Extract", icon: "01" },
    { key: "pose-collecting", label: "Pose AI", icon: "02" },
    { key: "analyzing", label: "Analyze", icon: "03" },
  ];
  const currentIdx = PIPELINE.findIndex((s) => s.key === step);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
      {/* Nav bar */}
      <nav className="flex items-center justify-between mb-16">
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-semibold text-sm tracking-tight">Combat AI Coach</span>
        </div>
        <div className="flex items-center gap-1 bg-zinc-900/80 rounded-lg p-0.5 border border-zinc-800">
          {(["sr", "en"] as Lang[]).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${lang === l ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>
              {l === "sr" ? "SR" : "EN"}
            </button>
          ))}
        </div>
      </nav>

      {/* ── IDLE: Upload ──────────────────────────── */}
      {step === "idle" && (
        <div className="animate-slide-up">
          <div className="text-center mb-12">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              {t(lang, "title")}
            </h1>
            <p className="text-zinc-500 text-lg max-w-lg mx-auto">{t(lang, "subtitle")}</p>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            className={`relative rounded-2xl p-12 sm:p-16 text-center transition-all duration-300 cursor-pointer gradient-border ${isDragging ? "pulse-ring" : ""}`}
          >
            <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" id="video-upload" />
            <label htmlFor="video-upload" className="cursor-pointer relative z-10">
              <div className={`w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center transition-all duration-300 ${isDragging ? "bg-cyan-500/20 scale-110" : "bg-zinc-800/80"}`}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`transition-colors ${isDragging ? "text-cyan-400" : "text-zinc-400"}`}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-lg font-medium mb-2 text-zinc-200">
                {isDragging ? t(lang, "dropZoneHover") : t(lang, "dropZone")}
              </p>
              <p className="text-zinc-500 text-sm max-w-sm mx-auto">{t(lang, "dropZoneFormats")}</p>
              <div className="flex items-center justify-center gap-3 mt-6">
                {["Boxing", "MMA", "Kickboxing", "BJJ"].map((s) => (
                  <span key={s} className="text-[10px] uppercase tracking-widest text-zinc-600 bg-zinc-800/50 px-2.5 py-1 rounded-full">{s}</span>
                ))}
              </div>
            </label>
          </div>
        </div>
      )}

      {/* ── FIGHTER SELECT ──────────────────────────── */}
      {step === "fighter-select" && videoUrl && pipelineDataRef.current && (
        <div className="animate-slide-up max-w-2xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-1">
              {lang === "sr" ? "Izaberi borca" : "Select fighter"}
            </h2>
            <p className="text-zinc-500 text-sm">
              {lang === "sr"
                ? "Klikni na borca kojeg želiš da analiziramo"
                : "Click on the fighter you want us to analyze"}
            </p>
          </div>
          <FighterSelector
            videoUrl={videoUrl}
            poses={pipelineDataRef.current.firstFramePoses}
            lang={lang}
            onSelect={handleFighterSelect}
          />
        </div>
      )}

      {/* ── PROCESSING ────────────────────────────── */}
      {(step === "extracting" || step === "pose-collecting" || step === "analyzing") && (
        <div className="animate-slide-up">
          <div className="gradient-border p-8 sm:p-10 rounded-2xl">
            {/* Pipeline steps */}
            <div className="flex items-center justify-between mb-8">
              {PIPELINE.map((s, i) => (
                <div key={s.key} className="flex items-center gap-3 flex-1">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                    i < currentIdx ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/30" :
                    i === currentIdx ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30 shadow-[0_0_12px_rgba(0,212,255,0.2)]" :
                    "bg-zinc-800/50 text-zinc-600"
                  }`}>
                    {i < currentIdx ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : s.icon}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${i === currentIdx ? "text-zinc-200" : "text-zinc-600"}`}>{s.label}</span>
                  {i < PIPELINE.length - 1 && (
                    <div className={`flex-1 h-px mx-2 transition-colors duration-500 ${i < currentIdx ? "bg-green-500/30" : "bg-zinc-800"}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Status */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-300">{statusText}</p>
              <ElapsedTimer />
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="progress-shimmer h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* ── ERROR ─────────────────────────────────── */}
      {step === "error" && (
        <div className="animate-slide-up">
          <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-8 glow-red">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              </div>
              <div className="flex-1">
                <p className="text-red-400 font-medium mb-1">{t(lang, "analysisFailed")}</p>
                <p className="text-red-300/70 text-sm mb-4">{error}</p>
                <button onClick={reset} className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-300">{t(lang, "tryAgain")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RESULTS ───────────────────────────────── */}
      {step === "done" && result && (
        <div className="space-y-6 animate-slide-up">
          {/* Summary bar */}
          <div className="gradient-border rounded-2xl p-6 glow-cyan">
            <div className="flex items-center gap-5">
              <ScoreRing score={result.overallScore} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold truncate">{t(lang, "analysisResults")}</h2>
                  <span className="text-[10px] uppercase tracking-widest text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded-full shrink-0">{result.sport}</span>
                </div>
                <p className="text-zinc-400 text-sm leading-relaxed line-clamp-3">{result.summary}</p>
              </div>
            </div>
            {/* Inline strengths / weaknesses */}
            {(result.strengths.length > 0 || result.weaknesses.length > 0) && (
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-zinc-800/50">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-green-400">{t(lang, "strengths")}</span>
                  <ul className="mt-1.5 space-y-1">
                    {result.strengths.map((s, i) => (
                      <li key={i} className="text-zinc-400 text-xs flex gap-1.5"><span className="text-green-500 shrink-0">+</span><span className="line-clamp-2">{s}</span></li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-red-400">{t(lang, "weaknesses")}</span>
                  <ul className="mt-1.5 space-y-1">
                    {result.weaknesses.map((w, i) => (
                      <li key={i} className="text-zinc-400 text-xs flex gap-1.5"><span className="text-red-500 shrink-0">-</span><span className="line-clamp-2">{w}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* ── SPLIT LAYOUT: Video (sticky) + Moments (scroll) ── */}
          {videoUrl && result.moments.length > 0 && (
            <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
              {/* Left: Sticky video */}
              <div className="lg:w-[60%] lg:sticky lg:top-4 shrink-0" id="video-player">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">{t(lang, "annotatedVideo")}</span>
                  <span className="text-[10px] text-cyan-400/40 uppercase tracking-widest">Pose AI</span>
                </div>
                <AnnotatedVideoPlayer
                  ref={playerRef}
                  videoUrl={videoUrl}
                  moments={result.moments}
                  lang={lang}
                  onActiveMomentChange={handleActiveMomentChange}
                  subjectIndex={selectedSubjectIdx}
                />
              </div>

              {/* Right: Scrollable moments panel */}
              <div className="lg:w-[40%] lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1 space-y-2">
                <div className="flex items-center justify-between mb-1 sticky top-0 bg-[#050507]/90 backdrop-blur-sm py-2 z-10">
                  <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">{t(lang, "momentBreakdown")}</span>
                  <span className="text-[10px] text-zinc-600">{result.moments.length} moments</span>
                </div>
                {result.moments.map((moment, i) => {
                  const isActive = i === activeMomentIdx;
                  const borderColor = moment.severity === "critical" ? "border-l-red-500" : moment.severity === "warning" ? "border-l-yellow-500" : "border-l-blue-500";
                  return (
                    <button
                      key={i}
                      id={`moment-${i}`}
                      onClick={() => seekToMoment(moment.seconds)}
                      className={`w-full text-left border-l-2 ${borderColor} rounded-r-lg p-3 transition-all group ${
                        isActive
                          ? "bg-cyan-500/8 ring-1 ring-cyan-500/20"
                          : "bg-zinc-900/40 hover:bg-zinc-800/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${isActive ? "text-cyan-400 bg-cyan-400/10" : "text-cyan-400/60 bg-cyan-400/5"}`}>{moment.timestamp}</span>
                        <span className="text-[10px] uppercase tracking-widest text-zinc-600">{CATEGORY_LABELS[lang][moment.category] ?? moment.category}</span>
                        {moment.severity === "critical" && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">{lang === "sr" ? "Kritično" : "Critical"}</span>}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`ml-auto transition-colors ${isActive ? "text-cyan-400" : "text-zinc-700 group-hover:text-cyan-400"}`}><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      </div>
                      <p className={`text-sm mb-1 ${isActive ? "text-white" : "text-zinc-300"}`}>{moment.observation}</p>
                      <p className="text-zinc-500 text-xs italic">{moment.recommendation}</p>
                      {moment.telemetry && (
                        <div className="flex gap-1.5 mt-1.5">
                          {moment.telemetry.guardHeight && (
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              Math.min(moment.telemetry.guardHeight.left, moment.telemetry.guardHeight.right) < 0.3
                                ? "bg-red-500/10 text-red-400/80" : "bg-zinc-800 text-zinc-500"
                            }`}>Guard L:{(moment.telemetry.guardHeight.left * 100).toFixed(0)}% R:{(moment.telemetry.guardHeight.right * 100).toFixed(0)}%</span>
                          )}
                          {moment.telemetry.stanceWidth !== undefined && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">Stance:{moment.telemetry.stanceWidth.toFixed(1)}x</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reset */}
          <div className="text-center pt-4">
            <button onClick={reset} className="px-6 py-2.5 text-sm bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/50 rounded-xl transition-all text-zinc-300 hover:text-white">
              {t(lang, "analyzeAnother")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
