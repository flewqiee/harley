/**
 * harley-behaviors.js
 * ----------------------------------------------------------------
 * A small weighted scheduler for autonomous idle behavior — the
 * "does something small every once in a while, unprompted" feeling.
 *
 * Deliberately NOT a `setInterval(() => Math.random() ...)` loop:
 * each behavior declares its own cooldown, weight, and which
 * persistent states it's allowed to run in. Every tick we pick one
 * eligible behavior via weighted random choice, run it, then wait a
 * randomized interval before considering the next one. One pending
 * timer at a time — nothing accumulates, nothing leaks.
 *
 * This module never touches the assistant / AI layer. It only calls
 * back into the pet controller it's given.
 */

const MINUTE = 60_000;

/**
 * @typedef {object} Behavior
 * @property {string} name
 * @property {number} weight        relative likelihood when eligible
 * @property {number} cooldownMs    minimum time between runs
 * @property {string[]} inStates    persistent states this may run in
 * @property {(ctx: BehaviorContext) => void} run
 */

/** @type {Behavior[]} */
const BEHAVIORS = [
  {
    name: 'blink-twice',
    weight: 6, cooldownMs: 4_500, inStates: ['idle', 'curious', 'focused', 'happy', 'listening'],
    run: (ctx) => ctx.pulse('doing-blink', 240, () => {
      setTimeout(() => ctx.pulse('doing-blink', 240), 220 + Math.random() * 160);
    }),
  },
  {
    name: 'look-side',
    weight: 4, cooldownMs: 15_000, inStates: ['idle', 'curious'],
    run: (ctx) => {
      const dir = Math.random() < 0.5 ? -1 : 1;
      ctx.lookAt(dir * (2.5 + Math.random() * 1.5), (Math.random() - 0.5) * 1.5);
      setTimeout(() => ctx.lookAt(0, 0), 1400 + Math.random() * 900);
    },
  },
  {
    name: 'ear-twitch',
    weight: 3, cooldownMs: 20_000, inStates: ['idle', 'curious', 'focused'],
    run: (ctx) => ctx.pulse('doing-ear-twitch', 500),
  },
  {
    name: 'tail-flick',
    weight: 3, cooldownMs: 18_000, inStates: ['idle', 'curious', 'happy'],
    run: (ctx) => ctx.pulse('doing-tail-flick', 700),
  },
  {
    name: 'weight-shift',
    weight: 2, cooldownMs: 25_000, inStates: ['idle'],
    run: (ctx) => ctx.pulse('doing-weight-shift', 2200),
  },
  {
    name: 'stretch',
    weight: 1, cooldownMs: 60_000, inStates: ['idle'],
    run: (ctx) => ctx.pulse('doing-stretch', 1100),
  },
  {
    name: 'curious-glance',
    weight: 1.5, cooldownMs: 30_000, inStates: ['idle'],
    run: (ctx) => {
      ctx.setState('curious');
      setTimeout(() => ctx.settle(), 1800 + Math.random() * 700);
    },
  },
];

export class BehaviorScheduler {
  /**
   * @param {object} ctx
   * @param {() => string} ctx.getState
   * @param {(s: string) => void} ctx.setState   only used for transient looks
   * @param {() => void} ctx.settle              return to true idle
   * @param {(cls: string, ms: number, cb?: () => void) => void} ctx.pulse
   * @param {(x: number, y: number) => void} ctx.lookAt
   * @param {() => number} ctx.msSinceActivity
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.lastRun = new Map();
    this.timer = null;
    this.running = false;
    this.sleepyAfterMs = 6 * MINUTE;
    this.sleepAfterMs = 9 * MINUTE;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  _scheduleNext() {
    if (!this.running) return;
    const delay = 4000 + Math.random() * 7000; // 4–11s, feels irregular
    this.timer = setTimeout(() => this._tick(), delay);
  }

  _tick() {
    if (!this.running) return;
    this._maybeDrift();

    const now = Date.now();
    const state = this.ctx.getState();
    const eligible = BEHAVIORS.filter((b) => {
      const last = this.lastRun.get(b.name) || 0;
      return b.inStates.includes(state) && now - last >= b.cooldownMs;
    });

    if (eligible.length) {
      const chosen = weightedPick(eligible);
      this.lastRun.set(chosen.name, now);
      chosen.run(this.ctx);
    }

    this._scheduleNext();
  }

  /** Escalate idle → sleepy → sleeping purely from inactivity. */
  _maybeDrift() {
    const state = this.ctx.getState();
    if (state !== 'idle' && state !== 'sleepy') return;
    const idleFor = this.ctx.msSinceActivity();
    if (idleFor >= this.sleepAfterMs && state !== 'sleeping') {
      this.ctx.setState('sleeping');
    } else if (idleFor >= this.sleepyAfterMs && state === 'idle') {
      this.ctx.setState('sleepy');
    }
  }
}

function weightedPick(items) {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
