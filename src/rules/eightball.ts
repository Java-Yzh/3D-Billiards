// 中式八球规则状态机（纯逻辑，与渲染解耦）。
// 参考《中式台球竞赛规则》主要条款，个别少见情形做了简化：
// - 开球犯规（少于 4 颗目标球碰库且无进球）→ 对方自由球（不提供重新开球选项）
// - 白球跳出台面在物理上不会发生（袋口兜底捕获），不做处理

export type Group = 'solid' | 'stripe';

export interface RulesState {
  phase: 'break' | 'open' | 'assigned' | 'over';
  turn: 0 | 1; // 0 = 玩家，1 = AI
  groups: [Group | null, Group | null];
  /** 已落袋目标球（按顺序，不含白球；黑 8 重摆会从中移除） */
  potted: number[];
  /** 当前轮到的一方获得自由球（全场摆放） */
  ballInHand: boolean;
  winner: 0 | 1 | null;
}

export interface ShotRecord {
  shooter: 0 | 1;
  isBreak: boolean;
  /** 白球首先接触的目标球号码；空杆为 null */
  firstContact: number | null;
  /** 本杆落袋顺序（不含白球） */
  potted: number[];
  cuePotted: boolean;
  /** 首次触球后是否有任意球碰库 */
  railAfterContact: boolean;
  /** 本杆碰过库的目标球数量（开球判定用） */
  ballsToRail: number;
}

export interface ShotOutcome {
  state: RulesState;
  messages: string[];
  /** 出杆的一方继续击球 */
  continueTurn: boolean;
  /** 黑 8 需要摆回置球点 */
  respot8: boolean;
}

export function initialRules(firstShooter: 0 | 1 = 0): RulesState {
  return {
    phase: 'break',
    turn: firstShooter,
    groups: [null, null],
    potted: [],
    ballInHand: false,
    winner: null,
  };
}

export function groupOf(id: number): 'solid' | 'stripe' | 'eight' | 'cue' {
  if (id === 0) return 'cue';
  if (id === 8) return 'eight';
  return id < 8 ? 'solid' : 'stripe';
}

export function groupBalls(g: Group): number[] {
  return g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
}

/** 当前局面下，轮到的一方可以合法首先接触的球（AI 与犯规判定共用） */
export function legalTargets(st: RulesState): number[] {
  const onTable = (id: number) => !st.potted.includes(id);
  if (st.phase === 'break') return groupBalls('solid').concat(groupBalls('stripe'));
  if (st.phase === 'open') {
    const all = groupBalls('solid').concat(groupBalls('stripe')).filter(onTable);
    return all; // 开放球局不可先碰黑 8
  }
  const g = st.groups[st.turn]!;
  const own = groupBalls(g).filter(onTable);
  return own.length > 0 ? own : [8];
}

function other(p: 0 | 1): 0 | 1 {
  return p === 0 ? 1 : 0;
}

/** 评估一杆结束后的规则结果。 */
export function evaluateShot(prev: RulesState, rec: ShotRecord): ShotOutcome {
  const st: RulesState = { ...prev, potted: [...prev.potted] };
  const messages: string[] = [];
  let respot8 = false;
  const shooter = rec.shooter;
  const opp = other(shooter);
  const shooterName = shooter === 0 ? '你' : 'AI';

  // 黑 8 处理
  const eightPotted = rec.potted.includes(8);
  if (eightPotted) {
    if (rec.isBreak) {
      respot8 = true;
      messages.push('开球黑 8 进袋，重新摆回置球点');
    } else {
      // 合法打 8：出杆前己方 7 颗已全部落袋、首触合法、白球未落袋、无其他犯规
      const g = st.groups[shooter];
      const ownCleared = g !== null && groupBalls(g).every((id) => st.potted.includes(id));
      const foulBefore8 =
        rec.cuePotted ||
        rec.firstContact === null ||
        (st.phase === 'open') ||
        (st.groups[shooter] !== null && rec.firstContact !== 8);
      if (ownCleared && !foulBefore8) {
        st.phase = 'over';
        st.winner = shooter;
        messages.push(shooter === 0 ? '🎯 你打进了黑 8，获胜！' : 'AI 打进了黑 8，AI 获胜');
        return { state: st, messages, continueTurn: false, respot8 };
      } else {
        st.phase = 'over';
        st.winner = opp;
        messages.push(
          rec.cuePotted
            ? `黑 8 进袋但白球落袋，${shooterName}告负`
            : `提前击落黑 8，${shooterName}告负`
        );
        return { state: st, messages, continueTurn: false, respot8 };
      }
    }
  }

  // 记录落袋（黑 8 重摆则不入档）
  for (const id of rec.potted) {
    if (id === 8 && respot8) continue;
    st.potted.push(id);
  }

  // 犯规判定
  let foul = false;
  if (rec.cuePotted) {
    foul = true;
    messages.push('犯规：白球落袋');
  } else if (rec.firstContact === null) {
    foul = true;
    messages.push('犯规：空杆，未击中任何球');
  } else if (rec.isBreak) {
    if (rec.potted.length === 0 && rec.ballsToRail < 4) {
      foul = true;
      messages.push('开球犯规：无球入袋且碰库目标球不足 4 颗');
    }
  } else if (st.phase === 'open') {
    if (rec.firstContact === 8) {
      foul = true;
      messages.push('犯规：开放球局不能首先击打黑 8');
    }
  } else {
    const own = legalTargets(prev); // 以出杆前局面判定
    if (!own.includes(rec.firstContact)) {
      foul = true;
      const g = prev.groups[shooter];
      const ownCleared = g !== null && groupBalls(g).every((id) => prev.potted.includes(id));
      messages.push(ownCleared ? '犯规：未首先击打黑 8' : '犯规：首先击打了对方的球');
    }
  }
  if (!foul && !rec.isBreak && rec.potted.length === 0 && !rec.railAfterContact) {
    foul = true;
    messages.push('犯规：击球后无球碰库');
  }

  // 定组（开放球局下首次合法进球）
  if (st.phase === 'open' && !rec.isBreak && !foul) {
    const firstPot = rec.potted.find((id) => id !== 8);
    if (firstPot !== undefined) {
      const g = groupOf(firstPot) as Group;
      st.groups[shooter] = g;
      st.groups[opp] = g === 'solid' ? 'stripe' : 'solid';
      st.phase = 'assigned';
      const gName = g === 'solid' ? '全色（1-7）' : '花色（9-15）';
      const oName = g === 'solid' ? '花色（9-15）' : '全色（1-7）';
      messages.push(`分组确定：${shooterName} = ${gName}，${opp === 0 ? '你' : 'AI'} = ${oName}`);
    }
  }

  // 阶段推进与轮次
  if (st.phase === 'break') st.phase = 'open';

  if (foul) {
    st.turn = opp;
    st.ballInHand = true;
    return { state: st, messages, continueTurn: false, respot8 };
  }

  // 是否继续：本杆打进了自己的球（开放/开球阶段：任何非 8 进球）
  let pottedOwn = false;
  if (st.phase === 'assigned') {
    const g = st.groups[shooter];
    pottedOwn = rec.potted.some((id) => id !== 8 && groupOf(id) === g);
  } else {
    pottedOwn = rec.potted.some((id) => id !== 8);
  }
  if (pottedOwn && !(rec.isBreak && respot8 && rec.potted.length === 1)) {
    st.turn = shooter;
    st.ballInHand = false;
    return { state: st, messages, continueTurn: true, respot8 };
  }

  st.turn = opp;
  st.ballInHand = false;
  return { state: st, messages, continueTurn: false, respot8 };
}
