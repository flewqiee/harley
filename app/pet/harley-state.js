/**
 * harley-state.js
 * ----------------------------------------------------------------
 * Owns two things:
 *   1. StateMachine    — the single persistent mood Harley is in.
 *   2. BubbleController — the tiny speech/thought bubble.
 *
 * Nothing here knows about timers, randomness, or the assistant.
 * It only knows how to *apply* a state/message to the DOM. Keeping
 * it dumb like this is what makes it safe to unit-test and safe for
 * the scheduler / public API to share without stepping on each other.
 */

/** Persistent moods Harley can rest in between events. */
export const STATES = Object.freeze([
  'idle', 'curious', 'thinking', 'listening', 'responding',
  'happy', 'focused', 'confused', 'sleepy', 'sleeping', 'error',
]);

/** Mouth shapes per state. Anchor point is (60,59) — see harley.html. */
const MOUTHS = {
  idle:       'M60,59 C60,62 56,64 52,63 M60,59 C60,62 64,64 68,63',
  curious:    'M60,59 C60,62 56,64 52,63 M60,59 C60,62 64,64 68,63',
  thinking:   'M54,61 C57,60 63,62 66,60',
  listening:  'M60,59 C60,62 56,64 52,63 M60,59 C60,62 64,64 68,63',
  responding: 'M53,61 C57,64 63,64 67,61',
  happy:      'M52,60 C56,65 64,65 68,60',
  focused:    'M55,61 L65,61',
  confused:   'M52,63 C56,60 64,60 68,63',
  sleepy:     'M55,62 L65,62',
  sleeping:   'M56,61 C58,62 62,62 64,61',
  error:      'M52,64 C56,60 64,60 68,64',
};

const DEFAULT_MOUTH = MOUTHS.idle;

export class StateMachine {
  /** @param {HTMLElement} root — the `#pet` element */
  constructor(root) {
    this.root = root;
    this.mouthEl = root.querySelector('.harley-mouth');
    this.current = 'idle';
  }

  get state() { return this.current; }

  /**
   * Switch Harley's resting mood. Cheap and idempotent — safe to call
   * often (e.g. every assistant lifecycle tick) without visual jank,
   * since it only swaps a data-attribute; the CSS handles the tween.
   */
  set(state) {
    if (!STATES.includes(state)) {
      console.warn(`[Harley] unknown state "${state}", ignoring`);
      return;
    }
    if (state === this.current) return;
    this.current = state;
    this.root.dataset.state = state;
    if (this.mouthEl) {
      this.mouthEl.setAttribute('d', MOUTHS[state] || DEFAULT_MOUTH);
    }
  }
}

export class BubbleController {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.el = root.querySelector('#pet-bubble') || root.querySelector('.pet-bubble');
    this.textEl = this.el?.querySelector('.pet-bubble__text');
    this._hideTimer = null;
  }

  /**
   * Show a short line of text for `duration` ms, then fade out.
   * Calling again while visible simply replaces the text/timer —
   * there is never more than one bubble queued.
   */
  say(text, { duration = 2200, thinking = false } = {}) {
    if (!this.el) return;
    clearTimeout(this._hideTimer);
    this.el.classList.toggle('is-thinking', thinking);
    if (this.textEl) this.textEl.textContent = text || '';
    this.el.classList.remove('hidden');
    // force reflow so the show transition replays even if already visible
    void this.el.offsetWidth;
    this.el.classList.add('show');
    if (duration > 0) {
      this._hideTimer = setTimeout(() => this.hide(), duration);
    }
  }

  thinkingDots(duration = 0) {
    this.say('', { duration, thinking: true });
  }

  hide() {
    if (!this.el) return;
    clearTimeout(this._hideTimer);
    this.el.classList.remove('show');
    setTimeout(() => this.el.classList.add('hidden'), 220);
  }
}
