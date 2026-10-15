// AI 对手：候选球路（目标球 × 袋口 × 力度 × 杆法）→ 无渲染快速仿真 → 用规则引擎评分。
// 难度通过搜索密度与执行噪声控制。

import { cloneWorld, settleWorld, strike, type World, type Ball } from '../physics/solver';
import { castCue, pathClear } from '../physics/preview';
import { evaluateShot, legalTargets, groupOf, groupBalls, type RulesState, type Group } from '../rules/eightball';
import { mulberry32 } from '../physics/rack';
import { BALL_R } from '../physics/spec';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiShotPlan {
  dirX: number;
  dirZ: number;
  power: number;
  spinA: number;
  spinB: number;
  desc: string;
}

interface Candidate {
  dirX: number;
  dirZ: number;
  power: number;
  spinA: number;
  spinB: number;
  desc: string;
}

const POCKET_NAMES = ['右上角袋', '左上角袋', '左下角袋', '右下角袋', '上中袋', '下中袋'];

const DIFF: Record<Difficulty, { angle: number; power: number; limit: number; suboptimal: number }> = {
  easy: { angle: 0.016, power: 0.12, limit: 45, suboptimal: 0.35 },
  normal: { angle: 0.005, power: 0.045, limit: 95, suboptimal: 0.1 },
  hard: { angle: 0.0012, power: 0.015, limit: 170, suboptimal: 0 },
};

function gauss(rnd: () => number): number {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 生成进攻候选 */
function genCandidates(world: World, st: RulesState): Candidate[] {
  const cue = world.balls.find((b) => b.id === 0)!;
  const targets = legalTargets(st).map((id) => world.balls.find((b) => b.id === id)!).filter(Boolean);
  const out: Candidate[] = [];

  for (const t of targets) {
    for (const p of world.pockets) {
      // 袋口瞄准点：袋心略向台面收回，减少打袋沿概率
      const ax = p.x * 0.94;
      const az = p.z * 0.94;
      let pdx = ax - t.x;
      let pdz = az - t.z;
      const pl = Math.hypot(pdx, pdz);
      if (pl < 1e-6) continue;
      pdx /= pl;
      pdz /= pl;
      // 幽灵球位置
      const gx = t.x - pdx * BALL_R * 2;
      const gz = t.z - pdz * BALL_R * 2;
      let adx = gx - cue.x;
      let adz = gz - cue.z;
      const al = Math.hypot(adx, adz);
      if (al < 1e-6) continue;
      adx /= al;
      adz /= al;
      const cutCos = adx * pdx + adz * pdz;
      if (cutCos < 0.25) continue; // 切角太薄
      const pv = castCue(world.balls, 0, adx, adz);
      if (pv.hitBall !== t.id) continue; // 白球到幽灵球路径被挡
      if (!pathClear(world.balls, t.x, t.z, ax, az, [0, t.id])) continue; // 目标球进袋路径被挡

      const d1 = al;
      const d2 = pl;
      const base = Math.min(0.92, Math.max(0.3, 0.24 + (d1 + d2 * 1.7) * 0.19));
      for (const pw of [base * 0.85, base, Math.min(0.95, base * 1.28)]) {
        for (const sb of [0, 0.28, -0.28]) {
          out.push({ dirX: adx, dirZ: adz, power: pw, spinA: 0, spinB: sb, desc: `${t.id}号 → ${POCKET_NAMES[p.id]}` });
        }
      }
    }
  }

  // 防守/保接触候选：直接瞄最近的合法球
  if (targets.length) {
    let near = targets[0];
    let nd = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - cue.x, t.z - cue.z);
      if (d < nd) {
        nd = d;
        near = t;
      }
    }
    const dx = (near.x - cue.x) / nd;
    const dz = (near.z - cue.z) / nd;
    out.push({ dirX: dx, dirZ: dz, power: 0.3, spinA: 0, spinB: 0, desc: `轻碰 ${near.id}号（安全球）` });
    out.push({ dirX: dx, dirZ: dz, power: 0.45, spinA: 0, spinB: 0, desc: `中力碰 ${near.id}号` });
  }
  return out;
}

interface SimResult {
  score: number;
  firstContact: number | null;
  potted: number[];
  cuePotted: boolean;
  railAfterContact: boolean;
  ballsToRail: Set<number>;
  cueEnd: { x: number; z: number };
}

function simulate(world: World, st: RulesState, c: Candidate, isBreak: boolean): SimResult {
  const w = cloneWorld(world);
  const cue = w.balls.find((b) => b.id === 0)!;
  strike(cue, c.dirX, c.dirZ, c.power, c.spinA, c.spinB);
  settleWorld(w, 14);

  let firstContact: number | null = null;
  const potted: number[] = [];
  let cuePotted = false;
  let railAfterContact = false;
  const ballsToRail = new Set<number>();
  let firstContactT = Infinity;

  for (const e of w.events) {
    if (e.type === 'ball-ball' && e.balls.includes(0)) {
      const other = e.balls[0] === 0 ? e.balls[1] : e.balls[0];
      if (firstContact === null && other !== 0) {
        firstContact = other;
        firstContactT = e.t;
      }
    } else if (e.type === 'cushion') {
      if (e.t >= firstContactT - 1e-9) railAfterContact = true;
      if (e.balls[0] !== 0) ballsToRail.add(e.balls[0]);
    } else if (e.type === 'pocket') {
      if (e.balls[0] === 0) cuePotted = true;
      else potted.push(e.balls[0]);
    }
  }

  const cueEnd = { x: cue.x, z: cue.z };
  void st;
  void isBreak;
  return { score: 0, firstContact, potted, cuePotted, railAfterContact, ballsToRail, cueEnd };
}

function scoreResult(
  st: RulesState,
  shooter: 0 | 1,
  isBreak: boolean,
  sim: SimResult,
  world: World
): number {
  const rec = {
    shooter,
    isBreak,
    firstContact: sim.firstContact,
    potted: sim.potted,
    cuePotted: sim.cuePotted,
    railAfterContact: sim.railAfterContact || sim.potted.length > 0,
    ballsToRail: sim.ballsToRail.size,
  };
  const out = evaluateShot(st, rec);
  let score = 0;
  if (out.state.winner === shooter) score += 1000;
  else if (out.state.winner !== null && out.state.winner !== shooter) score -= 1000;

  // 本杆新进的己方球 / 对方球
  const own = st.groups[shooter];
  const before = new Set(st.potted);
  for (const id of sim.potted) {
    if (id === 8) continue;
    if (before.has(id)) continue;
    if (own === null) score += 90; // 开放局进球都算继续权
    else if (groupOf(id) === own) score += 120;
    else score -= 50;
  }
  if (out.continueTurn) score += 45;
  const foulMsg = out.messages.some((m) => m.includes('犯规'));
  if (foulMsg) score -= 160;

  // 走位：白球离下一个己方目标球的距离
  if (out.state.winner === null && !sim.cuePotted) {
    let nextTargets: number[];
    if (out.state.phase === 'assigned') {
      const g = out.state.groups[shooter] as Group;
      const remain = groupBalls(g).filter((id) => !out.state.potted.includes(id));
      nextTargets = remain.length ? remain : [8];
    } else {
      nextTargets = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((id) => !out.state.potted.includes(id));
    }
    let bestD = Infinity;
    for (const id of nextTargets) {
      const b = world.balls.find((bb) => bb.id === id)!;
      const d = Math.hypot(b.x - sim.cueEnd.x, b.z - sim.cueEnd.z);
      if (d < bestD) bestD = d;
    }
    score += 55 * (1 - Math.min(1, bestD / 2.4));
    // 白球贴库惩罚
    const hl = 1.27;
    const hw = 0.635;
    if (
      Math.abs(sim.cueEnd.x) > hl - BALL_R * 3 ||
      Math.abs(sim.cueEnd.z) > hw - BALL_R * 3
    ) {
      score -= 10;
    }
  }
  return score;
}

/** 开球策略：瞄准三角顶球，满力 */
function breakPlan(world: World, st: RulesState): Candidate | null {
  void st;
  const cue = world.balls.find((b) => b.id === 0)!;
  // 顶球：x 最小的目标球（离白球最近的三角尖）
  const objs = world.balls.filter((b) => b.id !== 0 && b.active);
  let apex: Ball | null = null;
  for (const b of objs) {
    if (!apex || b.x < apex.x) apex = b;
  }
  if (!apex) return null;
  const dx = apex.x - cue.x;
  const dz = apex.z - cue.z + 0.004; // 微偏让开球散球
  const l = Math.hypot(dx, dz);
  return { dirX: dx / l, dirZ: dz / l, power: 1.0, spinA: 0, spinB: 0.1, desc: '开球' };
}

/** AI 选球（可能耗时较长，onProgress 汇报进度 0..1） */
export async function planShot(
  world: World,
  st: RulesState,
  difficulty: Difficulty,
  seed: number,
  onProgress?: (p: number) => void
): Promise<AiShotPlan> {
  const rnd = mulberry32(seed);
  const shooter = st.turn;
  const isBreak = st.phase === 'break';

  if (isBreak) {
    const bp = breakPlan(world, st);
    if (bp) {
      await sleep(600 + rnd() * 500);
      return applyNoise(bp, difficulty, rnd);
    }
  }

  let cands = genCandidates(world, st);
  const cfg = DIFF[difficulty];
  // 打散候选顺序并限量
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  cands = cands.slice(0, cfg.limit);
  if (cands.length === 0) {
    // 无候选（不该发生）：朝最近球打
    const cue = world.balls.find((b) => b.id === 0)!;
    const objs = world.balls.filter((b) => b.id !== 0 && b.active);
    let near = objs[0];
    let nd = Infinity;
    for (const b of objs) {
      const d = Math.hypot(b.x - cue.x, b.z - cue.z);
      if (d < nd) {
        nd = d;
        near = b;
      }
    }
    const l = nd || 1;
    return {
      dirX: (near.x - cue.x) / l,
      dirZ: (near.z - cue.z) / l,
      power: 0.4,
      spinA: 0,
      spinB: 0,
      desc: '随意一杆',
    };
  }

  const scored: Array<{ c: Candidate; s: number }> = [];
  for (let i = 0; i < cands.length; i++) {
    const sim = simulate(world, st, cands[i], false);
    scored.push({ c: cands[i], s: scoreResult(st, shooter, false, sim, world) });
    if (onProgress && i % 6 === 0) {
      onProgress(i / cands.length);
      await sleep(0);
    }
  }
  scored.sort((a, b) => b.s - a.s);
  onProgress?.(1);

  let chosen = scored[0];
  if (rnd() < cfg.suboptimal && scored.length > 3) {
    const k = 1 + Math.floor(rnd() * 3);
    chosen = scored[Math.min(k, scored.length - 1)];
  }
  return applyNoise(chosen.c, difficulty, rnd);
}

function applyNoise(c: Candidate, d: Difficulty, rnd: () => number): AiShotPlan {
  const cfg = DIFF[d];
  const ang = gauss(rnd) * cfg.angle;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const power = Math.min(1, Math.max(0.08, c.power * (1 + gauss(rnd) * cfg.power)));
  return {
    dirX: c.dirX * cos - c.dirZ * sin,
    dirZ: c.dirX * sin + c.dirZ * cos,
    power,
    spinA: c.spinA,
    spinB: c.spinB,
    desc: c.desc,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
