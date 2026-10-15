// 瞄准预览：白球沿方向的圆扫描（球视为半径 R 的动圆，扫过半径 2R 检测碰球、偏移 R 检测库边）。
// 用于辅助线渲染与 AI 通路检测。

import { BALL_R } from './spec';
import type { Ball } from './solver';
import type { Seg } from './table';

export interface AimPreview {
  /** 白球将停在与目标球相碰的位置（幽灵球） */
  ghostX: number;
  ghostZ: number;
  /** 首先撞到的目标球 id（无则 null） */
  hitBall: number | null;
  /** 目标球去向（沿连心线），无则 null */
  targetDirX: number;
  targetDirZ: number;
  /** 白球分离方向（切线方向），无则 null */
  cueDirX: number;
  cueDirZ: number;
  /** 切角余弦（1=直球，0=极限薄球） */
  cutCos: number;
}

const R2 = BALL_R * 2;

export function castCue(balls: Ball[], cueId: number, dirX: number, dirZ: number): AimPreview {
  const cue = balls.find((b) => b.id === cueId)!;
  let bestT = Infinity;
  let hitBall: number | null = null;

  for (const b of balls) {
    if (b.id === cueId || !b.active) continue;
    const ox = b.x - cue.x;
    const oz = b.z - cue.z;
    const proj = ox * dirX + oz * dirZ;
    if (proj <= 0) continue;
    const perpSq = ox * ox + oz * oz - proj * proj;
    const rr = R2 * R2;
    if (perpSq >= rr) continue;
    const t = proj - Math.sqrt(rr - perpSq);
    if (t > 1e-6 && t < bestT) {
      bestT = t;
      hitBall = b.id;
    }
  }

  let segT = Infinity;
  if (segsCache.length) {
    // 库边以线段内偏 R 的平行线近似
    for (const s of segsCache) {
      const t = raySeg(cue.x, cue.z, dirX, dirZ, s);
      if (t !== null && t < segT) segT = t;
    }
  }

  const res: AimPreview = {
    ghostX: 0,
    ghostZ: 0,
    hitBall: null,
    targetDirX: 0,
    targetDirZ: 0,
    cueDirX: 0,
    cueDirZ: 0,
    cutCos: 0,
  };

  if (hitBall !== null && bestT < segT) {
    res.hitBall = hitBall;
    res.ghostX = cue.x + dirX * bestT;
    res.ghostZ = cue.z + dirZ * bestT;
    const ob = balls.find((b) => b.id === hitBall)!;
    let tx = ob.x - res.ghostX;
    let tz = ob.z - res.ghostZ;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    res.targetDirX = tx;
    res.targetDirZ = tz;
    res.cutCos = tx * dirX + tz * dirZ;
    // 白球分离沿切线（动量近似分解）
    let cx = dirX - res.cutCos * tx;
    let cz = dirZ - res.cutCos * tz;
    const cl = Math.hypot(cx, cz);
    if (cl > 1e-6) {
      res.cueDirX = cx / cl;
      res.cueDirZ = cz / cl;
    }
  } else if (segT < Infinity) {
    res.ghostX = cue.x + dirX * segT;
    res.ghostZ = cue.z + dirZ * segT;
  } else {
    res.ghostX = cue.x + dirX * 3;
    res.ghostZ = cue.z + dirZ * 3;
  }
  return res;
}

/** 线段缓存（渲染/AI 初始化时设置） */
let segsCache: Array<{ ax: number; az: number; bx: number; bz: number }> = [];
export function setPreviewSegments(segs: Seg[]): void {
  // 库边面向台内偏移 R：碰撞时球心位于 seg + R*n
  segsCache = segs.map((s) => {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    // 内法线（n 指向球来的那边）= 方向旋转 -90°，与 spec 一致
    const nx = s.nx;
    const nz = s.nz;
    void len;
    return {
      ax: s.ax + nx * BALL_R,
      az: s.az + nz * BALL_R,
      bx: s.bx + nx * BALL_R,
      bz: s.bz + nz * BALL_R,
    };
  });
}

function raySeg(px: number, pz: number, dx: number, dz: number, s: { ax: number; az: number; bx: number; bz: number }): number | null {
  const ex = s.bx - s.ax;
  const ez = s.bz - s.az;
  const denom = dx * ez - dz * ex;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = s.ax - px;
  const qz = s.az - pz;
  const t = (qx * ez - qz * ex) / denom; // 射线参数
  const u = (qx * dz - qz * dx) / denom; // 线段参数（注意符号）
  if (t > 1e-6 && u >= 0 && u <= 1) return t;
  return null;
}

/** 目标球到袋口的直线通路上是否有其他球阻挡（AI 用） */
export function pathClear(balls: Ball[], fromX: number, fromZ: number, toX: number, toZ: number, ignoreIds: number[]): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return true;
  const ux = dx / len;
  const uz = dz / len;
  for (const b of balls) {
    if (!b.active || ignoreIds.includes(b.id)) continue;
    const ox = b.x - fromX;
    const oz = b.z - fromZ;
    const proj = ox * ux + oz * uz;
    if (proj < -BALL_R || proj > len + BALL_R) continue;
    const perp = Math.abs(ox * uz - oz * ux);
    if (perp < R2 * 0.98) return false;
  }
  return true;
}
