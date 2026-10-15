// HUD：顶栏信息、力度条、杆法控件、toast、覆盖菜单。

import { groupBalls, type RulesState, type Group } from '../rules/eightball';
import { BALL_COLORS } from '../render/textures';

export class Hud {
  private el = {
    turn: document.getElementById('turn-indicator')!,
    g0: document.getElementById('g0')!,
    g1: document.getElementById('g1')!,
    balls0: document.getElementById('balls0')!,
    balls1: document.getElementById('balls1')!,
    p0: document.getElementById('p0')!,
    p1: document.getElementById('p1')!,
    powerFill: document.getElementById('power-fill')!,
    powerPct: document.getElementById('power-pct')!,
    toast: document.getElementById('toast')!,
    aiStatus: document.getElementById('ai-status')!,
    aiStatusText: document.getElementById('ai-status-text')!,
    hint: document.getElementById('hint')!,
    overlay: document.getElementById('overlay')!,
    menuPanel: document.getElementById('menu-panel')!,
    overPanel: document.getElementById('over-panel')!,
    finalTitle: document.getElementById('final-title')!,
    finalSub: document.getElementById('final-sub')!,
    btnCam: document.getElementById('btn-cam')!,
    btnGuide: document.getElementById('btn-guide')!,
    btnSound: document.getElementById('btn-sound')!,
    btnRestart: document.getElementById('btn-restart')!,
    btnStart: document.getElementById('btn-start')!,
    btnAgain: document.getElementById('btn-again')!,
    spinCanvas: document.getElementById('spin-canvas') as HTMLCanvasElement,
  };

  spin = { a: 0, b: 0 }; // a: 左右塞(+=右), b: 高低杆(+=高)
  onSpinChange: (() => void) | null = null;

  constructor() {
    this.initSpinWidget();
  }

  private redrawSpin(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const r = 46;
    const cx = c.width / 2;
    const cy = c.height / 2;
    ctx.clearRect(0, 0, c.width, c.height);
    const grad = ctx.createRadialGradient(cx - 12, cy - 14, 4, cx, cy, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.75, '#e8e4d8');
    grad.addColorStop(1, '#b9b4a4');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
    // 击点
    const px = cx + this.spin.a * 2 * r * 0.92;
    const py = cy - this.spin.b * 2 * r * 0.46;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#d43a2f';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private initSpinWidget() {
    const c = this.el.spinCanvas;
    const ctx = c.getContext('2d')!;
    const draw = () => this.redrawSpin(c, ctx);
    draw();

    const setFromEvent = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = 0.5 - (e.clientY - rect.top) / rect.height;
      // 击点限制在半径 0.5 内（相对球半径比例），y 压缩显示
      let a = x;
      let b = y / 0.5;
      const m = Math.hypot(a, b);
      if (m > 0.5) {
        a = (a / m) * 0.5;
        b = (b / m) * 0.5;
      }
      this.spin.a = a;
      this.spin.b = b;
      draw();
      this.onSpinChange?.();
    };
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // 合成指针（自动化测试）无活动指针时忽略
      }
      setFromEvent(e);
      const mv = (ev: PointerEvent) => setFromEvent(ev);
      const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
      };
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', up);
    });
    c.addEventListener('dblclick', () => {
      this.spin.a = 0;
      this.spin.b = 0;
      draw();
      this.onSpinChange?.();
    });
  }

  resetSpin() {
    this.spin.a = 0;
    this.spin.b = 0;
    const c = this.el.spinCanvas;
    this.redrawSpin(c, c.getContext('2d')!);
    this.onSpinChange?.();
  }

  updateRules(st: RulesState) {
    const groupName = (g: Group | null) => (g === 'solid' ? '全色 1-7' : g === 'stripe' ? '花色 9-15' : '未分组');
    this.el.g0.textContent = groupName(st.groups[0]);
    this.el.g1.textContent = groupName(st.groups[1]);
    this.el.p0.classList.toggle('active', st.turn === 0 && st.phase !== 'over');
    this.el.p1.classList.toggle('active', st.turn === 1 && st.phase !== 'over');
    this.el.turn.textContent =
      st.phase === 'over' ? '对局结束' : st.turn === 0 ? '你的回合' : 'AI 回合';

    const renderBalls = (container: HTMLElement, group: Group | null) => {
      container.innerHTML = '';
      if (group === null) {
        container.innerHTML = '<span style="font-size:11px;color:#556">待分组</span>';
        return;
      }
      for (const id of groupBalls(group)) {
        const d = document.createElement('div');
        const g = id < 8 ? 'solid' : 'stripe';
        d.className = `miniball ${g}`;
        d.style.setProperty('--c', BALL_COLORS[id]);
        d.title = `${id} 号`;
        if (st.potted.includes(id)) d.classList.add('potted');
        container.appendChild(d);
      }
    };
    renderBalls(this.el.balls0, st.groups[0]);
    renderBalls(this.el.balls1, st.groups[1]);
  }

  setPower(p: number) {
    this.el.powerFill.style.height = `${Math.round(p * 100)}%`;
    this.el.powerPct.textContent = `${Math.round(p * 100)}%`;
  }

  toast(msg: string, kind: '' | 'foul' | 'good' = '', ms = 2600) {
    const d = document.createElement('div');
    d.className = `toast-item ${kind}`;
    d.textContent = msg;
    this.el.toast.appendChild(d);
    setTimeout(() => d.remove(), ms);
  }

  setAiThinking(show: boolean, text = 'AI 思考中…') {
    this.el.aiStatus.classList.toggle('show', show);
    this.el.aiStatusText.textContent = text;
  }

  setHint(text: string) {
    this.el.hint.textContent = text;
  }

  showMenu() {
    this.el.overlay.classList.remove('hidden');
    this.el.menuPanel.style.display = '';
    this.el.overPanel.style.display = 'none';
  }

  showGameOver(youWin: boolean, sub: string) {
    this.el.overlay.classList.remove('hidden');
    this.el.menuPanel.style.display = 'none';
    this.el.overPanel.style.display = '';
    this.el.finalTitle.textContent = youWin ? '🏆 胜利！' : '😴 惜败';
    this.el.finalTitle.style.color = youWin ? '#ffd866' : '#9fb0c8';
    this.el.finalSub.textContent = sub;
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }

  get buttons() {
    return this.el;
  }
}
