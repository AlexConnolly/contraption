const BLOCKED_DEFAULTS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace',
]);

// Shortcuts the browser also wants. Ctrl-D bookmarks the page and Ctrl-S saves
// it, both of which land a dialog on top of the game and neither of which is
// what somebody copying a selection meant.
const BLOCKED_WITH_CONTROL = new Set(['KeyD', 'KeyS', 'KeyZ', 'KeyY']);

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    // Which modifiers were held at the moment each key went down.
    //
    // Asking the key map at frame time instead gets this wrong whenever the
    // modifier is let go before the next frame runs, which is a tap on a busy
    // machine and every press on a background tab. The answer belongs to the
    // event, so it is recorded when the event arrives.
    this.mods = new Map();
    this.captureNext = null;
    this.enabled = true;

    this.onKeyDown = (event) => {
      if (this.captureNext) {
        event.preventDefault();
        const handler = this.captureNext;
        this.captureNext = null;
        handler(event.code);
        return;
      }
      if (isTyping(event.target)) return;
      if (BLOCKED_DEFAULTS.has(event.code)) event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && BLOCKED_WITH_CONTROL.has(event.code)) {
        event.preventDefault();
      }
      if (!event.repeat) {
        this.pressed.add(event.code);
        this.mods.set(event.code, {
          ctrl: event.ctrlKey || event.metaKey,
          shift: event.shiftKey,
          alt: event.altKey,
        });
      }
      this.down.add(event.code);
    };

    this.onKeyUp = (event) => {
      this.down.delete(event.code);
      this.released.add(event.code);
    };

    this.onBlur = () => {
      this.down.clear();
    };

    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  isDown(code) {
    return this.enabled && this.down.has(code);
  }

  wasPressed(code) {
    return this.enabled && this.pressed.has(code);
  }

  /**
   * Whether a key was pressed with a modifier held at the time.
   *
   * `wasPressed('KeyD') && isDown('ControlLeft')` reads the modifier a frame
   * or more after the event, by which point a quick Ctrl-D has already let go
   * of the Ctrl and the shortcut silently does nothing.
   */
  wasPressedWith(code, mod) {
    if (!this.enabled || !this.pressed.has(code)) return false;
    return Boolean(this.mods.get(code)?.[mod]);
  }

  /** Whether a key was pressed on its own, with none of the modifiers down. */
  wasPressedPlain(code) {
    if (!this.enabled || !this.pressed.has(code)) return false;
    const held = this.mods.get(code);
    return !held || (!held.ctrl && !held.alt);
  }

  // Waits for the next key press and hands back its code, for rebinding.
  capture(handler) {
    this.captureNext = handler;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mods.clear();
  }

  dispose(target = window) {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }
}

function isTyping(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
}
