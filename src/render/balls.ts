// 球体渲染：网格管理、滚动姿态积分、落袋下坠动画。

import * as THREE from 'three';
import { BALL_R } from '../physics/spec';
import type { Ball } from '../physics/solver';
import type { Pocket } from '../physics/table';
import { makeBallTexture } from './textures';

interface FallAnim {
  pocket: Pocket;
  t: number;
}

export class BallRenderer {
  meshes = new Map<number, THREE.Mesh>();
  private falls = new Map<number, FallAnim>();
  private group = new THREE.Group();
  private prevOmega = new Map<number, { x: number; y: number; z: number }>();

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  syncBalls(balls: Ball[]) {
    for (const b of balls) {
      let mesh = this.meshes.get(b.id);
      if (!mesh) {
        const geo = new THREE.SphereGeometry(BALL_R, 48, 32);
        const mat = new THREE.MeshPhysicalMaterial({
          map: makeBallTexture(b.id),
          roughness: 0.18,
          clearcoat: 0.4,
          clearcoatRoughness: 0.25,
          envMapIntensity: 0.65,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.meshes.set(b.id, mesh);
      }
      if (!b.active && b.pocketed && !this.falls.has(b.id)) {
        // 从物理层接到落袋：交给下坠动画（找最近袋）
        let best: Pocket | null = null;
        let bd = Infinity;
        for (const p of this.pockets!) {
          const d = Math.hypot(b.x - p.x, b.z - p.z);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        this.falls.set(b.id, { pocket: best!, t: 0 });
      }
      if (b.active) {
        this.falls.delete(b.id);
        mesh.visible = true;
      }
    }
  }

  setPockets(pockets: Pocket[]) {
    this.pockets = pockets;
  }
  private pockets: Pocket[] | null = null;

  /** 每帧调用：按物理状态同步位置与滚动姿态 */
  update(balls: Ball[], dt: number) {
    for (const b of balls) {
      const mesh = this.meshes.get(b.id);
      if (!mesh) continue;

      const fall = this.falls.get(b.id);
      if (fall) {
        if (fall.t === 0) {
          const m = mesh.material as THREE.MeshPhysicalMaterial;
          m.transparent = true;
        }
        fall.t += dt;
        const dur = 0.3;
        const k = Math.min(1, fall.t / dur);
        mesh.position.set(
          THREE.MathUtils.lerp(b.x, fall.pocket.x, k),
          BALL_R - k * 0.05,
          THREE.MathUtils.lerp(b.z, fall.pocket.z, k)
        );
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        mat.opacity = Math.max(0, 1 - Math.max(0, k - 0.35) / 0.65);
        if (k >= 1) {
          mesh.visible = false;
          mat.opacity = 1;
          mat.transparent = false;
        }
        continue;
      }

      mesh.position.set(b.x, BALL_R, b.z);

      // 姿态：按角速度积分（世界系四元数左乘）
      const w = { x: b.wx, y: b.wy, z: b.wz };
      const mag = Math.hypot(w.x, w.y, w.z);
      if (mag > 1e-6) {
        const dq = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(w.x / mag, w.y / mag, w.z / mag),
          mag * dt
        );
        mesh.quaternion.premultiply(dq);
      }
      void this.prevOmega;
    }
  }

  /** 自由球摆放时的白球预览位置 */
  setCueBallPreview(x: number, z: number, visible: boolean) {
    const mesh = this.meshes.get(0);
    if (!mesh) return;
    mesh.visible = visible;
    mesh.position.set(x, BALL_R, z);
  }

  reset(balls: Ball[]) {
    this.falls.clear();
    for (const b of balls) {
      const mesh = this.meshes.get(b.id);
      if (!mesh) continue;
      mesh.visible = true;
      mesh.quaternion.identity();
      mesh.position.set(b.x, BALL_R, b.z);
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.opacity = 1;
      mat.transparent = false;
    }
  }
}
