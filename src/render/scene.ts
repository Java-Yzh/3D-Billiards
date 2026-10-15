// 场景总装：渲染器、灯光（顶灯组）、环境反射。

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createScene(renderer: THREE.WebGLRenderer): { scene: THREE.Scene } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080c);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // 均匀赛场照明：无可见灯具，柔化主光 + 补光 + 环境，保证台面亮度一致、颜色可辨
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(0.6, 2.2, 0.35);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera as THREE.OrthographicCamera;
  cam.left = -1.9;
  cam.right = 1.9;
  cam.top = 1.3;
  cam.bottom = -1.3;
  cam.near = 0.5;
  cam.far = 4.5;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(-1.2, 1.6, -0.6);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xaab6cc, 0.5);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x48587a, 0x141210, 0.5);
  scene.add(hemi);

  return { scene };
}
