export type Keypoint = {
  x: number;
  y: number;
  score: number;
  name: string;
};

export type Pose = {
  id?: number;
  keypoints: Keypoint[];
};

/** Only render body joints, skip face keypoints for cleaner look */
export const BODY_JOINTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

/** Skeleton connections for body only (no face) */
export const BODY_CONNECTIONS: [number, number][] = [
  [5, 6], [5, 11], [6, 12], [11, 12],   // torso
  [5, 7], [7, 9],                         // left arm
  [6, 8], [8, 10],                        // right arm
  [11, 13], [13, 15],                     // left leg
  [12, 14], [14, 16],                     // right leg
];

export const KEYPOINT = {
  NOSE: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_EAR: 3,
  RIGHT_EAR: 4,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
  LEFT_KNEE: 13,
  RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,
  RIGHT_ANKLE: 16,
} as const;

export const SKELETON_CONNECTIONS: [number, number][] = [
  [KEYPOINT.LEFT_SHOULDER, KEYPOINT.RIGHT_SHOULDER],
  [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_HIP],
  [KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_HIP],
  [KEYPOINT.LEFT_HIP, KEYPOINT.RIGHT_HIP],
  [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_ELBOW],
  [KEYPOINT.LEFT_ELBOW, KEYPOINT.LEFT_WRIST],
  [KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_ELBOW],
  [KEYPOINT.RIGHT_ELBOW, KEYPOINT.RIGHT_WRIST],
  [KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE],
  [KEYPOINT.LEFT_KNEE, KEYPOINT.LEFT_ANKLE],
  [KEYPOINT.RIGHT_HIP, KEYPOINT.RIGHT_KNEE],
  [KEYPOINT.RIGHT_KNEE, KEYPOINT.RIGHT_ANKLE],
  [KEYPOINT.NOSE, KEYPOINT.LEFT_EYE],
  [KEYPOINT.NOSE, KEYPOINT.RIGHT_EYE],
  [KEYPOINT.LEFT_EYE, KEYPOINT.LEFT_EAR],
  [KEYPOINT.RIGHT_EYE, KEYPOINT.RIGHT_EAR],
];

export function calcAngle(a: Keypoint, b: Keypoint, c: Keypoint): number {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let angle = Math.abs(((ab - cb) * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return Math.round(angle);
}

export function getGuardHeight(
  pose: Pose
): { left: number; right: number } {
  const lWrist = pose.keypoints[KEYPOINT.LEFT_WRIST];
  const rWrist = pose.keypoints[KEYPOINT.RIGHT_WRIST];
  const lShoulder = pose.keypoints[KEYPOINT.LEFT_SHOULDER];
  const rShoulder = pose.keypoints[KEYPOINT.RIGHT_SHOULDER];
  const nose = pose.keypoints[KEYPOINT.NOSE];

  function guardPct(wrist: Keypoint, shoulder: Keypoint) {
    if (wrist.score < 0.3 || shoulder.score < 0.3 || nose.score < 0.3) return -1;
    const range = shoulder.y - nose.y;
    if (range === 0) return 0;
    const wristRelative = shoulder.y - wrist.y;
    return Math.max(0, Math.min(1, wristRelative / (range * 2)));
  }

  return {
    left: guardPct(lWrist, lShoulder),
    right: guardPct(rWrist, rShoulder),
  };
}
