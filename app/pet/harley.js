/**
 * harley.js
 * ----------------------------------------------------------------
 * Public entry point. This is the ONLY file the rest of the
 * assistant should ever import or call into:
 *
 *   import { Harley } from './pet/harley.js';
 *   Harley.init();
 *   Harley.setState('thinking');
 *   Harley.react('success');
 *   Harley.say('got it.');
 *
 * Everything about SVG structure, CSS classes, and animation timing
 * is private to this module and its two collaborators
 * (harley-state.js, harley-behaviors.js). Nothing outside this file
 * should ever query `.harley-*` selectors directly.
 */

import { StateMachine, BubbleController } from './harley-state.js';
import { BehaviorScheduler } from './harley-behaviors.js';

/** Reaction → [CSS class, duration ms, occasional micro-lines]. */
const REACTIONS = {
  success:   { cls: 'is-reacting-success',   ms: 650, lines: ['nice.', 'done.', 'got it.'] },
  celebrate: { cls: 'is-reacting-celebrate',  ms: 900, lines: ['nice!', 'got it.'] },
  excited:   { cls: 'is-reacting-celebrate',  ms: 900, lines: ['nice!'] },
  surprise:  { cls: 'is-reacting-surprise',   ms: 450, lines: ['oh?', 'huh.'] },
  attention: { cls: 'is-reacting-attention',  ms: 550, lines: [] },
  error:     { cls: 'is-reacting-error',      ms: 550, lines: [] },
};
const MICRO_LINE_CHANCE = 0.18; // reactions rarely speak — see spec §12

class HarleyController {
  constructor() {
    this._ready = false;
    this._activeReactionTimer = null;
    this._lastActivity = Date.now();
    this._boundOnVisibility = () => this._onVisibilityChange();
    this._boundOnActivity = throttle(() => { this._lastActivity = Date.now(); }, 5000);
  }

  /**
   * @param {object} [opts]
   * @param {string|HTMLElement} [opts.root='#pet']
   * @param {boolean} [opts.trackGlobalActivity=true]
   *        Listen for window-level input to know when the user is
   *        "around" (used for the sleepy/sleeping drift). Set false
   *        if your assistant already tracks activity and prefers to
   *        drive it via notifyActivity() itself.
   * @param {boolean} [opts.autoStart=true] start the idle scheduler
   */
  init(opts = {}) {
    if (this._ready) return this;
    const { root = '#pet', trackGlobalActivity = true, autoStart = true } = opts;

    this.root = typeof root === 'string' ? document.querySelector(root) : root;
    if (!this.root) {
      console.warn('[Harley] root element not found, init() aborted');
      return this;
    }

    this.state = new StateMachine(this.root);
    this.bubble = new BubbleController(this.root);
    this.root.classList.add('harley-eyes-look');

    this.scheduler = new BehaviorScheduler({
      getState: () => this.state.state,
      setState: (s) => this.state.set(s),
      settle: () => this.state.set(this._restState),
      pulse: (cls, ms, cb) => this._pulse(cls, ms, cb),
      lookAt: (x, y) => this.lookAt(x, y),
      msSinceActivity: () => Date.now() - this._lastActivity,
    });

    // The mood the scheduler returns to after a transient glance.
    this._restState = 'idle';

    document.addEventListener('visibilitychange', this._boundOnVisibility);
    if (trackGlobalActivity) {
      ['mousemove', 'keydown', 'mousedown', 'wheel'].forEach((evt) =>
        window.addEventListener(evt, this._boundOnActivity, { passive: true }));
    }

    this._ready = true;
    if (autoStart) this.scheduler.start();
    return this;
  }

  /** Tear down listeners/timers — call if Harley is ever unmounted. */
  destroy() {
    if (!this._ready) return;
    this.scheduler.stop();
    document.removeEventListener('visibilitychange', this._boundOnVisibility);
    ['mousemove', 'keydown', 'mousedown', 'wheel'].forEach((evt) =>
      window.removeEventListener(evt, this._boundOnActivity));
    clearTimeout(this._activeReactionTimer);
    this._ready = false;
  }

  // ---------------------------------------------------------------
  // Persistent state
  // ---------------------------------------------------------------

  /** Set Harley's resting mood. Cheap to call frequently. */
  setState(name) {
    if (!this._ready) return;
    this._restState = (name === 'sleepy' || name === 'sleeping') ? 'idle' : name;
    this.state.set(name);
    this.notifyActivity();
  }

  getState() { return this._ready ? this.state.state : null; }

  // ---------------------------------------------------------------
  // Temporary reactions
  // ---------------------------------------------------------------

  /**
   * Play a short, self-cleaning reaction. Does not change the
   * persistent state — Harley returns to whatever mood it was in.
   * @param {'success'|'celebrate'|'excited'|'surprise'|'attention'|'error'} name
   */
  react(name) {
    if (!this._ready) return;
    const def = REACTIONS[name];
    if (!def) { console.warn(`[Harley] unknown reaction "${name}"`); return; }

    this._pulse(def.cls, def.ms);
    if (def.lines.length && Math.random() < MICRO_LINE_CHANCE) {
      const line = def.lines[Math.floor(Math.random() * def.lines.length)];
      this.bubble.say(line, { duration: 1600 });
    }
    this.notifyActivity();
  }

  // ---------------------------------------------------------------
  // Speech / thought bubble
  // ---------------------------------------------------------------

  /** Show a short line of text near Harley. Keep it brief. */
  say(text, opts) { this._ready && this.bubble.say(text, opts); }

  /** Show the "…" thinking dots instead of text. */
  thinking(durationMs = 0) { this._ready && this.bubble.thinkingDots(durationMs); }

  hideBubble() { this._ready && this.bubble.hide(); }

  // ---------------------------------------------------------------
  // Sleep / visibility convenience
  // ---------------------------------------------------------------

  sleep() { this.setState('sleeping'); }

  wake() {
    if (!this._ready) return;
    this.notifyActivity();
    this.setState('idle');
  }

  show() {
    if (!this._ready) return;
    this.root.classList.remove('hidden');
    requestAnimationFrame(() => this.root.classList.add('show'));
    this.scheduler.start();
  }

  hide() {
    if (!this._ready) return;
    this.root.classList.remove('show');
    this.scheduler.stop();
    setTimeout(() => this.root.classList.add('hidden'), 260);
  }

  // ---------------------------------------------------------------
  // Low-level helpers (used by the scheduler, safe for app code too)
  // ---------------------------------------------------------------

  /** Nudge gaze by a small px offset; (0,0) recenters. */
  lookAt(x, y) {
    if (!this._ready) return;
    this.root.style.setProperty('--look-x', `${x}px`);
    this.root.style.setProperty('--look-y', `${y}px`);
  }

  /** Reset the inactivity clock — call this if the assistant already
   *  tracks user presence and wants to keep Harley in sync. */
  notifyActivity() { this._lastActivity = Date.now(); }

  _pulse(cls, ms, cb) {
    if (!this.root) return;
    this.root.classList.remove(cls); // restart if already mid-animation
    void this.root.offsetWidth;
    this.root.classList.add(cls);
    setTimeout(() => {
      this.root.classList.remove(cls);
      if (cb) cb();
    }, ms);
  }

  _onVisibilityChange() {
    if (!this._ready) return;
    if (document.hidden) {
      this.root.classList.add('is-paused');
      this.scheduler.stop();
    } else {
      this.root.classList.remove('is-paused');
      this.notifyActivity();
      this.scheduler.start();
    }
  }
}

function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

/** Singleton — matches the old global-style usage (`Harley.react(...)`). */
export const Harley = new HarleyController();

// Also expose on window for non-module <script> consumers / quick console use.
if (typeof window !== 'undefined') window.Harley = Harley;
