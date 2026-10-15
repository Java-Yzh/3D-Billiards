// 相机系统：第三人称环绕（OrbitControls）+ 第一人称瞄准视角 + 平滑切换 + AI 俯瞰。

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraMode = 'orbit' | 'aim' | 'top';

export class CameraRig {
  controls: OrbitControls;
  mode: CameraMode = 'orbit';
  /** 瞄准视角的目标参数 */
  aimFocus = { x: 0, z: 0, dx: 1, dz: 0 };
  private transition = 0; // >0 表示正在切换（秒）
  private transFrom = new THREE.Matrix4();
  private smoothPos = new THREE.Vector3(0, 1.5, 2.1);
  private smoothLook = new THREE.Vector3(0, 0, 0);

  constructor(public camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.target.set(0, 0.02, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.7;
    this.controls.maxDistance = 5.5;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    camera.position.set(0, 1.5, 2.1);
    camera.lookAt(0, 0, 0);
  }

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    this.transFrom.copy(this.camera.matrix);
    this.transition = 0.5;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
  }

  /** 第一人称：相机置于白球后方看向瞄准方向 */
  updateAim(cueX: number, cueZ: number, dirX: number, dirZ: number) {
    this.aimFocus = { x: cueX, z: cueZ, dx: dirX, dz: dirZ };
  }

  private targetFor(mode: CameraMode): { pos: THREE.Vector3; look: THREE.Vector3 } {
    if (mode === 'aim') {
      const f = this.aimFocus;
      const pos = new THREE.Vector3(f.x - f.dx * 0.85, 0.36, f.z - f.dz * 0.85);
      const look = new THREE.Vector3(f.x + f.dx * 1.4, 0.06, f.z + f.dz * 1.4);
      return { pos, look };
    }
    if (mode === 'top') {
      const pos = new THREE.Vector3(0, 2.35, 0.01);
      const look = new THREE.Vector3(0, 0, 0);
      return { pos, look };
    }
    // orbit：保持当前
    return { pos: this.camera.position.clone(), look: this.controls.target.clone() };
  }

  update(dt: number) {
    if (this.mode === 'orbit' && this.transition <= 0) {
      this.controls.update();
      return;
    }
    const { pos, look } = this.targetFor(this.mode);
    const k = 1 - Math.exp(-dt * (this.transition > 0 ? 6 : 10));
    this.smoothPos.lerp(pos, k);
    this.smoothLook.lerp(look, k);
    if (this.transition > 0) {
      this.transition -= dt;
      if (this.transition <= 0 && this.mode === 'orbit') {
        this.controls.target.copy(this.smoothLook);
        this.camera.position.copy(this.smoothPos);
        this.controls.enabled = true;
        this.controls.update();
        return;
      }
    }
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothLook);
  }

  resetView() {
    this.camera.position.set(0, 1.5, 2.1);
    this.controls.target.set(0, 0.02, 0);
    this.controls.update();
  }
}
