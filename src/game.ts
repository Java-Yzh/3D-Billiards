// 游戏控制器：串联物理仿真、规则状态机、渲染、输入、AI 与音效。

import * as THREE from 'three';
import { BALL_R, TABLE } from './physics/spec';
import { buildTableGeometry } from './physics/table';
import {
  createWorld,
  stepWorld,
  strike,
  allStopped,
  type World,
  type Ball,
} from './physics/solver';
import { rackBalls, respotBall } from './physics/rack';
import { castCue, setPreviewSegments } from './physics/preview';
import { initialRules, evaluateShot, legalTargets, type RulesState, type ShotRecord } from './rules/eightball';
import { createRenderer, createScene } from './render/scene';
import { buildTableMesh, createFloor } from './render/tableMesh';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BallRenderer } from './render/balls';
import { CueRenderer, GuideLine } from './render/cue';
import { CameraRig } from './render/cameras';
import { AudioEngine } from './audio/audio';
import { planShot, type Difficulty, type AiShotPlan } from './ai/ai';
import { Hud } from './ui/hud';

type Phase = 'menu' | 'aiming' | 'charging' | 'shooting' | 'settling' | 'ai-thinking' | 'ai-aiming' | 'placing' | 'over';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private rig: CameraRig;
  private ballRenderer: BallRenderer;
  private cueRenderer: CueRenderer;
  private guide: GuideLine;
  private hud: Hud;
  private audio = new AudioEngine();
  private geom = buildTableGeometry();

  private world!: World;
  private rules!: RulesState;
  private phase: Phase = 'menu';
  private difficulty: Difficulty = 'normal';

  private aimAngle = 0; // 瞄准方向（弧度，xz 平面，平滑后的当前值）
  private aimTarget = 0; // 鼠标指向的目标角度
  private power = 0;
  private charging = false;
  private spaceCharging = false;
  private eventIdx = 0; // 已处理的物理事件游标
  private settleTimer = 0;
  private aiTimer = 0;
  private aiPlan: AiShotPlan | null = null;
  private placing = { x: 0, z: 0, valid: false };

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2(0, 0);
  private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_R);
  private clock = new THREE.Clock();
  private showGuide = true;
  private tableGroup!: THREE.Object3D;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    const { scene } = createScene(this.renderer);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 30);
    this.rig = new CameraRig(this.camera, canvas);

    this.tableGroup = buildTableMesh(this.geom);
    this.scene.add(this.tableGroup);
    // 加载 Blender 导出的高精度球桌模型，成功后替换程序建模（失败则保留兜底）
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}models/table.glb`,
      (gltf) => {
        this.scene.remove(this.tableGroup);
        this.tableGroup = createFloor();
        this.scene.add(this.tableGroup);
        const model = gltf.scene;
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        this.scene.add(model);
      },
      undefined,
      () => {
        // 网络或文件问题：继续使用程序建模
      }
    );
    this.ballRenderer = new BallRenderer(this.scene);
    this.ballRenderer.setPockets(this.geom.pockets);
    this.cueRenderer = new CueRenderer(this.scene);
    this.guide = new GuideLine(this.scene);
    setPreviewSegments(this.geom.segs);

    this.hud = new Hud();
    this.bindInput(canvas);
    this.bindHud();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.loop();
  }

  // ── 局面管理 ─────────────────────────────────────────────

  newGame(difficulty: Difficulty) {
    this.difficulty = difficulty;
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const balls = rackBalls(seed);
    this.world = createWorld(balls, this.geom);
    this.rules = initialRules(0);
    this.phase = 'aiming';
    this.aimAngle = 0;
    this.aimTarget = 0;
    this.power = 0;
    this.hud.resetSpin();
    this.hud.setPower(0);
    this.hud.updateRules(this.rules);
    this.hud.hideOverlay();
    this.hud.setAiThinking(false);
    this.updateHint();
    this.ballRenderer.reset(balls);
    this.rig.resetView();
    this.guide.hide();
    this.cueRenderer.hide();
    this.hud.toast('你先开球，祝好运！', 'good');
    this.initAimFromCue();
  }

  private get cue(): Ball {
    return this.world.balls.find((b) => b.id === 0)!;
  }

  private initAimFromCue() {
    // 默认瞄准最近的合法目标球
    const targets = legalTargets(this.rules);
    const cue = this.cue;
    let best: Ball | null = null;
    let bd = Infinity;
    for (const b of this.world.balls) {
      if (b.id === 0 || !b.active || !targets.includes(b.id)) continue;
      const d = Math.hypot(b.x - cue.x, b.z - cue.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) {
      this.aimAngle = Math.atan2(best.z - cue.z, best.x - cue.x);
      this.aimTarget = this.aimAngle;
    }
  }

  // ── 输入 ─────────────────────────────────────────────

  /** 第一人称鼠标锁定灵敏度（弧度/像素），越小越稳 */
  static readonly AIM_SENS = 0.0011;

  private fpLocked(): boolean {
    return document.pointerLockElement !== null;
  }

  private bindInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointermove', (e) => {
      // 第一人称 + 鼠标锁定：相对移动瞄准（恒定灵敏度，精确）
      if (this.rig.mode === 'aim' && this.fpLocked()) {
        if (this.phase === 'aiming' || this.phase === 'charging') {
          const me = e as PointerEvent & { movementX?: number };
          if (me.movementX) this.aimTarget += me.movementX * Game.AIM_SENS;
        }
        return;
      }
      this.pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.phase === 'aiming' && !this.charging) {
        // 拖动视角（按住鼠标）时球杆不跟随；指针须落在台面范围内才更新瞄准
        if (e.buttons === 0) {
          const pt = this.raycastTable();
          const m = 0.06;
          if (pt && Math.abs(pt.x) < TABLE.L / 2 + m && Math.abs(pt.z) < TABLE.W / 2 + m) {
            const cue = this.cue;
            const dx = pt.x - cue.x;
            const dz = pt.z - cue.z;
            // 死区：指针离白球太近时角度放大效应严重，忽略
            if (Math.hypot(dx, dz) > 0.06) this.aimTarget = Math.atan2(dz, dx);
          }
        }
      } else if (this.phase === 'placing') {
        const pt = this.raycastTable();
        if (pt) this.updatePlacing(pt.x, pt.z);
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.audio.ensure();
      // 第一人称未锁定：第一次点击进入鼠标锁定（不击球）
      if (this.rig.mode === 'aim' && !this.fpLocked() && (this.phase === 'aiming' || this.phase === 'charging')) {
        canvas.requestPointerLock();
        return;
      }
      if (this.phase === 'placing') {
        if (this.placing.valid) this.confirmPlacing();
      }
    });

    // 右键解除鼠标锁定（去点杆法控件等）
    canvas.addEventListener('contextmenu', (e) => {
      if (this.fpLocked()) {
        e.preventDefault();
        document.exitPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.updateHint();
    });

    canvas.addEventListener('wheel', (e) => {
      if (this.phase === 'aiming' || this.phase === 'charging') {
        e.preventDefault();
        this.aimAngle += Math.sign(e.deltaY) * 0.0022;
        this.aimTarget = this.aimAngle;
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyV':
          if (this.rig.mode === 'aim') {
            if (this.fpLocked()) document.exitPointerLock();
            this.rig.setMode('orbit');
            this.updateHint();
          } else {
            this.rig.setMode('aim');
            this.updateHint();
          }
          break;
        case 'KeyG':
          this.showGuide = !this.showGuide;
          this.guide.visible = this.showGuide;
          break;
        case 'KeyM': {
          this.audio.setMuted(!this.audio.muted);
          this.hud.toast(this.audio.muted ? '已静音' : '声音开启');
          break;
        }
        case 'KeyR':
          if (this.phase !== 'menu') this.newGame(this.difficulty);
          break;
        case 'ArrowLeft':
          if (this.phase === 'aiming' || this.phase === 'charging') {
            e.preventDefault();
            this.aimAngle -= 0.004;
            this.aimTarget = this.aimAngle;
          }
          break;
        case 'ArrowRight':
          if (this.phase === 'aiming' || this.phase === 'charging') {
            e.preventDefault();
            this.aimAngle += 0.004;
            this.aimTarget = this.aimAngle;
          }
          break;
        case 'Space':
          // 阻止默认行为：否则松开空格会"点击"持有焦点的按钮（重开/难度等），导致击球后被意外重开
          e.preventDefault();
          if (this.phase === 'aiming') {
            this.audio.ensure();
            this.spaceCharging = true;
            this.charging = true;
            this.phase = 'charging';
            this.power = 0;
          }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.spaceCharging && this.phase === 'charging') {
        this.spaceCharging = false;
        this.charging = false;
        if (this.power > 0.03) this.shoot(this.power, this.hud.spin.a, this.hud.spin.b);
        else {
          this.phase = 'aiming';
          this.power = 0;
          this.hud.setPower(0);
        }
      }
    });
  }

  private bindHud() {
    const b = this.hud.buttons;
    this.hud.onGuideColor = (hex) => this.guide.setColor(hex);
    this.guide.setColor(this.hud.guideColor);
    // 按钮点击后立即失焦，避免随后按空格触发按钮的默认激活
    document.querySelectorAll('#toolbar button, #overlay button, .diff-row button').forEach((btn) => {
      btn.addEventListener('click', () => (btn as HTMLButtonElement).blur());
    });
    b.btnStart.addEventListener('click', () => {
      this.audio.ensure();
      this.newGame(this.difficulty);
    });
    b.btnAgain.addEventListener('click', () => this.newGame(this.difficulty));
    b.btnCam.addEventListener('click', () => {
      if (this.rig.mode === 'aim') {
        if (this.fpLocked()) document.exitPointerLock();
        this.rig.setMode('orbit');
      } else {
        this.rig.setMode('aim');
      }
      this.updateHint();
    });
    b.btnGuide.addEventListener('click', () => {
      this.showGuide = !this.showGuide;
      this.guide.visible = this.showGuide;
    });
    b.btnSound.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.hud.toast(this.audio.muted ? '已静音' : '声音开启');
    });
    b.btnRestart.addEventListener('click', () => this.newGame(this.difficulty));
    document.querySelectorAll<HTMLButtonElement>('.diff-row button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-row button').forEach((x) => x.classList.remove('sel'));
        btn.classList.add('sel');
        this.difficulty = btn.dataset.diff as Difficulty;
      });
    });
  }

  /** 按当前视角/锁定状态更新底部操作提示 */
  private updateHint() {
    if (this.phase === 'placing') {
      this.hud.setHint('自由球：移动鼠标选择白球位置，点击放置');
      return;
    }
    if (this.rig.mode === 'aim') {
      this.hud.setHint(
        this.fpLocked()
          ? '移动鼠标瞄准 · 按住空格蓄力，松开击球 · 滚轮微调 · 右键/Esc 释放鼠标'
          : '点击画面锁定鼠标进入精确瞄准 · 滚轮微调 · 空格蓄力击球'
      );
    } else {
      this.hud.setHint('移动鼠标瞄准 · 按住左键拖动旋转视角 · 空格蓄力击球 · V 切换视角');
    }
    const cross = document.getElementById('crosshair');
    if (cross) cross.style.display = this.rig.mode === 'aim' && this.fpLocked() ? 'block' : 'none';
  }

  private raycastTable(): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = new THREE.Vector3();
    const r = this.raycaster.ray.intersectPlane(this.tablePlane, hit);
    return r ? { x: hit.x, z: hit.z } : null;
  }

  // ── 击球与结算 ─────────────────────────────────────────────

  private shoot(power: number, spinA: number, spinB: number) {
    const cue = this.cue;
    const dirX = Math.cos(this.aimAngle);
    const dirZ = Math.sin(this.aimAngle);
    strike(cue, dirX, dirZ, power, spinA, spinB);
    this.audio.play('strike', power * 8);
    this.cueRenderer.strike();
    this.guide.hide();
    this.world.events.length = 0;
    this.eventIdx = 0;
    this.phase = 'shooting';
    this.power = 0;
    this.hud.setPower(0);
    this.hud.resetSpin();
  }

  private shootAiPlan(plan: AiShotPlan) {
    const cue = this.cue;
    strike(cue, plan.dirX, plan.dirZ, plan.power, plan.spinA, plan.spinB);
    this.audio.play('strike', plan.power * 8);
    this.cueRenderer.strike();
    this.guide.hide();
    this.world.events.length = 0;
    this.eventIdx = 0;
    this.phase = 'shooting';
  }

  private processEvents() {
    const evts = this.world.events;
    let sounds = 0;
    while (this.eventIdx < evts.length) {
      const e = evts[this.eventIdx++];
      if (e.type === 'ball-ball' && sounds < 4) {
        this.audio.play('ball', e.speed);
        sounds++;
      } else if (e.type === 'cushion' && sounds < 4) {
        this.audio.play('cushion', e.speed);
        sounds++;
      } else if (e.type === 'pocket') {
        this.audio.play('pocket', 1);
      }
    }
  }

  private buildRecord(): ShotRecord {
    const shooter = this.rules.turn;
    const isBreak = this.rules.phase === 'break';
    let firstContact: number | null = null;
    let firstContactT = Infinity;
    const potted: number[] = [];
    let cuePotted = false;
    let railAfterContact = false;
    const ballsToRail = new Set<number>();
    for (const e of this.world.events) {
      if (e.type === 'ball-ball' && e.balls.includes(0)) {
        const other = e.balls[0] === 0 ? e.balls[1] : e.balls[0];
        if (firstContact === null) {
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
    return { shooter, isBreak, firstContact, potted, cuePotted, railAfterContact, ballsToRail: ballsToRail.size };
  }

  private endShot() {
    const rec = this.buildRecord();
    const out = evaluateShot(this.rules, rec);
    this.rules = out.state;

    for (const m of out.messages) {
      this.hud.toast(m, m.includes('犯规') ? 'foul' : 'good');
    }
    if (out.respot8) {
      const eight = this.world.balls.find((b) => b.id 	=== 8)!;
      respotBall(eight, this.world.balls);
    }

    this.hud.updateRules(this.rules);

    if (this.rules.phase === 'over') {
      this.phase = 'over';
      const youWin = this.rules.winner === 0;
      this.hud.showGameOver(youWin, youWin ? '漂亮！把胜利收入囊中。' : '再接再厉，调整策略试试。');
      this.hud.setHint('按 R 或点击"再来一局"重新开始');
      return;
    }

    if (out.state.turn === 1) {
      this.startAiTurn(out.state.ballInHand);
    } else if (out.state.ballInHand) {
      this.beginPlacing();
    } else {
      this.phase = 'aiming';
      this.initAimFromCue();
    }
  }

  // ── 自由球（白球摆放） ─────────────────────────────────

  private beginPlacing() {
    this.phase = 'placing';
    this.hud.setHint('自由球：移动鼠标选择白球位置，点击放置');
    const cue = this.cue;
    cue.active = false;
    cue.pocketed = true; // 摆放期间标记，放置后恢复
    this.updatePlacing(this.cue.x === 0 && this.cue.z === 0 ? 0 : TABLE.headStringX, 0);
  }

  private updatePlacing(x: number, z: number) {
    const hl = TABLE.L / 2 - BALL_R;
    const hw = TABLE.W / 2 - BALL_R;
    this.placing.x = Math.min(hl, Math.max(-hl, x));
    this.placing.z = Math.min(hw, Math.max(-hw, z));
    let valid = true;
    for (const b of this.world.balls) {
      if (b.id === 0 || !b.active) continue;
      if (Math.hypot(b.x - this.placing.x, b.z - this.placing.z) < BALL_R * 2 + 0.002) valid = false;
    }
    this.placing.valid = valid;
    this.ballRenderer.setCueBallPreview(this.placing.x, this.placing.z, true);
    const mesh = this.ballRenderer.meshes.get(0);
    if (mesh) {
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.emissive.set(valid ? 0x0a3d22 : 0x5a1410);
    }
  }

  private confirmPlacing() {
    const cue = this.cue;
    cue.active = true;
    cue.pocketed = false;
    cue.x = this.placing.x;
    cue.z = this.placing.z;
    cue.vx = cue.vz = 0;
    cue.wx = cue.wy = cue.wz = 0;
    const mesh = this.ballRenderer.meshes.get(0)!;
    (mesh.material as THREE.MeshPhysicalMaterial).emissive.set(0x000000);
    this.rules = { ...this.rules, ballInHand: false };
    this.phase = 'aiming';
    this.updateHint();
    this.initAimFromCue();
  }

  // ── AI 回合 ─────────────────────────────────────────────

  private startAiTurn(ballInHand: boolean) {
    this.phase = 'ai-thinking';
    this.hud.setAiThinking(true);
    if (ballInHand) this.aiPlaceCueBall();

    const seed = (Math.random() * 0xffffffff) >>> 0;
    planShot(this.world, this.rules, this.difficulty, seed, (p) => {
      this.hud.setAiThinking(true, `AI 思考中… ${Math.round(p * 100)}%`);
    }).then((plan) => {
      this.hud.setAiThinking(false);
      this.aiPlan = plan;
      this.aiTimer = 1.2; // 展示 AI 瞄准
      this.phase = 'ai-aiming';
      this.hud.setHint(`AI 准备：${plan.desc}`);
      this.aimTarget = Math.atan2(plan.dirZ, plan.dirX); // 平滑扫向 AI 的瞄准方向，视觉更自然
    });
  }

  /** AI 自由球摆放：网格扫描，选进攻机会最好的位置 */
  private aiPlaceCueBall() {
    const targets = legalTargets(this.rules)
      .map((id) => this.world.balls.find((b) => b.id === id)!)
      .filter(Boolean);
    let best = { x: TABLE.headStringX, z: 0, score: -Infinity };
    for (let gx = -6; gx <= 6; gx++) {
      for (let gz = -4; gz <= 4; gz++) {
        const x = (gx / 6) * (TABLE.L / 2 - BALL_R - 0.02);
        const z = (gz / 4) * (TABLE.W / 2 - BALL_R - 0.02);
        let clear = true;
        for (const b of this.world.balls) {
          if (b.id === 0 || !b.active) continue;
          if (Math.hypot(b.x - x, b.z - z) < BALL_R * 2 + 0.004) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        // 评分：对每个目标球×袋口的切角可打性
        let score = 0;
        for (const t of targets) {
          for (const p of this.geom.pockets) {
            const pdx = p.x - t.x;
            const pdz = p.z - t.z;
            const pl = Math.hypot(pdx, pdz);
            const adx = t.x - pdx / pl * BALL_R * 2 - x;
            const adz = t.z - pdz / pl * BALL_R * 2 - z;
            const al = Math.hypot(adx, adz);
            if (al < 0.05) continue;
            const cut = (adx / al) * (pdx / pl) + (adz / al) * (pdz / pl);
            if (cut > 0.35) score += cut;
          }
        }
        score -= Math.hypot(x, z) * 0.1; // 略偏好台面中部
        if (score > best.score) best = { x, z, score };
      }
    }
    const cue = this.cue;
    cue.active = true;
    cue.pocketed = false;
    cue.x = best.x;
    cue.z = best.z;
    cue.vx = cue.vz = 0;
    cue.wx = cue.wy = cue.wz = 0;
    this.rules = { ...this.rules, ballInHand: false };
  }

  // ── 主循环 ─────────────────────────────────────────────

  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.phase === 'menu') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 瞄准平滑：向目标角度指数趋近（最短弧），消除指针抖动带来的镜头晃动
    let dAng = this.aimTarget - this.aimAngle;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    this.aimAngle += dAng * (1 - Math.exp(-dt * 14));

    const cue = this.cue;
    const dirX = Math.cos(this.aimAngle);
    const dirZ = Math.sin(this.aimAngle);

    // 空格蓄力
    if (this.spaceCharging && this.phase === 'charging') {
      this.power = Math.min(1, this.power + dt * 0.85);
      this.hud.setPower(this.power);
    }

    if (this.phase === 'shooting') {
      stepWorld(this.world, dt);
      this.processEvents();
      if (allStopped(this.world)) {
        this.phase = 'settling';
        this.settleTimer = 0.45;
      }
    } else if (this.phase === 'settling') {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.endShot();
    } else if (this.phase === 'aiming' || this.phase === 'charging') {
      // 辅助线与球杆
      if (cue.active) {
        const pull = this.phase === 'charging' ? 0.02 + this.power * 0.22 : 0.015;
        this.cueRenderer.aim(cue.x, cue.z, dirX, dirZ, pull);
        if (this.showGuide) {
          const pv = castCue(this.world.balls, 0, dirX, dirZ);
          this.guide.show(cue.x, cue.z, pv);
        }
        this.rig.updateAim(cue.x, cue.z, dirX, dirZ);
      }
    } else if (this.phase === 'ai-aiming') {
      this.aiTimer -= dt;
      if (cue.active && this.aiPlan) {
        const pull = 0.06 + this.aiPlan.power * 0.2;
        this.cueRenderer.aim(cue.x, cue.z, this.aiPlan.dirX, this.aiPlan.dirZ, pull);
        if (this.showGuide) {
          const pv = castCue(this.world.balls, 0, this.aiPlan.dirX, this.aiPlan.dirZ);
          this.guide.show(cue.x, cue.z, pv);
        }
        this.rig.updateAim(cue.x, cue.z, this.aiPlan.dirX, this.aiPlan.dirZ);
      }
      if (this.aiTimer <= 0 && this.aiPlan) {
        const plan = this.aiPlan;
        this.aiPlan = null;
        this.updateHint();
        this.shootAiPlan(plan);
      }
    }

    this.ballRenderer.syncBalls(this.world.balls);
    this.ballRenderer.update(this.world.balls, dt);
    this.cueRenderer.update(dt);
    this.rig.update(dt);
    this.renderer.render(this.scene, this.camera);
  };
}
