import { describe, it, expect } from 'vitest';
import { buildTableGeometry } from '../src/physics/table';
import { createWorld, makeBall, cloneBalls, strike, settleWorld, stepWorld, allStopped } from '../src/physics/solver';
import { rackBalls } from '../src/physics/rack';
import { BALL_R, TABLE } from '../src/physics/spec';
import { castCue, setPreviewSegments } from '../src/physics/preview';

const geom = buildTableGeometry();
setPreviewSegments(geom.segs);

function world2(balls: ReturnType<typeof makeBall>[]) {
  return createWorld(cloneBalls(balls), geom);
}

describe('摆球', () => {
  it('16 颗球无初始重叠且都在台内', () => {
    const balls = rackBalls(42);
    expect(balls.length).toBe(16);
    for (let i = 0; i < balls.length; i++) {
      expect(Math.abs(balls[i].x)).toBeLessThan(TABLE.L / 2 - BALL_R + 1e-9);
      expect(Math.abs(balls[i].z)).toBeLessThan(TABLE.W / 2 - BALL_R + 1e-9);
      for (let j = i + 1; j < balls.length; j++) {
        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].z - balls[j].z);
        expect(d).toBeGreaterThanOrEqual(BALL_R * 2 - 1e-6);
      }
    }
  });

  it('黑 8 位于第三排中心', () => {
    const balls = rackBalls(7);
    const eight = balls.find((b) => b.id === 8)!;
    const expectedX = TABLE.footSpotX + 2 * (BALL_R * 2 + 0.0002) * Math.cos(Math.PI / 6);
    expect(eight.x).toBeCloseTo(expectedX, 6);
    expect(eight.z).toBeCloseTo(0, 6);
  });
});

describe('杆法', () => {
  const setup = () => [makeBall(0, -0.4, 0), makeBall(1, 0, 0)];

  /** 推进到第一次球-球碰撞，再走 0.3 秒，返回当时白球与目标球状态。
   *  （避免目标球吃库反弹回来二次碰撞干扰断言。） */
  function afterFirstHit(power: number, spinB: number) {
    const w = world2(setup());
    strike(w.balls[0], 1, 0, power, 0, spinB);
    for (let i = 0; i < 4000 && !w.events.some((e) => e.type === 'ball-ball'); i++) {
      stepWorld(w, 0.01);
    }
    const hitX = w.balls[0].x;
    for (let i = 0; i < 30; i++) stepWorld(w, 0.01);
    return { cue: w.balls[0], obj: w.balls[1], hitX };
  }

  it('定杆：中杆近距直击后白球基本停在撞击点', () => {
    const { cue, hitX } = afterFirstHit(0.45, 0);
    expect(cue.x - hitX).toBeLessThan(0.1);
    expect(cue.x - hitX).toBeGreaterThan(-0.02);
  });

  it('高杆：击点偏上，白球撞击后跟进', () => {
    const { cue, hitX } = afterFirstHit(0.45, 0.45);
    expect(cue.x - hitX).toBeGreaterThan(0.05);
    expect(cue.vx).toBeGreaterThan(0.3);
  });

  it('低杆：击点偏下，白球撞击后回缩', () => {
    const { cue, hitX } = afterFirstHit(0.45, -0.45);
    expect(cue.x - hitX).toBeLessThan(-0.05);
    expect(cue.vx).toBeLessThan(-0.3);
  });

  it('中杆直击：目标球沿击球方向运动且不偏移', () => {
    const { obj } = afterFirstHit(0.4, 0);
    expect(obj.x).toBeGreaterThan(0.5);
    expect(Math.abs(obj.z)).toBeLessThan(0.005);
  });
});

describe('库边与袋口', () => {
  it('无旋转斜向吃库，反弹角近似镜像', () => {
    const w = world2([makeBall(0, -0.5, -0.2, )]);
    w.balls[0].vx = 1.5;
    w.balls[0].vz = 1.2; // 朝 +x+z，会撞上长库 z=+0.635
    settleWorld(w);
    const b = w.balls[0];
    // 撞库后应被弹回：最终 z 应明显回落到台面中部区域
    expect(b.z).toBeLessThan(0.45);
    expect(b.z).toBeGreaterThan(-0.64);
  });

  it('直线瞄准角袋中心的球会落袋', () => {
    const p = geom.pockets[0]; // 右上角袋
    const dir = Math.hypot(p.x, p.z);
    const w = world2([makeBall(5, 0, 0)]);
    w.balls[0].vx = (p.x / dir) * 2.5;
    w.balls[0].vz = (p.z / dir) * 2.5;
    settleWorld(w);
    expect(w.balls[0].pocketed).toBe(true);
  });

  it('直线瞄准中袋的球会落袋', () => {
    const p = geom.pockets.find((pp) => Math.abs(pp.x) < 1e-9 && pp.z > 0)!;
    const w = world2([makeBall(3, 0, 0)]);
    w.balls[0].vz = 2.0;
    void p;
    settleWorld(w);
    expect(w.balls[0].pocketed).toBe(true);
  });

  it('垂直打短库的球被弹回且速度衰减', () => {
    const w = world2([makeBall(2, 0.9, 0)]);
    w.balls[0].vx = 2.0;
    let maxSpeed = 2.0;
    for (let i = 0; i < 400; i++) {
      stepWorld(w, 0.016);
      maxSpeed = Math.max(maxSpeed, Math.hypot(w.balls[0].vx, w.balls[0].vz));
    }
    const b = w.balls[0];
    expect(b.x).toBeLessThan(1.2); // 没有穿库
    expect(Math.hypot(b.vx, b.vz)).toBeLessThan(2.0); // 反弹后减速
    expect(maxSpeed).toBeLessThanOrEqual(2.001); // 全程能量不增
  });
});

describe('瞄准预览', () => {
  it('直射目标球时 cutCos≈1，目标方向沿击球方向', () => {
    const balls = [makeBall(0, -0.4, 0), makeBall(1, 0, 0.0001)];
    const pv = castCue(balls, 0, 1, 0);
    expect(pv.hitBall).toBe(1);
    expect(pv.cutCos).toBeGreaterThan(0.999);
    expect(pv.targetDirX).toBeGreaterThan(0.99);
  });

  it('打偏时幽灵球停在接触点，切角余弦正确衰减', () => {
    const balls = [makeBall(0, -0.4, 0), makeBall(1, 0, 0.05)];
    const pv = castCue(balls, 0, 1, 0);
    expect(pv.hitBall).toBe(1);
    // 偏移 0.05、两球半径和 0.05715 → cutCos = sqrt(1-(0.05/0.057)^2) ≈ 0.48
    expect(pv.cutCos).toBeGreaterThan(0.3);
    expect(pv.cutCos).toBeLessThan(0.7);
    expect(pv.targetDirZ).toBeGreaterThan(0.5); // 目标球被切向 +z
  });
});

describe('确定性与收敛', () => {
  it('相同输入两次仿真结果完全一致', () => {
    const make = () => {
      const w = createWorld(rackBalls(99), geom);
      strike(w.balls[0], 1, 0.05, 0.8, 0.1, -0.2);
      return w;
    };
    const w1 = make();
    const w2s = make();
    settleWorld(w1);
    settleWorld(w2s);
    for (let i = 0; i < 16; i++) {
      expect(w1.balls[i].x).toBe(w2s.balls[i].x);
      expect(w1.balls[i].z).toBe(w2s.balls[i].z);
      expect(w1.balls[i].pocketed).toBe(w2s.balls[i].pocketed);
    }
  });

  it('开球后所有球最终静止（无卡死）', () => {
    const w = createWorld(rackBalls(1), geom);
    strike(w.balls[0], 1, -0.02, 1.0, 0, 0);
    const ok = settleWorld(w, 40);
    expect(ok).toBe(true);
    expect(allStopped(w)).toBe(true);
    // 事件流应包含球-球碰撞
    expect(w.events.some((e) => e.type === 'ball-ball')).toBe(true);
  });
});
