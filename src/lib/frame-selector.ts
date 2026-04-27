import type { BiomechanicalReport, CombatEvent } from "./biomechanics";

export interface SelectedFrame {
  base64: string;
  timestampSeconds: number;
  telemetryContext: string;
}

/**
 * Select the most important frames based on biomechanical events.
 * Returns at most `maxFrames` frames with telemetry context for each.
 */
export function selectKeyFrames(
  report: BiomechanicalReport,
  frames: { base64: string; timestampSeconds: number }[],
  maxFrames: number = 8
): SelectedFrame[] {
  if (frames.length === 0) return [];

  // Score each frame based on events happening at/near that timestamp
  const frameScores: { frame: typeof frames[0]; score: number; events: CombatEvent[] }[] =
    frames.map((frame) => {
      const nearbyEvents = report.events.filter(
        (e) => Math.abs(e.timestampSeconds - frame.timestampSeconds) <= 0.6
      );

      let score = 0;
      for (const e of nearbyEvents) {
        if (e.severity === "critical") score += 10;
        else if (e.severity === "warning") score += 5;
        else score += 2;

        if (e.type === "punch") score += 3;
        if (e.type === "guard_drop") score += 4;
      }

      return { frame, score, events: nearbyEvents };
    });

  // Sort by score descending
  frameScores.sort((a, b) => b.score - a.score);

  // Select top frames, ensuring minimum 2 seconds apart
  const selected: SelectedFrame[] = [];
  const usedTimestamps: number[] = [];

  for (const candidate of frameScores) {
    if (selected.length >= maxFrames) break;
    if (candidate.score === 0) break;

    const tooClose = usedTimestamps.some(
      (t) => Math.abs(t - candidate.frame.timestampSeconds) < 2
    );
    if (tooClose) continue;

    // Build telemetry context string
    const metrics = report.frameMetrics.find(
      (m) =>
        Math.abs(m.timestampSeconds - candidate.frame.timestampSeconds) < 0.6
    );

    let context = `Timestamp: ${candidate.frame.timestampSeconds.toFixed(1)}s`;
    if (metrics) {
      if (metrics.guardHeight.left >= 0) {
        context += ` | Guard: L=${(metrics.guardHeight.left * 100).toFixed(0)}%, R=${(metrics.guardHeight.right * 100).toFixed(0)}%`;
      }
      if (metrics.stanceWidth >= 0) {
        context += ` | Stance: ${metrics.stanceWidth.toFixed(1)}x shoulder`;
      }
      if (metrics.elbowAngle.left >= 0) {
        context += ` | Elbow: L=${metrics.elbowAngle.left}°, R=${metrics.elbowAngle.right}°`;
      }
      context += ` | Lean: ${metrics.torsoLean.toFixed(1)}°`;
    }
    if (candidate.events.length > 0) {
      context +=
        " | Events: " + candidate.events.map((e) => e.details).join("; ");
    }

    selected.push({
      base64: candidate.frame.base64,
      timestampSeconds: candidate.frame.timestampSeconds,
      telemetryContext: context,
    });
    usedTimestamps.push(candidate.frame.timestampSeconds);
  }

  // If we have fewer than 3 selected, add evenly spaced frames for context
  if (selected.length < 3 && frames.length >= 3) {
    const step = Math.floor(frames.length / 3);
    for (let i = 0; i < 3 && selected.length < maxFrames; i++) {
      const frame = frames[i * step];
      const alreadySelected = selected.some(
        (s) => Math.abs(s.timestampSeconds - frame.timestampSeconds) < 2
      );
      if (!alreadySelected) {
        selected.push({
          base64: frame.base64,
          timestampSeconds: frame.timestampSeconds,
          telemetryContext: `Timestamp: ${frame.timestampSeconds.toFixed(1)}s (context frame)`,
        });
      }
    }
  }

  // Sort by time
  selected.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  return selected;
}
