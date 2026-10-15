// 摆球与目标球放置。使用带种子的随机数保证同一局可复现。

import { BALL_R, TABLE } from './spec';
import { makeBall, type Ball } from './solver';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groupOf(id: number): 'solid' | 'stripe' | 'eight' | 'cue' {
  if (id === 0) return 'cue';
  if (id === 8) return 'eight';
  return id < 8 ? 'solid' : 'stripe';
}

/** 标准中式八球摆球：三角摆于置球点，黑 8 在第三排中心，后排两角一全色一花色，其余随机。 */
export function rackBalls(seed: number): Ball[] {
  const rnd = mulberry32(seed);
  const gap = BALL_R * 2 + 0.0002; // 微小间隙，避免初始重叠数值问题
  const rowDx = gap * Math.cos(Math.PI / 6);

  // 待摆号码：全色 1-7 去掉角位安排，花色 9-15
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const s = shuffle(solids);
  const st = shuffle(stripes);

  // 布局：[行, 列] -> 球号。第三排(行2)中间是 8；末排(行4)两端一全色一花色。
  const layout: Array<[number, number, number]> = []; // [row, col, id]
  // 8 球
  layout.push([2, 1, 8]);
  // 后排角：col 0 全色, col 4 花色（随机哪边）
  if (rnd() < 0.5) {
    layout.push([4, 0, s.pop()!], [4, 4, st.pop()!]);
  } else {
    layout.push([4, 0, st.pop()!], [4, 4, s.pop()!]);
  }
  const rest = shuffle([...s, ...st]);
  outer: for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      if (layout.some((l) => l[0] === row && l[1] === col)) continue;
      if (rest.length === 0) break outer;
      layout.push([row, col, rest.pop()!]);
    }
  }

  const balls: Ball[] = [makeBall(0, TABLE.headStringX, 0)];
  const fx = TABLE.footSpotX;
  for (const [row, col, id] of layout) {
    const x = fx + row * rowDx;
    const z = (col - row / 2) * gap;
    balls.push(makeBall(id, x, z));
  }
  return balls;
}

/** 把球重新放回置球点（黑 8 开球进袋时用）；若被占则沿 x 向脚库方向顺延。 */
export function respotBall(ball: Ball, others: Ball[]): void {
  const clear = (x: number, z: number) =>
    others.every((o) => o === ball || !o.active || Math.hypot(o.x - x, o.z - z) >= BALL_R * 2 + 0.001);
  let x = TABLE.footSpotX;
  const z = 0;
  while (x < TABLE.L / 2 && !clear(x, z)) x += BALL_R;
  if (!clear(x, z)) {
    x = TABLE.footSpotX;
    while (x > -TABLE.L / 2 && !clear(x, z)) x -= BALL_R;
  }
  ball.active = true;
  ball.pocketed = false;
  ball.x = x;
  ball.z = z;
  ball.vx = ball.vz = 0;
  ball.wx = ball.wy = ball.wz = 0;
}
