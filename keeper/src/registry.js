export function createRegistry() {
  const tasks = new Set();

  return {
    has: (id) => tasks.has(id),
    add: (id) => tasks.add(id),
    remove: (id) => tasks.delete(id),
  };
}
