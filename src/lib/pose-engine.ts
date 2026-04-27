/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Pose } from "./pose-types";

let detector: any = null;
let loading = false;

export type { Pose, Keypoint } from "./pose-types";
export {
  KEYPOINT,
  SKELETON_CONNECTIONS,
  calcAngle,
  getGuardHeight,
} from "./pose-types";

export async function initPoseDetector(): Promise<void> {
  if (detector || loading) return;
  loading = true;

  try {
    const tf = await import("@tensorflow/tfjs");
    await tf.setBackend("webgl");
    await tf.ready();
    const pd = await import("@tensorflow-models/pose-detection");

    detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
      modelType: pd.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableSmoothing: true,
      enableTracking: true,
    });
  } finally {
    loading = false;
  }
}

export async function detectPoses(video: HTMLVideoElement): Promise<Pose[]> {
  if (!detector) return [];
  if (video.readyState < 2) return [];

  try {
    const rawPoses = await detector.estimatePoses(video);
    return rawPoses.map((p: any) => ({
      id: p.id ?? undefined,
      keypoints: p.keypoints.map((kp: any) => ({
        x: kp.x,
        y: kp.y,
        score: kp.score ?? 0,
        name: kp.name ?? "",
      })),
    }));
  } catch {
    return [];
  }
}
