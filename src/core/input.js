const BLOCKED_DEFAULTS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
]);

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
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
      if (!event.repeat) this.pressed.add(event.code);
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

  // Waits for the next key press and hands back its code, for rebinding.
  capture(handler) {
    this.captureNext = handler;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
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
