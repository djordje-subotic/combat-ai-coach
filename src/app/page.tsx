"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import AnnotatedVideoPlayer, {
  type VideoPlayerHandle,
} from "@/components/AnnotatedVideoPlayer";
import { type Lang, t, CATEGORY_LABELS } from "@/lib/i18n";

interface AnalysisMoment {
  timestamp: string;
  seconds: number;
  duration: number;
  category: "defense" | "offense" | "positioning" | "movement" | "critical";
  severity: "info" | "warning" | "critical";
  observation: string;
  recommendation: string;
}

interface AnalysisResult {
  summary: string;
  sport: string;
  moments: AnalysisMoment[];
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
}

type PipelineStep =
  | "idle"
  | "extracting"
  | "scanning"
  | "analyzing"
  | "done"
  | "error";

const SEVERITY_COLORS = {
  info: "border-blue-500 bg-blue-500/10",
  warning: "border-yellow-500 bg-yellow-500/10",
  critical: "border-red-500 bg-red-500/10",
};

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
    <span className="font-mono text-neutral-500 text-sm">
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
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
  const playerRef = useRef<VideoPlayerHandle>(null);

  const runPipeline = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("video/")) {
        setStep("error");
        setError(t(lang, "invalidFile"));
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setStep("error");
        setError(`${t(lang, "fileTooLarge")} (${formatFileSize(file.size)})`);
        return;
      }

      setError("");
      setResult(null);

      try {
        setVideoUrl(URL.createObjectURL(file));

        setStep("extracting");
        setStatusText(t(lang, "extracting"));
        setProgress(10);

        const formData = new FormData();
        formData.append("video", file);
        formData.append("fps", "1");

        const extractRes = await fetch("/api/extract-frames", {
          method: "POST",
          body: formData,
        });

        if (!extractRes.ok) {
          const body = await extractRes.json().catch(() => null);
          throw new Error(
            body?.error || `Frame extraction failed (${extractRes.status})`
          );
        }

        const { frames, duration, frameCount } = await extractRes.json();
        setStatusText(
          `${frameCount} frame-ova iz ${Math.round(duration)}s videa`
        );
        setProgress(25);

        setStep("scanning");
        setStatusText(t(lang, "scanning"));
        setProgress(30);

        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames, lang }),
        });

        if (!analyzeRes.ok) {
          const body = await analyzeRes.json().catch(() => null);
          throw new Error(
            body?.error || `Analysis failed (${analyzeRes.status})`
          );
        }

        // Read NDJSON stream
        const reader = analyzeRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let analysisResult: AnalysisResult | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "progress") {
                if (msg.step === "scan") {
                  setStep("scanning");
                  setStatusText(msg.detail);
                  setProgress(40);
                } else if (msg.step === "detail") {
                  setStep("analyzing");
                  setStatusText(msg.detail);
                  const match = msg.detail.match(/(\d+)\/(\d+)/);
                  if (match) {
                    const pct =
                      50 + (parseInt(match[1]) / parseInt(match[2])) * 40;
                    setProgress(Math.round(pct));
                  }
                } else if (msg.step === "summary") {
                  setStatusText(msg.detail);
                  setProgress(95);
                }
              } else if (msg.type === "result") {
                analysisResult = msg.data;
              } else if (msg.type === "error") {
                throw new Error(msg.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }

        if (!analysisResult) {
          throw new Error("No analysis result received");
        }

        setProgress(100);
        setStep("done");
        setResult(analysisResult);
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    },
    [lang]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) runPipeline(file);
    },
    [runPipeline]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) runPipeline(file);
    },
    [runPipeline]
  );

  const seekToMoment = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
    document
      .getElementById("video-player")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const reset = useCallback(() => {
    setStep("idle");
    setResult(null);
    setError("");
    setProgress(0);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
  }, [videoUrl]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      {/* Language selector */}
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">{t(lang, "language")}:</span>
          <button
            onClick={() => setLang("sr")}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              lang === "sr"
                ? "bg-white text-black font-medium"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Srpski
          </button>
          <button
            onClick={() => setLang("en")}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              lang === "en"
                ? "bg-white text-black font-medium"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            English
          </button>
        </div>
      </div>

      <header className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-2">{t(lang, "title")}</h1>
        <p className="text-neutral-400 text-lg">{t(lang, "subtitle")}</p>
      </header>

      {/* Upload zone */}
      {step === "idle" && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`border-2 border-dashed rounded-2xl p-16 text-center transition-colors cursor-pointer ${
            isDragging
              ? "border-blue-400 bg-blue-500/5"
              : "border-neutral-600 hover:border-neutral-400"
          }`}
        >
          <input
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
            id="video-upload"
          />
          <label htmlFor="video-upload" className="cursor-pointer">
            <div className="text-5xl mb-4">&#127909;</div>
            <p className="text-xl font-medium mb-2">
              {isDragging ? t(lang, "dropZoneHover") : t(lang, "dropZone")}
            </p>
            <p className="text-neutral-500">{t(lang, "dropZoneFormats")}</p>
            <p className="text-neutral-600 text-sm mt-4">
              {t(lang, "dropZoneSports")}
            </p>
          </label>
        </div>
      )}

      {/* Processing status */}
      {(step === "extracting" ||
        step === "scanning" ||
        step === "analyzing") && (
        <div className="border border-neutral-700 rounded-2xl p-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              <span className="text-lg font-medium">{statusText}</span>
            </div>
            <ElapsedTimer />
          </div>
          <div className="w-full bg-neutral-800 rounded-full h-3">
            <div
              className="bg-blue-500 h-3 rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-neutral-500 text-sm mt-3">
            {step === "extracting" && t(lang, "extracting")}
            {step === "scanning" && t(lang, "scanning")}
            {step === "analyzing" && t(lang, "detailAnalysis")}
          </p>

          <div className="flex items-center gap-2 mt-4 text-xs">
            {["extracting", "scanning", "analyzing"].map((s, i) => {
              const steps = ["extracting", "scanning", "analyzing"];
              const currentIdx = steps.indexOf(step);
              const thisIdx = i;
              const isDone = thisIdx < currentIdx;
              const isCurrent = thisIdx === currentIdx;
              const labels = [
                "Extract",
                "Scan",
                "Detail",
              ];
              return (
                <span key={s}>
                  {i > 0 && <span className="text-neutral-700 mr-2">-</span>}
                  <span
                    className={
                      isCurrent
                        ? "text-blue-400"
                        : isDone
                          ? "text-green-600"
                          : "text-neutral-600"
                    }
                  >
                    {isDone ? "+" : isCurrent ? ">" : "."} {labels[i]}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Error state */}
      {step === "error" && (
        <div className="border border-red-800 bg-red-900/20 rounded-2xl p-8">
          <p className="text-red-400 font-medium mb-2">
            {t(lang, "analysisFailed")}
          </p>
          <p className="text-red-300 text-sm mb-4">{error}</p>
          <button
            onClick={reset}
            className="px-4 py-2 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors"
          >
            {t(lang, "tryAgain")}
          </button>
        </div>
      )}

      {/* Results */}
      {step === "done" && result && (
        <div className="space-y-8">
          {/* Score + Summary */}
          <div className="border border-neutral-700 rounded-2xl p-8">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold mb-1">
                  {t(lang, "analysisResults")}
                </h2>
                <p className="text-neutral-400 capitalize">
                  {t(lang, "detectedSport")}: {result.sport} —{" "}
                  {result.moments.length} {t(lang, "momentsFound")}
                </p>
              </div>
              <div className="text-center">
                <div
                  className={`text-5xl font-bold ${
                    result.overallScore >= 7
                      ? "text-green-400"
                      : result.overallScore >= 4
                        ? "text-yellow-400"
                        : "text-red-400"
                  }`}
                >
                  {result.overallScore}
                </div>
                <div className="text-neutral-500 text-sm">/10</div>
              </div>
            </div>
            <p className="text-neutral-300 leading-relaxed">{result.summary}</p>
          </div>

          {/* Strengths & Weaknesses */}
          {(result.strengths.length > 0 || result.weaknesses.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="border border-green-800 bg-green-900/10 rounded-xl p-6">
                <h3 className="font-semibold text-green-400 mb-3">
                  {t(lang, "strengths")}
                </h3>
                <ul className="space-y-2">
                  {result.strengths.map((s, i) => (
                    <li
                      key={i}
                      className="text-neutral-300 text-sm flex gap-2"
                    >
                      <span className="text-green-500 shrink-0">+</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border border-red-800 bg-red-900/10 rounded-xl p-6">
                <h3 className="font-semibold text-red-400 mb-3">
                  {t(lang, "weaknesses")}
                </h3>
                <ul className="space-y-2">
                  {result.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="text-neutral-300 text-sm flex gap-2"
                    >
                      <span className="text-red-500 shrink-0">-</span> {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Annotated Video Player */}
          {videoUrl && result.moments.length > 0 && (
            <div id="video-player">
              <h3 className="text-xl font-bold mb-3">
                {t(lang, "annotatedVideo")}
              </h3>
              <p className="text-neutral-500 text-sm mb-4">
                {t(lang, "videoHelp")}
              </p>
              <AnnotatedVideoPlayer
                ref={playerRef}
                videoUrl={videoUrl}
                moments={result.moments}
                lang={lang}
              />
            </div>
          )}

          {/* Moment-by-moment breakdown */}
          {result.moments.length > 0 && (
            <div>
              <h3 className="text-xl font-bold mb-1">
                {t(lang, "momentBreakdown")}
              </h3>
              <p className="text-neutral-500 text-sm mb-4">
                {t(lang, "momentBreakdownHelp")}
              </p>
              <div className="space-y-3">
                {result.moments.map((moment, i) => (
                  <button
                    key={i}
                    onClick={() => seekToMoment(moment.seconds)}
                    className={`w-full text-left border-l-4 rounded-r-xl p-4 hover:bg-neutral-800/50 transition-colors ${SEVERITY_COLORS[moment.severity]}`}
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-sm bg-neutral-800 px-2 py-0.5 rounded">
                        {moment.timestamp}
                      </span>
                      <span className="text-xs uppercase tracking-wider text-neutral-500">
                        {CATEGORY_LABELS[lang][moment.category] ??
                          moment.category}
                      </span>
                      {moment.severity === "critical" && (
                        <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
                          {lang === "sr" ? "Kritično" : "Critical"}
                        </span>
                      )}
                    </div>
                    <p className="text-neutral-200 text-sm mb-1">
                      {moment.observation}
                    </p>
                    <p className="text-neutral-400 text-sm italic">
                      {moment.recommendation}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New analysis */}
          <div className="text-center pt-4">
            <button
              onClick={reset}
              className="px-6 py-3 bg-neutral-800 rounded-xl hover:bg-neutral-700 transition-colors font-medium"
            >
              {t(lang, "analyzeAnother")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
