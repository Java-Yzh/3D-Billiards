import { describe, it, expect } from 'vitest';
import { initialRules, evaluateShot, legalTargets, type ShotRecord } from '../src/rules/eightball';

const base: ShotRecord = {
  shooter: 0,
  isBreak: false,
  firstContact: 1,
  potted: [],
  cuePotted: false,
  railAfterContact: true,
  ballsToRail: 4,
};

const assignedState = (potted: number[] = []) => ({
  ...initialRules(0),
  phase: 'assigned' as const,
  groups: ['solid', 'stripe'] as ['solid', 'stripe'],
  potted,
});

describe('规则状态机', () => {
  it('开球后进入开放球局，未进球换人', () => {
    const out = evaluateShot(initialRules(0), { ...base, isBreak: true, firstContact: 1, ballsToRail: 5 });
    expect(out.state.phase).toBe('open');
    expect(out.state.turn).toBe(1);
    expect(out.state.groups).toEqual([null, null]);
  });

  it('开球进球不定组，且开球方继续', () => {
    const out = evaluateShot(initialRules(0), {
      ...base,
      isBreak: true,
      firstContact: 3,
      potted: [3, 11],
      ballsToRail: 5,
    });
    expect(out.state.phase).toBe('open');
    expect(out.state.groups).toEqual([null, null]);
    expect(out.continueTurn).toBe(true);
  });

  it('开球少于4球碰库且无进球为犯规，对方自由球', () => {
    const out = evaluateShot(initialRules(0), { ...base, isBreak: true, firstContact: 1, ballsToRail: 2 });
    expect(out.state.ballInHand).toBe(true);
    expect(out.state.turn).toBe(1);
  });

  it('开放球局首次合法进球定组', () => {
    const st = { ...initialRules(0), phase: 'open' as const };
    const out = evaluateShot(st, { ...base, firstContact: 5, potted: [5] });
    expect(out.state.groups[0]).toBe('solid');
    expect(out.state.groups[1]).toBe('stripe');
    expect(out.state.phase).toBe('assigned');
    expect(out.continueTurn).toBe(true);
  });

  it('开放球局首先击打黑8为犯规', () => {
    const st = { ...initialRules(0), phase: 'open' as const };
    const out = evaluateShot(st, { ...base, firstContact: 8 });
    expect(out.state.turn).toBe(1);
    expect(out.state.ballInHand).toBe(true);
  });

  it('分定后首先击打对方球为犯规', () => {
    const st = assignedState([1]);
    const out = evaluateShot(st, { ...base, firstContact: 11 });
    expect(out.state.ballInHand).toBe(true);
    expect(out.state.turn).toBe(1);
  });

  it('白球落袋为犯规', () => {
    const st = { ...initialRules(0), phase: 'open' as const };
    const out = evaluateShot(st, { ...base, firstContact: 2, potted: [2], cuePotted: true });
    expect(out.state.ballInHand).toBe(true);
    expect(out.state.turn).toBe(1);
  });

  it('击球后无球碰库且无进球为犯规', () => {
    const st = { ...initialRules(0), phase: 'open' as const };
    const out = evaluateShot(st, { ...base, firstContact: 2, railAfterContact: false });
    expect(out.state.ballInHand).toBe(true);
  });

  it('打进自己的球继续击球，只打进对方球换人', () => {
    const st = assignedState();
    const a = evaluateShot(st, { ...base, firstContact: 2, potted: [2, 12] });
    expect(a.continueTurn).toBe(true);
    const b = evaluateShot(st, { ...base, firstContact: 2, potted: [12] });
    expect(b.continueTurn).toBe(false);
    expect(b.state.turn).toBe(1);
  });

  it('清完己组后合法打进黑8获胜', () => {
    const st = {
      ...initialRules(0),
      phase: 'assigned' as const,
      groups: ['solid', 'stripe'] as ['solid', 'stripe'],
      potted: [1, 2, 3, 4, 5, 6, 7],
    };
    const out = evaluateShot(st, { ...base, firstContact: 8, potted: [8] });
    expect(out.state.winner).toBe(0);
    expect(out.state.phase).toBe('over');
  });

  it('提前打进黑8告负', () => {
    const st = {
      ...initialRules(0),
      phase: 'assigned' as const,
      groups: ['solid', 'stripe'] as ['solid', 'stripe'],
      potted: [1, 2],
    };
    const out = evaluateShot(st, { ...base, firstContact: 3, potted: [3, 8] });
    expect(out.state.winner).toBe(1);
  });

  it('打黑8同时白球落袋告负', () => {
    const st = {
      ...initialRules(0),
      phase: 'assigned' as const,
      groups: ['solid', 'stripe'] as ['solid', 'stripe'],
      potted: [1, 2, 3, 4, 5, 6, 7],
    };
    const out = evaluateShot(st, { ...base, firstContact: 8, potted: [8], cuePotted: true });
    expect(out.state.winner).toBe(1);
  });

  it('开球打进黑8重摆，不判胜负', () => {
    const out = evaluateShot(initialRules(0), {
      ...base,
      isBreak: true,
      firstContact: 1,
      potted: [8, 2],
    });
    expect(out.respot8).toBe(true);
    expect(out.state.phase).not.toBe('over');
    expect(out.state.potted.includes(8)).toBe(false);
    expect(out.continueTurn).toBe(true);
  });

  it('legalTargets：开放球局不含黑8，清完己组后为黑8', () => {
    const open = { ...initialRules(0), phase: 'open' as const };
    const targets = legalTargets(open);
    expect(targets).not.toContain(8);
    expect(targets.length).toBe(14);

    const st = {
      ...initialRules(0),
      phase: 'assigned' as const,
      groups: ['solid', 'stripe'] as ['solid', 'stripe'],
      potted: [1, 2, 3, 4, 5, 6, 7],
    };
    expect(legalTargets(st)).toEqual([8]);
  });
});
