// 球桌几何：库边线段（含袋口颚）与袋口捕获圆。
// 参数与 Blender 混元3D 模型实测对齐（2026-10-15）：
// - 36.3mm 接触高度鼻线校准到 ±1.27 / ±0.635（误差 <1mm）
// - 袋口中心/半径、库边沿轨截断位置均取自模型射线测量

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 段的法线（指向台面内侧），用于退化情形与渲染 */
  nx: number;
  nz: number;
  kind: 'cushion' | 'jaw';
}

export interface Pocket {
  id: number;
  x: number;
  z: number;
  /** 捕获半径：球心距离小于此值即落袋 */
  r: number;
  angle: number;
}

export interface TableGeometry {
  segs: Seg[];
  pockets: Pocket[];
}

export const TABLE = {
  L: 2.54, // 库边内沿长度
  W: 1.27, // 库边内沿宽度
  headStringX: -2.54 / 4, // 开球线
  footSpotX: 2.54 / 4, // 置球点
};

// 实测袋口（世界坐标，原点=台面中心）
const CORNER = { x: 1.336, z: 0.688, r: 0.0947 };
const SIDE = { z: 0.706, r: 0.0826 };
// 库边沿轨截断（袋口开档）。视觉模型实测 0.07/0.079，但颚与库边相接的凸角
// 会挡住"正面朝袋心"的进球通道（通道边缘距角点仅 ~1.5cm < 球半径），
// 物理开档适当加宽让出通道；代价是贴轨进袋时球会短暂掠过视觉颚尖。
const MOUTH = {
  cornerLong: 0.11, // 长库边距角点
  cornerShort: 0.11, // 短库边距角点
  sideHalf: 0.116, // 中袋半开档
};

/** 构建整张桌子的库边线段与袋口。x 为长边方向，z 为短边方向，原点在台面中心。 */
export function buildTableGeometry(): TableGeometry {
  const hl = TABLE.L / 2;
  const hw = TABLE.W / 2;
  const segs: Seg[] = [];

  const pushSeg = (ax: number, az: number, bx: number, bz: number, kind: Seg['kind'] = 'cushion') => {
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    segs.push({ ax, az, bx, bz, nx: (dz / l), nz: (-dx / l), kind });
  };

  // 六段主库边（顺时针：上长库两段、右短库、下长库两段、左短库）
  pushSeg(-hl + MOUTH.cornerLong, hw, -MOUTH.sideHalf, hw);
  pushSeg(MOUTH.sideHalf, hw, hl - MOUTH.cornerLong, hw);
  pushSeg(hl - MOUTH.cornerLong, -hw, MOUTH.sideHalf, -hw);
  pushSeg(-MOUTH.sideHalf, -hw, -hl + MOUTH.cornerLong, -hw);
  pushSeg(hl, -hw + MOUTH.cornerShort, hl, hw - MOUTH.cornerShort);
  pushSeg(-hl, hw - MOUTH.cornerShort, -hl, -hw + MOUTH.cornerShort);

  // 袋口颚：从库边端点朝袋心方向、再向外倾（远离台面方向）形成漏斗，
  // 不侵入"正面朝袋心"的进球通道；贴库球会蹭到颚尖洗袋——真实行为。
  const jaw = (ax: number, az: number, px: number, pz: number, r: number, tiltX = 0, tiltZ = 0) => {
    let dx = px - ax;
    let dz = pz - az;
    const d = Math.hypot(dx, dz);
    dx /= d;
    dz /= d;
    if (tiltX !== 0 || tiltZ !== 0) {
      dx += tiltX;
      dz += tiltZ;
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
    }
    const len = tiltX !== 0 || tiltZ !== 0 ? 0.055 : Math.min(0.07, d - r * 0.55);
    pushSeg(ax, az, ax + dx * len, az + dz * len, 'jaw');
  };

  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ] as const) {
    const px = sx * CORNER.x;
    const pz = sz * CORNER.z;
    // 长库边端点的颚：向袋心 + 向外(z)倾斜
    jaw(sx * (hl - MOUTH.cornerLong), sz * hw, px, pz, CORNER.r, 0, sz * 0.4);
    // 短库边端点的颚：向袋心 + 向外(x)倾斜
    jaw(sx * hl, sz * (hw - MOUTH.cornerShort), px, pz, CORNER.r, sx * 0.4, 0);
  }
  // 中袋颚（朝袋心即可，不挡正面通道）
  for (const sz of [1, -1] as const) {
    jaw(-MOUTH.sideHalf, sz * hw, 0, sz * SIDE.z, SIDE.r);
    jaw(MOUTH.sideHalf, sz * hw, 0, sz * SIDE.z, SIDE.r);
  }

  // 袋口捕获圆
  const pockets: Pocket[] = [];
  let id = 0;
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ] as const) {
    pockets.push({
      id: id++,
      x: sx * CORNER.x,
      z: sz * CORNER.z,
      r: CORNER.r,
      angle: Math.atan2(sz, sx),
    });
  }
  for (const sz of [1, -1] as const) {
    pockets.push({ id: id++, x: 0, z: sz * SIDE.z, r: SIDE.r, angle: sz > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }

  return { segs, pockets };
}

/** 开球线之后的合法放置区 */
export function behindHeadString(x: number): boolean {
  return x < TABLE.headStringX + 1e-9;
}
