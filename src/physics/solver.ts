// 台球物理求解器。
// 模型：球在水平面运动，状态为平面位置/速度 + 三维角速度。
// - 滑动阶段：台呢摩擦同时衰减质心速度并改变角速度，直到接触点相对速度为零（纯滚动）
// - 纯滚动阶段：只受滚动阻力；竖直轴旋转（塞）单独衰减
// - 球-球碰撞：法向脉冲（恢复系数）+ 切向库仑摩擦（throw 效应）
// - 库边碰撞：接触点在鼻部（高于球心），法向脉冲 + 切向摩擦，自动涌现塞改变反弹角、高/低杆改变反弹距离
// 全部以单位质量计算，确定性：不使用任何随机数。

import { BALL_R, INV_I, PHYS } from './spec';
import type { Seg, Pocket, TableGeometry } from './table';

export interface Ball {
  id: number; // 0 为白球，1..15
  x: number;
  z: number;
  vx: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  active: boolean; // 在台上参与运动
  pocketed: boolean;
}

export type EventType = 'ball-ball' | 'cushion' | 'pocket';

export interface PhysEvent {
  type: EventType;
  /** 涉及球 id；ball-ball 为 [a,b]，cushion/pocket 为 [id] */
  balls: number[];
  /** 撞击法向速度（音量用）；pocket 无意义 */
  speed: number;
  /** 事件发生的时间（秒，自击球起） */
  t: number;
  /** pocket 事件的袋口 id */
  pocket?: number;
  seg?: number;
}

export interface World {
  balls: Ball[];
  segs: Seg[];
  pockets: Pocket[];
  events: PhysEvent[];
  time: number;
}

const R = BALL_R;
const H = 0.001; // 物理子步长 1ms：最大球速下每步位移约 8mm，远小于球半径，不会穿透
const CUSH_DX = PHYS.noseHeight - R; // 库边接触点高于球心
const CUSH_RHO = Math.sqrt(R * R - CUSH_DX * CUSH_DX); // 接触点的水平偏距

export function makeBall(id: number, x: number, z: number): Ball {
  return { id, x, z, vx: 0, vz: 0, wx: 0, wy: 0, wz: 0, active: true, pocketed: false };
}

export function createWorld(balls: Ball[], geom: TableGeometry): World {
  return {
    balls,
    segs: geom.segs,
    pockets: geom.pockets,
    events: [],
    time: 0,
  };
}

export function cloneBalls(balls: Ball[]): Ball[] {
  return balls.map((b) => ({ ...b }));
}

export function cloneWorld(w: World): World {
  return { balls: cloneBalls(w.balls), segs: w.segs, pockets: w.pockets, events: [], time: 0 };
}

/** 击球：dir 单位方向，power 0..1，spinA/spinB 为击点偏移（单位：球半径的比例，±0.5 内）。
 *  spinB>0 高杆、spinB<0 低杆、spinA>0 右塞、spinA<0 左塞。 */
export function strike(cue: Ball, dirX: number, dirZ: number, power: number, spinA: number, spinB: number): void {
  const v = Math.max(0.02, Math.min(1, power)) * PHYS.maxCueSpeed;
  cue.vx = dirX * v;
  cue.vz = dirZ * v;
  // 纯滚动的角速度为 (vz, 0, -vx)/R；偏心击球按 (5/2)(b/R) 放大（spinB 即 b/R）
  const kB = 2.5 * spinB;
  cue.wx = (cue.vz / R) * kB;
  cue.wz = (-cue.vx / R) * kB;
  // 右塞：绕竖直轴
  cue.wy = 2.5 * spinA * (v / R);
}

/** 贴合纯滚动约束：施加滚动阻力并将 ω 设为滚动角速度 */
function snapToRoll(b: Ball, h: number): void {
  const vMag = Math.hypot(b.vx, b.vz);
  if (vMag > PHYS.stopEps) {
    const nv = Math.max(0, vMag - PHYS.muRoll * PHYS.g * h);
    b.vx = (b.vx / vMag) * nv;
    b.vz = (b.vz / vMag) * nv;
  } else {
    b.vx = 0;
    b.vz = 0;
  }
  if (b.vx === 0 && b.vz === 0) {
    b.wx = 0;
    b.wz = 0;
  } else {
    b.wx = b.vz / R;
    b.wz = -b.vx / R;
  }
}

/** 单个球一个子步的运动学积分（摩擦模型核心） */
function integrate(b: Ball, h: number): void {
  // 台面接触点相对滑速 u = (vx + R*wz, vz - R*wx)
  const ux = b.vx + R * b.wz;
  const uz = b.vz - R * b.wx;
  const uMag = Math.hypot(ux, uz);

  if (uMag > PHYS.slideEps) {
    // 滑动阶段。注意：滑速衰减率为 3.5μg（v 与 ω 的耦合），若整步衰减量超过当前滑速，
    // 直接积分会过冲翻转，形成周期 2 极限环（微小滑速永不消失）。因此按精确过渡时间积分。
    const slipDecayRate = 3.5 * PHYS.muSlide * PHYS.g;
    const tSlide = Math.min(h, uMag / slipDecayRate);
    const inv = 1 / uMag;
    b.vx += -PHYS.muSlide * PHYS.g * ux * inv * tSlide;
    b.vz += -PHYS.muSlide * PHYS.g * uz * inv * tSlide;
    // 角速度变化 dω = (5μg/2R)(ûz, 0, -ûx)
    const wRate = (2.5 * PHYS.muSlide * PHYS.g) / R;
    b.wx += wRate * uz * inv * tSlide;
    b.wz += -wRate * ux * inv * tSlide;
    if (tSlide < h) {
      // 本子步内滑动结束：剩余时间按纯滚动处理，并贴合滚动约束
      const hRem = h - tSlide;
      snapToRoll(b, hRem);
    }
  } else {
    // 纯滚动：维持滚动约束，受滚动阻力
    snapToRoll(b, h);
  }

  // 竖直塞独立衰减
  if (b.wy !== 0) {
    const decay = ((5 * PHYS.muSpin * PHYS.g) / (2 * R)) * h;
    if (Math.abs(b.wy) <= decay) b.wy = 0;
    else b.wy -= Math.sign(b.wy) * decay;
  }

  b.x += b.vx * h;
  b.z += b.vz * h;
}

/** 对球施加接触点冲量（单位质量）。垂直方向的速度变化被忽略（球始终贴台面），但扭矩保留。 */
function applyImpulse(b: Ball, jx: number, jy: number, jz: number, rx: number, ry: number, rz: number): void {
  b.vx += jx;
  b.vz += jz;
  // Δω = (r × J) * INV_I
  b.wx += (ry * jz - rz * jy) * INV_I;
  b.wy += (rz * jx - rx * jz) * INV_I;
  b.wz += (rx * jy - ry * jx) * INV_I;
}

/** 球表面接触点的速度（3D，y 分量为竖直分量） */
function contactVel(b: Ball, rx: number, ry: number, rz: number): { x: number; y: number; z: number } {
  // ω × r
  const cx = b.wy * rz - b.wz * ry;
  const cy = b.wz * rx - b.wx * rz;
  const cz = b.wx * ry - b.wy * rx;
  return { x: b.vx + cx, y: cy, z: b.vz + cz };
}

function resolveBallBall(a: Ball, b: Ball, w: World, h: number): void {
  void h;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  if (distSq >= 4 * R * R || distSq === 0) return;
  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;

  // 位置修正
  const overlap = 2 * R - dist;
  a.x -= (nx * overlap) / 2;
  a.z -= (nz * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.z += (nz * overlap) / 2;

  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return;

  // 法向冲量（等质量）：jn = -(1+e)vn / 2，沿 n 施加于 b，反向施加于 a
  const jn = (-(1 + PHYS.eBall) * vn) / 2;
  applyImpulse(a, -jn * nx, 0, -jn * nz, R * nx, 0, R * nz);
  applyImpulse(b, jn * nx, 0, jn * nz, -R * nx, 0, -R * nz);

  // 切向（throw）：接触点相对滑速，排除法向分量
  const va = contactVel(a, R * nx, 0, R * nz);
  const vb = contactVel(b, -R * nx, 0, -R * nz);
  let tx = vb.x - va.x;
  const ty = vb.y - va.y;
  let tz = vb.z - va.z;
  const dotN = tx * nx + tz * nz;
  tx -= dotN * nx;
  tz -= dotN * nz;
  const tMag = Math.hypot(tx, ty, tz);
  if (tMag > 1e-4) {
    // 两等质量球、接触点与切向垂直时，单位冲量对相对滑速的改变为 7（每球 1+5/2）
    const jt = Math.min((PHYS.muBall * Math.abs(jn)), tMag / 7);
    const jx = (-jt * tx) / tMag;
    const jy = (-jt * ty) / tMag;
    const jz = (-jt * tz) / tMag;
    applyImpulse(a, -jx, -jy, -jz, R * nx, 0, R * nz);
    applyImpulse(b, jx, jy, jz, -R * nx, 0, -R * nz);
  }

  if (-vn > 0.03) {
    w.events.push({ type: 'ball-ball', balls: [a.id, b.id], speed: -vn, t: w.time });
  }
}

function resolveCushion(b: Ball, seg: Seg, segIdx: number, w: World): void {
  // 圆-线段最近点
  const abx = seg.bx - seg.ax;
  const abz = seg.bz - seg.az;
  const lenSq = abx * abx + abz * abz;
  let t = ((b.x - seg.ax) * abx + (b.z - seg.az) * abz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = seg.ax + abx * t;
  const qz = seg.az + abz * t;
  let dx = b.x - qx;
  let dz = b.z - qz;
  let d = Math.hypot(dx, dz);
  if (d >= R) return;
  let nx: number, nz: number;
  if (d < 1e-9) {
    nx = seg.nx;
    nz = seg.nz;
    d = 0;
  } else {
    nx = dx / d;
    nz = dz / d;
  }

  // 位置修正
  b.x = qx + nx * R;
  b.z = qz + nz * R;

  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return;

  // 接触点：从球心指向库边（-n 方向），且高于球心 CUSH_DX
  const rx = -CUSH_RHO * nx;
  const ry = CUSH_DX;
  const rz = -CUSH_RHO * nz;

  // 法向冲量（库边视为无穷质量）
  const jn = -(1 + PHYS.eCushion) * vn;
  applyImpulse(b, jn * nx, 0, jn * nz, rx, ry, rz);

  // 切向摩擦：接触点滑速（含塞与滚动分量），排除法向分量
  const cv = contactVel(b, rx, ry, rz);
  let tx = cv.x;
  const ty = cv.y;
  let tz = cv.z;
  const dotN = tx * nx + tz * nz;
  tx -= dotN * nx;
  tz -= dotN * nz;
  const tMag = Math.hypot(tx, ty, tz);
  if (tMag > 1e-4) {
    // 单球对固定面：单位冲量改变接触点滑速 1 + 5/2 = 3.5
    const jt = Math.min(PHYS.muCushion * Math.abs(jn), tMag / 3.5);
    const jx = (-jt * tx) / tMag;
    const jy = (-jt * ty) / tMag;
    const jz = (-jt * tz) / tMag;
    applyImpulse(b, jx, jy, jz, rx, ry, rz);
  }

  if (-vn > 0.05) {
    w.events.push({ type: 'cushion', balls: [b.id], speed: -vn, t: w.time, seg: segIdx });
  }
}

function pocketBall(b: Ball, w: World, pocketId: number): void {
  b.active = false;
  b.pocketed = true;
  b.vx = 0;
  b.vz = 0;
  b.wx = b.wy = b.wz = 0;
  w.events.push({ type: 'pocket', balls: [b.id], speed: 0, t: w.time, pocket: pocketId });
}

function checkPockets(b: Ball, w: World): void {
  for (const p of w.pockets) {
    if (Math.hypot(b.x - p.x, b.z - p.z) < p.r) {
      pocketBall(b, w, p.id);
      return;
    }
  }
  // 兜底：球心明显越过库边鼻线（只可能发生在袋口喉部区域）仍未进捕获圆，
  // 说明擦着袋颚滑过了捕获圆，强制就近落袋，避免球逃进台面外死区。
  // 阈值按实测袋口位置（角袋 |x|≈1.34、中袋 |z|≈0.71）外扩设置。
  if (Math.abs(b.x) > 1.31 || Math.abs(b.z) > 0.7) {
    let best = w.pockets[0];
    let bd = Infinity;
    for (const p of w.pockets) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    pocketBall(b, w, best.id);
  }
}

export function allStopped(w: World): boolean {
  for (const b of w.balls) {
    if (!b.active) continue;
    if (Math.hypot(b.vx, b.vz) > PHYS.stopEps) return false;
  }
  return true;
}

/** 推进 dt 秒（内部按 1ms 子步）。返回是否有球仍在运动。 */
export function stepWorld(w: World, dt: number): boolean {
  let remaining = Math.min(dt, 0.05);
  while (remaining > 1e-9) {
    const h = Math.min(H, remaining);
    remaining -= h;
    w.time += h;

    for (const b of w.balls) {
      if (b.active) integrate(b, h);
    }
    // 球-球碰撞（两两）
    const act = w.balls.filter((b) => b.active);
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        resolveBallBall(act[i], act[j], w, h);
      }
    }
    // 库边与袋口
    for (const b of act) {
      for (let s = 0; s < w.segs.length; s++) {
        resolveCushion(b, w.segs[s], s, w);
      }
      checkPockets(b, w);
    }
  }
  return !allStopped(w);
}

/** 一直仿真到全部静止（AI/测试用），返回是否正常停下（超时返回 false）。 */
export function settleWorld(w: World, maxTime = 25): boolean {
  while (w.time < maxTime) {
    stepWorld(w, 0.05);
    if (allStopped(w)) return true;
  }
  return false;
}
