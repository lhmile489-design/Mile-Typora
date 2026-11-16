// jsdom lays nothing out: give the virtual list a viewport it can measure and
// a ResizeObserver to subscribe to, so component tests see rows.
import { beforeAll } from "vitest";

beforeAll(() => {
  // The token test runs in the node environment, where there is no DOM.
  if (typeof HTMLElement === "undefined") return;

  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 240,
  });
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    return {
      width: 240,
      height: 600,
      top: 0,
      left: 0,
      right: 240,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
});
