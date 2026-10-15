// 球桌建模 v2：黑色钢琴漆竞赛桌（对照产品图重构）。
// - 木框：外圆角矩形 + 内沿带袋口圆弧缺口的洞，倒角挤出（钢琴漆）
// - 库边：按真实橡胶截面（鼻线悬挑、顶面斜切）沿物理线段挤出
// - 袋口：木框真实开洞 + 金属圈 + 皮革喉口 + 黑洞盘
// - 银色金属饰条沿木框内沿一圈，锥形黑桌腿带金属环，珍珠点位

import * as THREE from 'three';
import { TABLE } from '../physics/spec';
import type { TableGeometry } from '../physics/table';
import { makeBedClothTexture, makeCushionClothTexture, makeWoodTexture } from './textures';

export const CLOTH_COLOR = '#1a66a3'; // 中式蓝绿台呢（传统绿改为 '#12604a'）

// ── 结构常量（米） ──────────────────────────────
const CUSH_D = 0.05; // 库边鼻线 → 木框内沿
const FRAME_W = 0.16; // 木框宽度
const FRAME_TOP = 0.052;
const FRAME_BOT = -0.053;
const RV_CORNER = 0.078; // 袋口开孔半径（角/中）
const RV_SIDE = 0.075;
const BEVEL = 0.008; // 木框边缘倒角

export function buildTableMesh(geom: TableGeometry): THREE.Group {
  const g = new THREE.Group();
  const hl = TABLE.L / 2;
  const hw = TABLE.W / 2;
  const xi = hl + CUSH_D; // 木框内沿（半长）
  const zi = hw + CUSH_D;
  const xo = xi + FRAME_W; // 木框外沿
  const zo = zi + FRAME_W;

  // ── 材质 ──
  const bedTex = makeBedClothTexture(CLOTH_COLOR, TABLE.L + 2 * CUSH_D, TABLE.W + 2 * CUSH_D);
  const bedMat = new THREE.MeshPhysicalMaterial({
    map: bedTex,
    roughness: 0.94,
    sheen: 0.25,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(CLOTH_COLOR).lerp(new THREE.Color('#ffffff'), 0.2),
  });
  const cushMat = new THREE.MeshPhysicalMaterial({
    map: makeCushionClothTexture(CLOTH_COLOR),
    roughness: 0.92,
    sheen: 0.2,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(CLOTH_COLOR).lerp(new THREE.Color('#ffffff'), 0.18),
  });
  const lacquer = new THREE.MeshPhysicalMaterial({
    color: 0x0b0b0e,
    roughness: 0.32,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9d9df, metalness: 1.0, roughness: 0.16 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x17110b, roughness: 0.85, side: THREE.DoubleSide });
  const matteBlack = new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 0.75 });
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf3efe4, roughness: 0.25, clearcoat: 0.7 });

  // ── 台面（台呢） ──
  const bed = new THREE.Mesh(new THREE.BoxGeometry(TABLE.L + 2 * CUSH_D, 0.045, TABLE.W + 2 * CUSH_D), bedMat);
  bed.position.y = -0.0225;
  bed.receiveShadow = true;
  g.add(bed);

  // 台底箱
  const base = new THREE.Mesh(new THREE.BoxGeometry(TABLE.L + 0.5, 0.1, TABLE.W + 0.5), matteBlack);
  base.position.y = -0.1;
  g.add(base);

  // ── 木框（带袋口开洞） ──
  const inner = notchedInnerEdge(geom, xi, zi, BEVEL); // 预扩 bevel 补偿
  const outer = new THREE.Shape();
  roundedRect(outer, -(xo - BEVEL), -(zo - BEVEL), (xo - BEVEL) * 2, (zo - BEVEL) * 2, 0.11);
  outer.holes.push(new THREE.Path(inner.points));
  const frameGeo = new THREE.ExtrudeGeometry(outer, {
    depth: FRAME_TOP - FRAME_BOT - 2 * BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 3,
    curveSegments: 20,
  });
  frameGeo.translate(0, 0, -(FRAME_TOP - FRAME_BOT) + BEVEL);
  const frame = new THREE.Mesh(frameGeo, lacquer);
  frame.rotation.x = -Math.PI / 2;
  frame.position.y = FRAME_TOP;
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);

  // ── 金属饰条：沿内沿一圈（含袋口弧段） ──
  {
    const pts2 = notchedInnerEdge(geom, xi, zi, 0).points;
    const pts = pts2.map((p) => new THREE.Vector3(p.x, FRAME_TOP + 0.001, p.y));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.12);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 300, 0.0035, 8, true), chrome);
    tube.castShadow = false;
    g.add(tube);
  }

  // ── 库边：真实截面沿物理线段挤出 ──
  // 截面：x=0 贴木框，x=CUSH_D 为鼻线（36.5mm 高），顶面自木框向鼻线斜切，鼻下内收
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  profile.lineTo(0, 0.047);
  profile.lineTo(0.014, 0.0435);
  profile.lineTo(CUSH_D, 0.0365); // 鼻线
  profile.lineTo(CUSH_D - 0.006, 0.028); // 鼻下内收
  profile.lineTo(CUSH_D - 0.012, 0);
  profile.closePath();

  // 衔接判断：与其他段共享端点的端部做搭接延伸，消除斜接缝
  const endKey = (x: number, z: number) => `${x.toFixed(6)},${z.toFixed(6)}`;
  const endCount = new Map<string, number>();
  for (const s of geom.segs) {
    for (const k of [endKey(s.ax, s.az), endKey(s.bx, s.bz)]) {
      endCount.set(k, (endCount.get(k) ?? 0) + 1);
    }
  }
  const isJunction = (x: number, z: number) => (endCount.get(endKey(x, z)) ?? 0) > 1;

  /** 射线进入圆的最近参数 t（无交点返回 null） */
  const rayCircle = (
    ax: number,
    az: number,
    ux: number,
    uz: number,
    cx: number,
    cz: number,
    R: number
  ): number | null => {
    const mx = ax - cx;
    const mz = az - cz;
    const b = mx * ux + mz * uz;
    const c0 = mx * mx + mz * mz - R * R;
    const disc = b * b - c0;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = -b - s;
    const t2 = -b + s;
    if (t1 > 0) return t1;
    if (t2 > 0) return t2;
    return null;
  };

  const JOIN_EXT = 0.012; // 衔接搭接量
  const HOLE_TRIM = 0.002; // 距袋口开孔边缘的间隙
  for (const seg of geom.segs) {
    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const extA = isJunction(seg.ax, seg.az) ? JOIN_EXT : 0;
    const extB = isJunction(seg.bx, seg.bz) && seg.kind !== 'jaw' ? JOIN_EXT : 0;
    let bLen = len;
    if (seg.kind === 'jaw') {
      // 颚段远端按最近的袋口开孔圆裁剪，避免伸进洞里挡住袋口
      let best: { x: number; z: number; r: number } | null = null;
      let bd = Infinity;
      for (const p of geom.pockets) {
        const d = Math.hypot(p.x - seg.bx, p.z - seg.bz);
        if (d < bd) {
          bd = d;
          best = { x: p.x, z: p.z, r: (Math.abs(p.x) < 1e-6 ? RV_SIDE : RV_CORNER) - BEVEL };
        }
      }
      const t = rayCircle(seg.ax, seg.az, ux, uz, best!.x, best!.z, best!.r);
      if (t !== null && t < len) bLen = Math.max(0.02, t - HOLE_TRIM);
    }
    const depth = extA + bLen + extB;
    const geoSeg = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: false, curveSegments: 1 });
    const m = new THREE.Mesh(geoSeg, cushMat);
    m.rotation.y = Math.atan2(dx, dz); // 局部 +X → 段法线 n，+Z → 段方向
    const sx = seg.ax - ux * extA;
    const sz = seg.az - uz * extA;
    m.position.set(sx - seg.nx * CUSH_D, 0, sz - seg.nz * CUSH_D);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }

  // ── 袋口组件：与框面齐平的皮革开孔（喉筒 + 齐平护口 + 黑洞盘） ──
  for (const p of geom.pockets) {
    const isSide = Math.abs(p.x) < 1e-6;
    const rv = (isSide ? RV_SIDE : RV_CORNER) - BEVEL;

    // 皮革喉筒：上沿与框面齐平，向下收口
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(rv * 0.995, rv * 0.86, 0.175, 28, 1, true), leather);
    throat.position.set(p.x, FRAME_TOP + 0.0005 - 0.0875, p.z);
    g.add(throat);

    // 齐平的皮革护口（贴住开孔边缘，替代凸起的金属环）
    const collar = new THREE.Mesh(new THREE.RingGeometry(rv - 0.004, rv + 0.008, 32), leather);
    collar.rotation.x = -Math.PI / 2;
    collar.position.set(p.x, FRAME_TOP - 0.0006, p.z);
    g.add(collar);

    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(rv * 0.97, 28),
      new THREE.MeshBasicMaterial({ color: 0x020202 })
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(p.x, 0.0013, p.z);
    g.add(hole);
  }

  // ── 珍珠点位（嵌在木框上） ──
  const pearlGeo = new THREE.SphereGeometry(0.0065, 14, 10);
  const pz = zi + FRAME_W / 2;
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;
    for (const sz of [1, -1]) {
      const m = new THREE.Mesh(pearlGeo, pearl);
      m.scale.set(1, 0.5, 1);
      m.position.set(TABLE.L * (i / 8 - 0.5), FRAME_TOP + 0.002, sz * pz);
      g.add(m);
    }
  }
  const px = xi + FRAME_W / 2;
  for (let i = 1; i <= 3; i++) {
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(pearlGeo, pearl);
      m.scale.set(1, 0.5, 1);
      m.position.set(sx * px, FRAME_TOP + 0.002, TABLE.W * (i / 4 - 0.5));
      g.add(m);
    }
  }

  // ── 裙板（框底与腿之间的黑色围板，袋口区域留空） ──
  const apronH = 0.1;
  const apronY = FRAME_BOT - apronH / 2 + 0.001;
  const mkApron = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, apronH, d), matteBlack);
    m.position.set(x, apronY, z);
    g.add(m);
  };
  // 长边：两段，避开中袋
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      mkApron(0.6, 0.09, sx * 0.63, sz * (zo - 0.05));
    }
  }
  // 短边：一整段（角袋在角上，不冲突）
  for (const sx of [1, -1]) {
    mkApron(0.09, 2 * (zo - 0.1), sx * (xo - 0.05), 0);
  }

  // ── 桌腿：锥形方柱 + 金属环 ──
  const legGeo = new THREE.CylinderGeometry(0.072, 0.095, 0.8, 4, 1);
  const legY = FRAME_BOT - 0.4;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const leg = new THREE.Mesh(legGeo, lacquer);
      leg.rotation.y = Math.PI / 4;
      leg.position.set(sx * (xo - 0.26), legY, sz * (zo - 0.2));
      leg.castShadow = true;
      g.add(leg);
      for (const hy of [-0.16, -0.64]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.006, 8, 28), chrome);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(sx * (xo - 0.26), legY + hy + 0.4, sz * (zo - 0.2));
        g.add(ring);
      }
    }
  }

  // ── 地板 ──
  g.add(createFloor());

  return g;
}

/** 地板（GLB 模型替换程序建模时单独使用） */
export function createFloor(): THREE.Mesh {
  const floorTex = makeWoodTexture('#241812', 140);
  floorTex.repeat.set(10, 10);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8, color: 0x7a7a7a })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.86;
  floor.receiveShadow = true;
  return floor;
}

/** 圆角矩形路径（逆时针） */
function roundedRect(path: THREE.Shape, x: number, y: number, w: number, h: number, r: number) {
  const x2 = x + w;
  const y2 = y + h;
  path.moveTo(x + r, y);
  path.lineTo(x2 - r, y);
  path.absarc(x2 - r, y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x2, y2 - r);
  path.absarc(x2 - r, y2 - r, r, 0, Math.PI / 2, false);
  path.lineTo(x + r, y2);
  path.absarc(x + r, y2 - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + r);
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
}

/**
 * 木框内沿路径：沿 xi/zi 矩形顺时针走一圈，在 6 个袋口处沿远离台心的一侧绕袋口圆弧（开洞）。
 * expand > 0 时整体外扩（倒角补偿）。返回折线点（闭合）。
 */
function notchedInnerEdge(geom: TableGeometry, xi: number, zi: number, expand: number): { points: THREE.Vector2[] } {
  const XI = xi + expand;
  const ZI = zi + expand;
  const corners = geom.pockets.filter((p) => Math.abs(p.x) > 1e-6);
  const sides = geom.pockets.filter((p) => Math.abs(p.x) < 1e-6);
  const sideTop = sides.find((p) => p.z > 0)!;
  const sideBot = sides.find((p) => p.z < 0)!;

  const pts: THREE.Vector2[] = [];
  const ARC_STEP = (Math.PI / 180) * 5;

  /** 绕袋口弧：方向选"包含袋心外向角 φ"的那一侧（沿木框一侧绕行，角袋约 248° 大弧） */
  const pushArc = (cxx: number, czz: number, rv: number, entry: THREE.Vector2, exit: THREE.Vector2) => {
    pts.push(entry);
    const a0 = Math.atan2(entry.y - czz, entry.x - cxx);
    const a1 = Math.atan2(exit.y - czz, exit.x - cxx);
    const phi = Math.atan2(czz, cxx);
    const mod2pi = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const sweepCW = mod2pi(a0 - a1);
    const clockwise = mod2pi(a0 - phi) <= sweepCW;
    const sweep = clockwise ? sweepCW : mod2pi(a1 - a0);
    const steps = Math.max(6, Math.ceil(sweep / ARC_STEP));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const a = clockwise ? a0 - t * sweep : a0 + t * sweep;
      pts.push(new THREE.Vector2(cxx + rv * Math.cos(a), czz + rv * Math.sin(a)));
    }
    pts.push(exit);
  };

  /** 角袋与相邻两条直边的交点（取靠台心一侧的内侧交点） */
  const cornerCross = (p: { x: number; z: number }) => {
    const sx = Math.sign(p.x);
    const sz = Math.sign(p.z);
    const cxx = p.x + sx * expand * 0.707;
    const czz = p.z + sz * expand * 0.707;
    const rv = RV_CORNER + expand;
    const dzE = Math.abs(sz * ZI - czz);
    const dxE = Math.abs(sx * XI - cxx);
    const dTop = Math.sqrt(Math.max(1e-12, rv * rv - dzE * dzE));
    const dSide = Math.sqrt(Math.max(1e-12, rv * rv - dxE * dxE));
    return {
      cxx,
      czz,
      rv,
      onH: new THREE.Vector2(cxx - sx * dTop, sz * ZI), // 水平边（顶/底）交点
      onV: new THREE.Vector2(sx * XI, czz - sz * dSide), // 竖直边（左/右）交点
    };
  };

  const LT = cornerCross(corners.find((p) => p.x < 0 && p.z > 0)!);
  const RT = cornerCross(corners.find((p) => p.x > 0 && p.z > 0)!);
  const RB = cornerCross(corners.find((p) => p.x > 0 && p.z < 0)!);
  const LB = cornerCross(corners.find((p) => p.x < 0 && p.z < 0)!);

  // 顺时针：顶边(-x→+x) → 右边(下) → 底边(+x→-x) → 左边(上)
  pts.push(LT.onH.clone());
  {
    const rv = RV_SIDE + expand;
    const dz = Math.abs(ZI - sideTop.z);
    const dx = Math.sqrt(Math.max(0, rv * rv - dz * dz));
    pushArc(sideTop.x, sideTop.z, rv, new THREE.Vector2(-dx, ZI), new THREE.Vector2(dx, ZI));
  }
  pushArc(RT.cxx, RT.czz, RT.rv, RT.onH.clone(), RT.onV.clone());
  pushArc(RB.cxx, RB.czz, RB.rv, RB.onV.clone(), RB.onH.clone());
  {
    const rv = RV_SIDE + expand;
    const dz = Math.abs(ZI - Math.abs(sideBot.z));
    const dx = Math.sqrt(Math.max(0, rv * rv - dz * dz));
    pushArc(sideBot.x, sideBot.z, rv, new THREE.Vector2(dx, -ZI), new THREE.Vector2(-dx, -ZI));
  }
  pushArc(LB.cxx, LB.czz, LB.rv, LB.onH.clone(), LB.onV.clone());
  pushArc(LT.cxx, LT.czz, LT.rv, LT.onV.clone(), LT.onH.clone());

  return { points: pts };
}
