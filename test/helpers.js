// Stand-ins for the few browser APIs the renderer and controller touch, so the
// tests run in plain Node with no DOM.

export function mockCanvas() {
  const listeners = [];
  const context = new Proxy(
    {},
    {
      get: (target, name) => (name in target ? target[name] : () => {}),
      set: (target, name, value) => ((target[name] = value), true),
    },
  );
  return {
    style: {},
    listeners, // [{ type, handler }] currently attached
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener: (type, handler) => listeners.push({ type, handler }),
    removeEventListener: (type, handler) => {
      const i = listeners.findIndex((l) => l.type === type && l.handler === handler);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
}

// A controllable requestAnimationFrame. Frames only run when the test calls runFrame()
export function installFakeAnimationFrame() {
  const pending = new Map();
  let nextId = 1;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(nextId, callback);
    return nextId++;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  return {
    pendingCount: () => pending.size,
    runFrame() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

installFakeAnimationFrame(); // so `window` exists for anything imported by a test
