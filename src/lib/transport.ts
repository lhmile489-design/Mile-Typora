// The only module that imports the generated client src/mygo.ts
// (CLAUDE.md §5.8). Components receive a Transport, so tests and design-time
// mocks can supply their own.
import { isCallError } from "mygo-runtime";
import { WindowService, type ReadyInfo } from "../mygo";

export type { ReadyInfo };

/** The result of a call: its value, or a message for a failure. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

export interface Transport {
  ready(): Promise<Outcome<ReadyInfo>>;
  /** Opens another window; resolves once the app has created it. */
  newWindow(): Promise<Outcome<void>>;
}

/** wrap turns a rejected call into an Outcome, so callers never see a throw. */
export async function wrap<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (err) {
    if (isCallError(err)) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export const mygoTransport: Transport = {
  ready: () => wrap(() => WindowService.ready()),
  newWindow: () =>
    wrap(async () => {
      const result = await WindowService.newWindow();
      // Expected failures arrive in the result, not as a CallError (§1).
      if (result.failure) throw new Error(result.failure.detail);
    }),
};
