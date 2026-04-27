import {
  type Pose,
  type Keypoint,
  KEYPOINT,
  calcAngle,
  getGuardHeight,
} from "./pose-types";
import { detectSportFromPoses } from "./sport-rules";

// ── Types ──────────────────────────────────────────────

export interface FramePoseData {
  timestampSeconds: number;
  poses: Pose[];
}

export interface PerFrameMetrics {
  timestampSeconds: number;
  personIndex: number;
  guardHeight: { left: number; right: number };
  elbowAngle: { left: number; right: number };
  kneeAngle: { left: number; right: number };
  stanceWidth: number;
  headOffCenter: number;
  torsoLean: number;
}

export interface CombatEvent {
  timestampSeconds: number;
  type: "punch" | "guard_drop" | "narrow_stance" | "wide_stance" | "excessive_lean";
  personIndex: number;
  details: string;
  severity: "info" | "warning" | "critical";
  confidence: number; // 0-1, how confident we are this is real
}

export interface TimeSeriesData {
  guardHeightAvg: { left: number; right: number };
  guardDropCount: number;
  guardDropTotalDuration: number;
  punchCount: number;
  avgStanceWidth: number;
  avgTorsoLean: number;
}

export interface BiomechanicalReport {
  frameMetrics: PerFrameMetrics[];
  events: CombatEvent[];
  timeSeries: TimeSeriesData;
  detectedSport: { sport: string; confidence: number };
  personCount: number;
  fps: number;
  /** Things the telemetry explicitly did NOT detect — tell Claude so it doesn't invent them */
  negatives: string[];
}

// ── Helpers ────────────────────────────────────────────

function kp(pose: Pose, idx: number, minScore = 0.3): Keypoint | null {
  const p = pose.keypoints[idx];
  return p && p.score >= minScore ? p : null;
}

function dist(a: Keypoint, b: Keypoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function shoulderWidth(pose: Pose): number {
  const ls = kp(pose, KEYPOINT.LEFT_SHOULDER);
  const rs = kp(pose, KEYPOINT.RIGHT_SHOULDER);
  if (!ls || !rs) return 0;
  return dist(ls, rs);
}

// ── Per-Frame Computation ──────────────────────────────

function computeFrameMetrics(
  pose: Pose,
  personIndex: number,
  timestampSeconds: number
): PerFrameMetrics | null {
  const sw = shoulderWidth(pose);
  if (sw < 10) return null; // too small / not enough data

  const guard = getGuardHeight(pose);

  const lShoulder = kp(pose, KEYPOINT.LEFT_SHOULDER);
  const lElbow = kp(pose, KEYPOINT.LEFT_ELBOW);
  const lWrist = kp(pose, KEYPOINT.LEFT_WRIST);
  const rShoulder = kp(pose, KEYPOINT.RIGHT_SHOULDER);
  const rElbow = kp(pose, KEYPOINT.RIGHT_ELBOW);
  const rWrist = kp(pose, KEYPOINT.RIGHT_WRIST);

  const leftElbowAngle =
    lShoulder && lElbow && lWrist ? calcAngle(lShoulder, lElbow, lWrist) : -1;
  const rightElbowAngle =
    rShoulder && rElbow && rWrist ? calcAngle(rShoulder, rElbow, rWrist) : -1;

  const lHip = kp(pose, KEYPOINT.LEFT_HIP);
  const lKnee = kp(pose, KEYPOINT.LEFT_KNEE);
  const lAnkle = kp(pose, KEYPOINT.LEFT_ANKLE);
  const rHip = kp(pose, KEYPOINT.RIGHT_HIP);
  const rKnee = kp(pose, KEYPOINT.RIGHT_KNEE);
  const rAnkle = kp(pose, KEYPOINT.RIGHT_ANKLE);

  const leftKneeAngle =
    lHip && lKnee && lAnkle ? calcAngle(lHip, lKnee, lAnkle) : -1;
  const rightKneeAngle =
    rHip && rKnee && rAnkle ? calcAngle(rHip, rKnee, rAnkle) : -1;

  let stanceWidth = -1;
  if (lAnkle && rAnkle && sw > 0) {
    stanceWidth = Math.abs(lAnkle.x - rAnkle.x) / sw;
  }

  const nose = kp(pose, KEYPOINT.NOSE);
  let headOffCenter = 0;
  if (nose && lHip && rHip) {
    const hipCenterX = (lHip.x + rHip.x) / 2;
    headOffCenter = (nose.x - hipCenterX) / sw;
  }

  let torsoLean = 0;
  if (lShoulder && rShoulder && lHip && rHip) {
    const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
    const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
    const hipMidX = (lHip.x + rHip.x) / 2;
    const hipMidY = (lHip.y + rHip.y) / 2;
    const dx = shoulderMidX - hipMidX;
    const dy = hipMidY - shoulderMidY;
    torsoLean = Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
  }

  return {
    timestampSeconds,
    personIndex,
    guardHeight: guard,
    elbowAngle: { left: leftElbowAngle, right: rightElbowAngle },
    kneeAngle: { left: leftKneeAngle, right: rightKneeAngle },
    stanceWidth,
    headOffCenter,
    torsoLean,
  };
}

// ── Temporal Analysis ──────────────────────────────────

function detectEvents(
  frameMetrics: PerFrameMetrics[],
  framePoses: FramePoseData[],
): CombatEvent[] {
  const events: CombatEvent[] = [];

  const byPerson = new Map<number, PerFrameMetrics[]>();
  for (const m of frameMetrics) {
    if (!byPerson.has(m.personIndex)) byPerson.set(m.personIndex, []);
    byPerson.get(m.personIndex)!.push(m);
  }

  for (const [personIdx, metrics] of byPerson) {
    metrics.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

    // ── Guard drop detection ────────────────────────────
    // Requires: guard below threshold for at least 1 full second (not 0.5)
    // with at least 2 consecutive frames confirming it
    let guardDropStart: number | null = null;
    let guardDropSide: "left" | "right" | "both" = "both";
    let consecutiveLowFrames = 0;

    for (const m of metrics) {
      const leftLow = m.guardHeight.left >= 0 && m.guardHeight.left < 0.35;
      const rightLow = m.guardHeight.right >= 0 && m.guardHeight.right < 0.35;
      const isDropped = leftLow || rightLow;

      if (isDropped) {
        consecutiveLowFrames++;
        if (guardDropStart === null && consecutiveLowFrames >= 2) {
          guardDropStart = m.timestampSeconds - 1; // started 1 frame ago
          guardDropSide = leftLow && rightLow ? "both" : leftLow ? "left" : "right";
        }
      } else {
        if (guardDropStart !== null) {
          const duration = m.timestampSeconds - guardDropStart;
          if (duration >= 1.0) {
            const guardL = (m.guardHeight.left * 100).toFixed(0);
            const guardR = (m.guardHeight.right * 100).toFixed(0);
            events.push({
              timestampSeconds: guardDropStart,
              type: "guard_drop",
              personIndex: personIdx,
              details: `${guardDropSide} guard dropped for ${duration.toFixed(1)}s (height at drop: L=${guardL}%, R=${guardR}%)`,
              severity: duration > 3 ? "critical" : duration > 1.5 ? "warning" : "info",
              confidence: Math.min(1, consecutiveLowFrames / 4),
            });
          }
        }
        guardDropStart = null;
        consecutiveLowFrames = 0;
      }
    }

    // ── Punch detection ─────────────────────────────────
    // STRICT: wrist must move forward (toward opponent) with high velocity
    // AND elbow must extend (angle increase) — this rules out arm swings, adjustments
    for (let i = 1; i < metrics.length; i++) {
      const prev = metrics[i - 1];
      const curr = metrics[i];
      const dt = curr.timestampSeconds - prev.timestampSeconds;
      if (dt <= 0 || dt > 1.5) continue;

      const prevFrame = framePoses.find(
        (f) => Math.abs(f.timestampSeconds - prev.timestampSeconds) < 0.2
      );
      const currFrame = framePoses.find(
        (f) => Math.abs(f.timestampSeconds - curr.timestampSeconds) < 0.2
      );
      if (!prevFrame || !currFrame) continue;

      const prevPose = prevFrame.poses[personIdx];
      const currPose = currFrame.poses[personIdx];
      if (!prevPose || !currPose) continue;

      for (const side of ["left", "right"] as const) {
        const wristIdx = side === "left" ? KEYPOINT.LEFT_WRIST : KEYPOINT.RIGHT_WRIST;
        const elbowIdx = side === "left" ? KEYPOINT.LEFT_ELBOW : KEYPOINT.RIGHT_ELBOW;
        const shoulderIdx = side === "left" ? KEYPOINT.LEFT_SHOULDER : KEYPOINT.RIGHT_SHOULDER;

        const prevWrist = kp(prevPose, wristIdx);
        const currWrist = kp(currPose, wristIdx);
        const prevElbow = kp(prevPose, elbowIdx);
        const currElbow = kp(currPose, elbowIdx);
        const currShoulder = kp(currPose, shoulderIdx);

        if (!prevWrist || !currWrist || !prevElbow || !currElbow || !currShoulder) continue;

        const wristVelocity = dist(prevWrist, currWrist) / dt;

        // Check 1: wrist must be moving fast enough
        if (wristVelocity < 120) continue;

        // Check 2: elbow must be extending (angle increasing = arm straightening)
        const prevElbowAngle = calcAngle(
          kp(prevPose, shoulderIdx) ?? currShoulder,
          prevElbow,
          prevWrist
        );
        const currElbowAngle = calcAngle(currShoulder, currElbow, currWrist);
        const elbowExtension = currElbowAngle - prevElbowAngle;
        if (elbowExtension < 10) continue; // arm didn't extend — not a punch

        // Check 3: wrist must be moving AWAY from shoulder (forward, not pulling back)
        const prevWristShoulderDist = dist(prevWrist, kp(prevPose, shoulderIdx) ?? currShoulder);
        const currWristShoulderDist = dist(currWrist, currShoulder);
        if (currWristShoulderDist <= prevWristShoulderDist) continue; // pulling back, not punching

        events.push({
          timestampSeconds: curr.timestampSeconds,
          type: "punch",
          personIndex: personIdx,
          details: `${side} punch (wrist velocity: ${wristVelocity.toFixed(0)}, elbow extended +${elbowExtension.toFixed(0)}°)`,
          severity: "info",
          confidence: Math.min(1, wristVelocity / 200),
        });
      }
    }

    // ── Stance issues ───────────────────────────────────
    // Only flag if persists for 2+ seconds
    let narrowStart: number | null = null;
    let narrowCount = 0;
    for (const m of metrics) {
      if (m.stanceWidth >= 0 && m.stanceWidth < 0.5) {
        narrowCount++;
        if (narrowStart === null && narrowCount >= 2) narrowStart = m.timestampSeconds - 1;
      } else {
        if (narrowStart !== null && m.timestampSeconds - narrowStart >= 2) {
          events.push({
            timestampSeconds: narrowStart,
            type: "narrow_stance",
            personIndex: personIdx,
            details: `Narrow stance (${m.stanceWidth.toFixed(1)}x shoulder width) for ${(m.timestampSeconds - narrowStart).toFixed(1)}s`,
            severity: "warning",
            confidence: 0.7,
          });
        }
        narrowStart = null;
        narrowCount = 0;
      }
    }

    // ── Excessive lean ──────────────────────────────────
    let leanStart: number | null = null;
    let leanCount = 0;
    for (const m of metrics) {
      if (m.torsoLean > 25) {
        leanCount++;
        if (leanStart === null && leanCount >= 2) leanStart = m.timestampSeconds - 1;
      } else {
        if (leanStart !== null && m.timestampSeconds - leanStart >= 1.5) {
          events.push({
            timestampSeconds: leanStart,
            type: "excessive_lean",
            personIndex: personIdx,
            details: `Excessive torso lean (${m.torsoLean.toFixed(0)}°) for ${(m.timestampSeconds - leanStart).toFixed(1)}s — off-balance`,
            severity: "warning",
            confidence: 0.6,
          });
        }
        leanStart = null;
        leanCount = 0;
      }
    }
  }

  // Deduplicate events within 2 seconds of same type + person
  events.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const deduped: CombatEvent[] = [];
  for (const e of events) {
    // Only keep events with reasonable confidence
    if (e.confidence < 0.3) continue;
    const last = deduped[deduped.length - 1];
    if (!last || e.timestampSeconds - last.timestampSeconds > 2 || e.type !== last.type || e.personIndex !== last.personIndex) {
      deduped.push(e);
    }
  }

  return deduped;
}

// ── Main ───────────────────────────────────────────────

export function computeBiomechanics(
  framePoses: FramePoseData[],
  fps: number,
  subjectIndices?: number[]
): BiomechanicalReport {
  const allMetrics: PerFrameMetrics[] = [];
  let maxPersons = 0;

  for (let fi = 0; fi < framePoses.length; fi++) {
    const frame = framePoses[fi];
    maxPersons = Math.max(maxPersons, frame.poses.length);

    // If we have subject tracking, only analyze the subject
    if (subjectIndices && subjectIndices[fi] >= 0) {
      const pi = subjectIndices[fi];
      if (pi < frame.poses.length) {
        const m = computeFrameMetrics(frame.poses[pi], 0, frame.timestampSeconds);
        if (m) allMetrics.push(m);
      }
    } else {
      // No tracking — analyze all (fallback)
      for (let pi = 0; pi < frame.poses.length; pi++) {
        const m = computeFrameMetrics(frame.poses[pi], pi, frame.timestampSeconds);
        if (m) allMetrics.push(m);
      }
    }
  }

  const events = detectEvents(allMetrics, framePoses);

  const validGuards = allMetrics.filter(
    (m) => m.guardHeight.left >= 0 && m.guardHeight.right >= 0
  );
  const avgGuardL =
    validGuards.length > 0
      ? validGuards.reduce((s, m) => s + m.guardHeight.left, 0) / validGuards.length
      : 0;
  const avgGuardR =
    validGuards.length > 0
      ? validGuards.reduce((s, m) => s + m.guardHeight.right, 0) / validGuards.length
      : 0;

  const guardDropEvents = events.filter((e) => e.type === "guard_drop");
  const punchEvents = events.filter((e) => e.type === "punch");

  const validStances = allMetrics.filter((m) => m.stanceWidth >= 0);
  const avgStanceWidth =
    validStances.length > 0
      ? validStances.reduce((s, m) => s + m.stanceWidth, 0) / validStances.length
      : 1.2;

  const avgTorsoLean =
    allMetrics.length > 0
      ? allMetrics.reduce((s, m) => s + m.torsoLean, 0) / allMetrics.length
      : 0;

  // Build negatives list — things we specifically did NOT detect
  const negatives: string[] = [];
  const hasKickEvents = false; // We removed kick detection entirely — too unreliable at 1fps
  negatives.push("No kicks were detected by telemetry. Do NOT mention kicks unless clearly visible in a frame AND you are very confident.");
  if (punchEvents.length === 0) {
    negatives.push("No punches were detected by telemetry. Do not claim specific punches were thrown.");
  }
  if (guardDropEvents.length === 0) {
    negatives.push("No guard drops were detected. Guard was maintained at acceptable levels throughout.");
  }

  const detectedSport = detectSportFromPoses(
    avgStanceWidth,
    (avgGuardL + avgGuardR) / 2,
    hasKickEvents,
    avgStanceWidth > 2.2
  );

  return {
    frameMetrics: allMetrics,
    events,
    timeSeries: {
      guardHeightAvg: { left: avgGuardL, right: avgGuardR },
      guardDropCount: guardDropEvents.length,
      guardDropTotalDuration: guardDropEvents.reduce((s, e) => {
        const match = e.details.match(/([\d.]+)s/);
        return s + (match ? parseFloat(match[1]) : 0);
      }, 0),
      punchCount: punchEvents.length,
      avgStanceWidth,
      avgTorsoLean,
    },
    detectedSport,
    personCount: maxPersons,
    fps,
    negatives,
  };
}
