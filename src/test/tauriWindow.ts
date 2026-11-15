// A stand-in for `@tauri-apps/api/window`, installed for every test file by
// setup.ts. Tests drive a close with `requestClose` and read the calls on
// `windowMock`.
import { vi } from "vitest";

type CloseEvent = { preventDefault: () => void };
type CloseHandler = (event: CloseEvent) => void | Promise<void>;

const handlers = new Set<CloseHandler>();

export const windowMock = {
  setTheme: vi.fn(),
  destroy: vi.fn(),
  onCloseRequested: vi.fn(),
};

/** Puts the mock back to a window that works and has no listeners. */
export function resetWindowMock() {
  handlers.clear();
  windowMock.setTheme.mockReset().mockResolvedValue(undefined);
  windowMock.destroy.mockReset().mockResolvedValue(undefined);
  windowMock.onCloseRequested.mockReset().mockImplementation((handler) => {
    handlers.add(handler);
    return Promise.resolve(() => {
      handlers.delete(handler);
    });
  });
}
resetWindowMock();

/** How many close listeners are registered now. */
export const closeListeners = () => handlers.size;

/**
 * Sends a close request to the listeners, as Tauri does, and returns
 * whether any of them prevented it (otherwise the window would be destroyed).
 */
export async function requestClose(): Promise<{ prevented: boolean }> {
  let prevented = false;
  for (const handler of [...handlers]) {
    await handler({
      preventDefault: () => {
        prevented = true;
      },
    });
  }
  return { prevented };
}

export const windowModule = {
  getCurrentWindow: () => windowMock,
};
