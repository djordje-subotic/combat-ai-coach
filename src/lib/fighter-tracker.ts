import type { Pose, Keypoint } from "./pose-types";
import { KEYPOINT } from "./pose-types";

function kp(pose: Pose, idx: number, min = 0.25): Keypoint | null {
  const p = pose.keypoints[idx];
  return p && p.score >= min ? p : null;
}

function torsoCenter(pose: Pose): { x: number; y: number } | null {
  const ls = kp(pose, KEYPOINT.LEFT_SHOULDER);
  const rs = kp(pose, KEYPOINT.RIGHT_SHOULDER);
  const lh = kp(pose, KEYPOINT.LEFT_HIP);
  const rh = kp(pose, KEYPOINT.RIGHT_HIP);
  const pts = [ls, rs, lh, rh].filter(Boolean) as Keypoint[];
  if (pts.length < 2) return null;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

function shoulderWidth(pose: Pose): number {
  const ls = kp(pose, KEYPOINT.LEFT_SHOULDER);
  const rs = kp(pose, KEYPOINT.RIGHT_SHOULDER);
  if (!ls || !rs) return 0;
  return Math.sqrt((ls.x - rs.x) ** 2 + (ls.y - rs.y) ** 2);
}

export class FighterTracker {
  private lastCenter: { x: number; y: number };
  private anchorShoulderWidth: number;
  private lastValidIndex: number = 0;
  private framesLost: number = 0;
  private static readonly MAX_LOST_FRAMES = 5; // hold position for up to 5 frames when occluded

  constructor(initialPose: Pose) {
    const center = torsoCenter(initialPose);
    this.lastCenter = center ?? { x: 0, y: 0 };
    this.anchorShoulderWidth = shoulderWidth(initialPose) || 80;
  }

  identify(poses: Pose[]): number {
    if (poses.length === 0) {
      this.framesLost++;
      // Return last known index if within tolerance
      return this.framesLost <= FighterTracker.MAX_LOST_FRAMES ? this.lastValidIndex : -1;
    }
    if (poses.length === 1) {
      this.updatePosition(poses[0]);
      this.lastValidIndex = 0;
      this.framesLost = 0;
      return 0;
    }

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < poses.length; i++) {
      const center = torsoCenter(poses[i]);
      if (!center) continue;

      const dx = center.x - this.lastCenter.x;
      const dy = center.y - this.lastCenter.y;
      const posDist = Math.sqrt(dx * dx + dy * dy);

      const sw = shoulderWidth(poses[i]);
      const sizeDiff = sw > 0 ? Math.abs(sw - this.anchorShoulderWidth) / this.anchorShoulderWidth : 0.5;

      const score = posDist * 3 + sizeDiff * this.anchorShoulderWidth;

      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    // If best match is too far, DON'T update position — fighter might be occluded
    // Keep returning last valid index for a few frames
    if (bestIdx >= 0 && bestScore > this.anchorShoulderWidth * 9) {
      this.framesLost++;
      return this.framesLost <= FighterTracker.MAX_LOST_FRAMES ? this.lastValidIndex : -1;
    }

    if (bestIdx >= 0) {
      this.updatePosition(poses[bestIdx]);
      this.lastValidIndex = bestIdx;
      this.framesLost = 0;
    }

    return bestIdx;
  }

  private updatePosition(pose: Pose) {
    const center = torsoCenter(pose);
    if (center) this.lastCenter = center;
  }
}

/**
 * Auto-select the most prominent person in the first frame.
 * Picks the person with the most visible keypoints and largest shoulder width (closest to camera).
 */
export function autoSelectFighter(poses: Pose[]): number {
  if (poses.length <= 1) return 0;

  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < poses.length; i++) {
    const visibleCount = poses[i].keypoints.filter((k) => k.score >= 0.3).length;
    const sw = shoulderWidth(poses[i]);
    const score = visibleCount * 10 + sw;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}
