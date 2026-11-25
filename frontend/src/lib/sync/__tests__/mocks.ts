import { jest } from "@jest/globals";

const mockFetch = jest.fn();
global.fetch = mockFetch;

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  raw(): Map<string, string> {
    return this.store;
  }
}

export { MemoryStorage };
test.skip('mock file', () => {});
