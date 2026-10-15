// 程序生成纹理：台呢（单幅覆盖含标记）、木纹、球面贴图。

import * as THREE from 'three';

export const BALL_COLORS: Record<number, string> = {
  1: '#f3b512',
  2: '#1c53a5',
  3: '#c33127',
  4: '#5b3b8c',
  5: '#e07b1f',
  6: '#1f7a4d',
  7: '#8a3324',
  8: '#141414',
  9: '#f3b512',
  10: '#1c53a5',
  11: '#c33127',
  12: '#5b3b8c',
  13: '#e07b1f',
  14: '#1f7a4d',
  15: '#8a3324',
};

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

/** 球面贴图：512×256 等距圆柱投影，两颗数字圆点位于赤道两侧 */
export function makeBallTexture(id: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  const isStripe = id > 8;
  const isCue = id === 0;
  const color = isCue ? '#f6f2e7' : BALL_COLORS[id];

  if (isStripe) {
    ctx.fillStyle = '#f6f2e7';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = color;
    ctx.fillRect(0, 56, 512, 144); // 中段色带
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 256);
  }

  if (!isCue) {
    for (const cx of [128, 384]) {
      ctx.beginPath();
      ctx.arc(cx, 128, 42, 0, Math.PI * 2);
      ctx.fillStyle = '#f6f2e7';
      ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 52px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(id), cx, 131);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 台呢（台面）：单幅覆盖整块台面，含噪声绒感、边缘暗角、开球线、置球点与淡品牌字。
 *  台面对应尺寸 bedW×bedD（米），标记按真实球桌尺寸换算到像素。 */
export function makeBedClothTexture(base: string, bedW: number, bedD: number): THREE.CanvasTexture {
  const W = 1024;
  const H = Math.round((bedD / bedW) * W);
  const [c, ctx] = makeCanvas(W, H);
  const u = (x: number) => W / 2 + (x / bedW) * W; // 台面物理 x → 像素
  const v = (z: number) => H / 2 + (z / bedD) * H;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // 噪声绒感
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  // 边缘暗角（模拟库边下的阴影衰减）
  const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.62);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 开球线与置球点
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(u(-0.635), 0, 2, H);
  ctx.beginPath();
  ctx.arc(u(0.635), v(0), 7, 0, Math.PI * 2);
  ctx.fill();

  // 淡品牌字（台面中央）
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 52px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('中式八球', W / 2, H / 2 - 14);
  ctx.font = '22px Arial, sans-serif';
  ctx.fillText('C H I N E S E   E I G H T - B A L L', W / 2, H / 2 + 30);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 库边用台呢：小尺寸平铺噪声即可（挤出几何上的 UV 拉伸大，细纹理意义不大） */
export function makeCushionClothTexture(base: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const img = ctx.getImageData(0, 0, 256, 256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 木纹纹理（地板用） */
export function makeWoodTexture(base: string, streaks = 90): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < streaks; i++) {
    const y = Math.random() * 512;
    const alpha = 0.04 + Math.random() * 0.08;
    const w = 1 + Math.random() * 3;
    ctx.strokeStyle = Math.random() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,220,170,${alpha * 0.6})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(128, y + (Math.random() - 0.5) * 24, 384, y + (Math.random() - 0.5) * 24, 512, y + (Math.random() - 0.5) * 12);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
