// 球杆与瞄准辅助线渲染。

import * as THREE from 'three';
import { BALL_R } from '../physics/spec';
import type { AimPreview } from '../physics/preview';

/** 球杆：沿瞄准方向置于白球后方，随力度后拉，击出时前戳动画 */
export class CueRenderer {
  group = new THREE.Group();
  private strikeT = -1; // >=0 表示击出动画进行中
  private lastAim = { x: 0, z: 0, dx: 1, dz: 0, pull: 0 };

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);

    const wood = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d2417, roughness: 0.4 });
    const ferrule = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.3 });
    const tip = new THREE.MeshStandardMaterial({ color: 0x3a6ea8, roughness: 0.6 });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0115, 1.10, 16), wood);
    shaft.position.y = -0.55 - 0.012;
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.015, 0.38, 16), dark);
    butt.position.y = -1.10 - 0.012 - 0.19;
    const ferruleM = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 16), ferrule);
    ferruleM.position.y = -0.006;
    const tipM = new THREE.Mesh(new THREE.CylinderGeometry(0.0057, 0.006, 0.008, 16), tip);
    tipM.position.y = 0.004;

    for (const m of [shaft, butt, ferruleM, tipM]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** dir：击球方向（水平）。pullback：后拉量（米）。 */
  aim(cueX: number, cueZ: number, dirX: number, dirZ: number, pullback: number) {
    this.lastAim = { x: cueX, z: cueZ, dx: dirX, dz: dirZ, pull: pullback };
    this.placeCue(pullback);
  }

  private placeCue(pullback: number) {
    const { x, z, dx, dz } = this.lastAim;
    this.group.visible = true;
    const tipDist = 0.045 + pullback;
    this.group.position.set(x - dx * (tipDist + 0.012), BALL_R + 0.007, z - dz * (tipDist + 0.012));
    // 杆尖在 group 原点，杆身沿 -y；先绕 X 把 -y 转到水平 +z，再绕 y 对齐 -dir
    const yaw = Math.atan2(dx, dz);
    this.group.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'));
  }

  /** 击出动画：从当前后拉量快速前戳到贴球 */
  strike() {
    this.strikeT = 0;
  }

  hide() {
    this.group.visible = false;
    this.strikeT = -1;
  }

  update(dt: number): void {
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      const k = Math.min(1, this.strikeT / 0.07);
      const eased = 1 - Math.pow(1 - k, 3);
      this.placeCue(this.lastAim.pull * (1 - eased));
      if (k >= 1) this.hide();
    }
  }
}

/** 瞄准辅助线：白球路径 + 幽灵球 + 目标球去向 + 白球分离方向 */
export class GuideLine {
  group = new THREE.Group();
  private mainLine: THREE.Line;
  private mainGeom: THREE.BufferGeometry;
  private ghost: THREE.Mesh;
  private targetLine: THREE.Line;
  private targetGeom: THREE.BufferGeometry;
  private cueLine: THREE.Line;
  private cueGeom: THREE.BufferGeometry;
  visible = true;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);

    const mkLine = (color: number, opacity: number) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const line = new THREE.Line(geom, mat);
      line.frustumCulled = false;
      this.group.add(line);
      return { line, geom };
    };
    const a = mkLine(0xffffff, 0.75);
    this.mainLine = a.line;
    this.mainGeom = a.geom;
    const b = mkLine(0x7dffa0, 0.9);
    this.targetLine = b.line;
    this.targetGeom = b.geom;
    const c = mkLine(0xffffff, 0.4);
    this.cueLine = c.line;
    this.cueGeom = c.geom;

    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })
    );
    this.group.add(this.ghost);

    this.group.visible = false;
  }

  show(cueX: number, cueZ: number, pv: AimPreview) {
    this.group.visible = this.visible;
    const y = BALL_R;
    const set = (geom: THREE.BufferGeometry, x1: number, z1: number, x2: number, z2: number) => {
      const pos = geom.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, x1, y, z1);
      pos.setXYZ(1, x2, y, z2);
      pos.needsUpdate = true;
    };
    set(this.mainGeom, cueX, cueZ, pv.ghostX, pv.ghostZ);
    this.ghost.position.set(pv.ghostX, y, pv.ghostZ);
    this.ghost.visible = pv.hitBall !== null;
    if (pv.hitBall !== null) {
      const tl = 0.1 + 0.3 * Math.max(0, pv.cutCos);
      set(this.targetGeom, pv.ghostX, pv.ghostZ, pv.ghostX + pv.targetDirX * tl, pv.ghostZ + pv.targetDirZ * tl);
      (this.targetLine as THREE.Line).visible = true;
      if (Math.hypot(pv.cueDirX, pv.cueDirZ) > 0.1) {
        set(this.cueGeom, pv.ghostX, pv.ghostZ, pv.ghostX + pv.cueDirX * 0.12, pv.ghostZ + pv.cueDirZ * 0.12);
        (this.cueLine as THREE.Line).visible = true;
      } else {
        (this.cueLine as THREE.Line).visible = false;
      }
    } else {
      (this.targetLine as THREE.Line).visible = false;
      (this.cueLine as THREE.Line).visible = false;
    }
  }

  hide() {
    this.group.visible = false;
  }
}
