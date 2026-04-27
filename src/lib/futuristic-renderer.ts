import {
  type Pose,
  type Keypoint,
  KEYPOINT,
  BODY_JOINTS,
  BODY_CONNECTIONS,
  calcAngle,
  getGuardHeight,
} from "./pose-types";

const MIN_SCORE = 0.3;

function kp(pose: Pose, idx: number): Keypoint | null {
  const p = pose.keypoints[idx];
  return p && p.score >= MIN_SCORE ? p : null;
}

export function clearTrails() {}

export interface ActiveAnnotation {
  text: string;
  recommendation?: string;
  type: "error" | "warning" | "info" | "good";
  progress: number;
}

export function renderPoses(
  ctx: CanvasRenderingContext2D,
  poses: Pose[],
  w: number,
  h: number,
  videoW: number,
  videoH: number,
  isPaused: boolean,
  subjectIndex: number = -1,
  annotation: ActiveAnnotation | null = null
) {
  const scaleX = w / videoW;
  const scaleY = h / videoH;

  for (let pi = 0; pi < poses.length; pi++) {
    const pose = poses[pi];
    const isSubject = subjectIndex < 0 || pi === subjectIndex;
    const alpha = isSubject ? 0.75 : 0.1;
    const guard = getGuardHeight(pose);

    // ── Skeleton bones ─────────────────────────────
    for (const [a, b] of BODY_CONNECTIONS) {
      const pa = kp(pose, a);
      const pb = kp(pose, b);
      if (!pa || !pb) continue;

      const ax = pa.x * scaleX, ay = pa.y * scaleY;
      const bx = pb.x * scaleX, by = pb.y * scaleY;

      let lineColor = `rgba(255, 255, 255, ${alpha})`;
      if (isSubject) {
        const isLeftArm = (a === KEYPOINT.LEFT_SHOULDER && b === KEYPOINT.LEFT_ELBOW) ||
                          (a === KEYPOINT.LEFT_ELBOW && b === KEYPOINT.LEFT_WRIST);
        const isRightArm = (a === KEYPOINT.RIGHT_SHOULDER && b === KEYPOINT.RIGHT_ELBOW) ||
                           (a === KEYPOINT.RIGHT_ELBOW && b === KEYPOINT.RIGHT_WRIST);
        if (isLeftArm && guard.left >= 0) lineColor = guardColor(guard.left, alpha);
        else if (isRightArm && guard.right >= 0) lineColor = guardColor(guard.right, alpha);
      }

      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const segLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
      const perpX = segLen > 0 ? -(by - ay) / segLen : 0;
      const perpY = segLen > 0 ? (bx - ax) / segLen : 0;
      const cpx = mx + perpX * Math.min(segLen * 0.06, 3);
      const cpy = my + perpY * Math.min(segLen * 0.06, 3);

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      segLen > 20 ? ctx.quadraticCurveTo(cpx, cpy, bx, by) : ctx.lineTo(bx, by);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isSubject ? 1.5 : 0.7;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // ── Joint dots ─────────────────────────────────
    for (const ji of BODY_JOINTS) {
      const pt = kp(pose, ji);
      if (!pt) continue;
      ctx.beginPath();
      ctx.arc(pt.x * scaleX, pt.y * scaleY, isSubject ? 2 : 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${isSubject ? 0.85 : 0.12})`;
      ctx.fill();
    }

    // ── Head circle ────────────────────────────────
    if (isSubject) {
      const nose = kp(pose, KEYPOINT.NOSE);
      if (nose) {
        ctx.beginPath();
        ctx.arc(nose.x * scaleX, nose.y * scaleY, 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    // ── AR Annotation callouts (on subject only) ──
    if (isSubject && annotation) {
      drawARAnnotation(ctx, pose, guard, annotation, scaleX, scaleY, w, h);
    }

    // ── Angle arcs (paused only) ──────────────────
    if (isPaused && isSubject) {
      drawAngleArc(ctx, pose, KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_ELBOW, KEYPOINT.LEFT_WRIST, scaleX, scaleY);
      drawAngleArc(ctx, pose, KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_ELBOW, KEYPOINT.RIGHT_WRIST, scaleX, scaleY);
      drawAngleArc(ctx, pose, KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE, KEYPOINT.LEFT_ANKLE, scaleX, scaleY);
      drawAngleArc(ctx, pose, KEYPOINT.RIGHT_HIP, KEYPOINT.RIGHT_KNEE, KEYPOINT.RIGHT_ANKLE, scaleX, scaleY);
    }

    // ── HUD panel (paused only) ───────────────────
    if (isPaused && isSubject) {
      drawHUD(ctx, pose, guard, w, h);
    }
  }
}

// ── AR Annotation: circles on body + text callout ──────

function drawARAnnotation(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  guard: { left: number; right: number },
  annotation: ActiveAnnotation,
  scaleX: number,
  scaleY: number,
  w: number,
  h: number
) {
  // Fade in/out
  let alpha = 1;
  if (annotation.progress < 0.15) alpha = annotation.progress / 0.15;
  else if (annotation.progress > 0.8) alpha = (1 - annotation.progress) / 0.2;
  alpha = Math.max(0, Math.min(1, alpha));
  if (alpha <= 0) return;

  const annColor = annotation.type === "error" || annotation.type === "warning"
    ? { r: 239, g: 68, b: 68 }  // red
    : annotation.type === "good"
      ? { r: 34, g: 197, b: 94 } // green
      : { r: 96, g: 165, b: 250 }; // blue

  const colorStr = `rgba(${annColor.r}, ${annColor.g}, ${annColor.b}, ${alpha})`;
  const colorBg = `rgba(${annColor.r}, ${annColor.g}, ${annColor.b}, ${alpha * 0.12})`;

  // Determine what body part to highlight based on guard state
  const highlightParts: { x: number; y: number; radius: number; label: string }[] = [];

  if (guard.left >= 0 && guard.left < 0.4) {
    const lw = kp(pose, KEYPOINT.LEFT_WRIST);
    if (lw) highlightParts.push({ x: lw.x * scaleX, y: lw.y * scaleY, radius: 18, label: "Guard" });
  }
  if (guard.right >= 0 && guard.right < 0.4) {
    const rw = kp(pose, KEYPOINT.RIGHT_WRIST);
    if (rw) highlightParts.push({ x: rw.x * scaleX, y: rw.y * scaleY, radius: 18, label: "Guard" });
  }

  // If nothing specific, highlight torso area
  if (highlightParts.length === 0) {
    const ls = kp(pose, KEYPOINT.LEFT_SHOULDER);
    const rs = kp(pose, KEYPOINT.RIGHT_SHOULDER);
    if (ls && rs) {
      const cx = ((ls.x + rs.x) / 2) * scaleX;
      const cy = ((ls.y + rs.y) / 2) * scaleY;
      highlightParts.push({ x: cx, y: cy, radius: 30, label: "" });
    }
  }

  // Draw pulsing circles on highlighted parts
  const pulse = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
  for (const part of highlightParts) {
    // Outer pulse ring
    ctx.beginPath();
    ctx.arc(part.x, part.y, part.radius * (1 + pulse * 0.3), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${annColor.r}, ${annColor.g}, ${annColor.b}, ${alpha * 0.2 * pulse})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(part.x, part.y, part.radius, 0, Math.PI * 2);
    ctx.fillStyle = colorBg;
    ctx.fill();
    ctx.strokeStyle = colorStr;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label near circle
    if (part.label) {
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.fillStyle = colorStr;
      ctx.textAlign = "center";
      ctx.fillText(part.label, part.x, part.y - part.radius - 5);
      ctx.textAlign = "start";
    }
  }

  // ── Bottom text bar with observation + recommendation ──
  const fontSize = Math.max(11, Math.min(14, w * 0.017));
  const smallFont = Math.max(9, fontSize - 2);
  const hasRec = !!annotation.recommendation;
  const barH = hasRec ? fontSize + smallFont + 30 : fontSize + 20;
  const barY = h - barH;

  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(0, barY, w, barH);

  ctx.fillStyle = colorStr;
  ctx.fillRect(0, barY, 3, barH);

  ctx.globalAlpha = alpha;
  ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(annotation.text, 14, barY + fontSize + 5, w - 28);

  if (annotation.recommendation) {
    ctx.font = `400 ${smallFont}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(annotation.recommendation, 14, barY + fontSize + smallFont + 12, w - 28);
  }

  ctx.globalAlpha = 1;
}

function guardColor(height: number, alpha: number): string {
  if (height >= 0.6) return `rgba(255, 255, 255, ${alpha})`;
  if (height >= 0.35) return `rgba(234, 179, 8, ${alpha * 0.9})`;
  return `rgba(239, 68, 68, ${alpha * 0.9})`;
}

function drawAngleArc(
  ctx: CanvasRenderingContext2D,
  pose: Pose, aIdx: number, bIdx: number, cIdx: number,
  scaleX: number, scaleY: number
) {
  const a = kp(pose, aIdx); const b = kp(pose, bIdx); const c = kp(pose, cIdx);
  if (!a || !b || !c) return;
  const angle = calcAngle(a, b, c);
  const bx = b.x * scaleX, by = b.y * scaleY;
  const startAngle = Math.atan2(a.y * scaleY - by, a.x * scaleX - bx);
  const endAngle = Math.atan2(c.y * scaleY - by, c.x * scaleX - bx);
  ctx.beginPath();
  ctx.arc(bx, by, 12, startAngle, endAngle, false);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  const ta = (startAngle + endAngle) / 2;
  ctx.font = "9px monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.textAlign = "center";
  ctx.fillText(`${angle}°`, bx + Math.cos(ta) * 22, by + Math.sin(ta) * 22 + 3);
  ctx.textAlign = "start";
}

function drawHUD(
  ctx: CanvasRenderingContext2D, pose: Pose,
  guard: { left: number; right: number }, w: number, h: number
) {
  const ls = kp(pose, KEYPOINT.LEFT_SHOULDER); const rs = kp(pose, KEYPOINT.RIGHT_SHOULDER);
  const la = kp(pose, KEYPOINT.LEFT_ANKLE); const ra = kp(pose, KEYPOINT.RIGHT_ANKLE);
  let stance = -1;
  if (la && ra && ls && rs) {
    const sw = Math.sqrt((ls.x - rs.x) ** 2 + (ls.y - rs.y) ** 2);
    if (sw > 0) stance = Math.abs(la.x - ra.x) / sw;
  }
  const lines: string[] = [];
  if (guard.left >= 0) lines.push(`GUARD  L ${(guard.left * 100).toFixed(0)}%  R ${(guard.right * 100).toFixed(0)}%`);
  if (stance >= 0) lines.push(`STANCE ${stance.toFixed(1)}x`);
  if (lines.length === 0) return;

  const fs = 9, lh = fs + 4, pad = 7;
  const pw = 125, ph = lines.length * lh + pad * 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.beginPath(); ctx.roundRect(8, h - ph - 8, pw, ph, 5); ctx.fill();
  ctx.font = `${fs}px monospace`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  lines.forEach((l, i) => ctx.fillText(l, 8 + pad, h - ph - 8 + pad + (i + 1) * lh - 2));
}
