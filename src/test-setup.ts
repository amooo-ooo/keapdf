import 'tailwind-variants';

/**
 * Global test environment setup for Bun test runner.
 * Provides fallback implementations for Svelte 5 compile-time runes
 * when testing non-compiled TS modules directly.
 */

if (typeof (globalThis as any).$state === 'undefined') {
  const stateFn = <T>(val: T): T => val;
  stateFn.snapshot = <T>(val: T): T => val;
  (globalThis as any).$state = stateFn;
} else if (typeof (globalThis as any).$state.snapshot === 'undefined') {
  (globalThis as any).$state.snapshot = <T>(val: T): T => val;
}

if (typeof (globalThis as any).$derived === 'undefined') {
  const derived = <T>(fn: () => T): { readonly current: T } => ({
    get current() {
      return typeof fn === 'function' ? (fn as () => T)() : fn;
    },
  });
  (derived as any).by = <T>(fn: () => T): T => {
    return new Proxy({} as any, {
      get(_target, prop) {
        const res = (fn as () => any)();
        const val = res[prop];
        if (typeof val === 'function') {
          return val.bind(res);
        }
        return val;
      },
    });
  };
  (globalThis as any).$derived = derived;
}

if (typeof (globalThis as any).$effect === 'undefined') {
  (globalThis as any).$effect = (_fn: () => void | (() => void)) => {
    // No-op in test runner
  };
}




if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    head: {
      appendChild: () => {},
      removeChild: () => {},
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    createElement(tag: string) {
      if (tag === 'canvas') {
        return {
          width: 800,
          height: 600,
          getContext() {
            return {
              scale() {},
              translate() {},
              clearRect() {},
              beginPath() {},
              arc() {},
              moveTo() {},
              lineTo() {},
              quadraticCurveTo() {},
              stroke() {},
              fill() {},
              fillText() {},
              measureText(text: string) {
                return {
                  width: text.length * 20,
                  actualBoundingBoxAscent: 30,
                  actualBoundingBoxDescent: 10,
                };
              },
              createImageData(w: number, h: number) {
                return {
                  width: w,
                  height: h,
                  data: new Uint8ClampedArray(w * h * 4),
                };
              },
              getImageData(_x: number, _y: number, w: number, h: number) {
                return {
                  width: w,
                  height: h,
                  data: new Uint8ClampedArray(w * h * 4),
                };
              },
              putImageData() {},
              drawImage() {},
            };
          },
          toDataURL() {
            return 'data:image/png;base64,mockPngDataUrl';
          },
        };
      }
      return {};
    },
    fonts: {
      load: () => Promise.resolve([]),
    },
  };
}

if (typeof (globalThis as any).window === 'undefined') {
  const listeners = new Map<string, Set<(e: any) => void>>();
  (globalThis as any).window = {
    addEventListener(type: string, listener: (e: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (e: any) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: any): boolean {
      const set = listeners.get(event.type);
      if (set) {
        for (const l of set) l(event);
      }
      return true;
    },
  };
}

if (typeof (globalThis as any).KeyboardEvent === 'undefined') {
  (globalThis as any).KeyboardEvent = class KeyboardEvent {
    type: string;
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    bubbles: boolean;
    defaultPrevented = false;

    constructor(type: string, init?: any) {
      this.type = type;
      this.key = init?.key ?? '';
      this.ctrlKey = init?.ctrlKey ?? false;
      this.metaKey = init?.metaKey ?? false;
      this.altKey = init?.altKey ?? false;
      this.shiftKey = init?.shiftKey ?? false;
      this.bubbles = init?.bubbles ?? false;
    }

    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

