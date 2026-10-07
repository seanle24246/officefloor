/* World-space navigation on the Blender-exported, already inflated occupancy grid. */

export function createNavGrid(source) {
  const { width, height, cellSize, origin, walkable } = source || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !Number.isFinite(cellSize) || cellSize <= 0 || !Array.isArray(origin)
    || origin.length !== 2 || !origin.every(Number.isFinite)
    || !walkable || walkable.length !== width * height) {
    throw new Error('Invalid Tokyo navigation grid');
  }
  const cells = Uint8Array.from(walkable, (value) => value ? 1 : 0);
  const valid = (x, z) => x >= 0 && x < width && z >= 0 && z < height;
  const index = (x, z) => z * width + x;
  const isOpen = (x, z) => valid(x, z) && cells[index(x, z)] === 1;
  const center = (x, z) => [origin[0] + (x + 0.5) * cellSize, origin[1] + (z + 0.5) * cellSize];
  const cellAt = (x, z) => {
    const cx = Math.floor((x - origin[0]) / cellSize);
    const cz = Math.floor((z - origin[1]) / cellSize);
    return isOpen(cx, cz) ? [cx, cz] : null;
  };
  const neighbors = (x, z) => {
    const result = [];
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if ((!dx && !dz) || !isOpen(x + dx, z + dz)) continue;
      // Both side cells must be clear to cross a diagonal corner.
      if (dx && dz && (!isOpen(x + dx, z) || !isOpen(x, z + dz))) continue;
      result.push([x + dx, z + dz]);
    }
    return result;
  };
  const components = [];
  const seen = new Uint8Array(cells.length);
  for (let z = 0; z < height; z += 1) for (let x = 0; x < width; x += 1) {
    const start = index(x, z);
    if (!cells[start] || seen[start]) continue;
    const component = [];
    const queue = [[x, z]];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      component.push(current);
      for (const next of neighbors(...current)) {
        const id = index(...next);
        if (!seen[id]) { seen[id] = 1; queue.push(next); }
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);
  const common = components[0] || [];

  function path(start, goal) {
    if (!start || !goal || !isOpen(...start) || !isOpen(...goal)) return null;
    const startId = index(...start);
    const goalId = index(...goal);
    const distance = new Float64Array(cells.length).fill(Infinity);
    const previous = new Int32Array(cells.length).fill(-1);
    const closed = new Uint8Array(cells.length);
    const pending = [{ id: startId, score: 0 }];
    distance[startId] = 0;
    while (pending.length) {
      let best = 0;
      for (let i = 1; i < pending.length; i += 1) if (pending[i].score < pending[best].score) best = i;
      const current = pending.splice(best, 1)[0].id;
      if (closed[current]) continue;
      if (current === goalId) {
        const route = [];
        for (let id = goalId; id !== -1; id = previous[id]) route.push([id % width, Math.floor(id / width)]);
        return route.reverse();
      }
      closed[current] = 1;
      const x = current % width; const z = Math.floor(current / width);
      for (const next of neighbors(x, z)) {
        const id = index(...next);
        if (closed[id]) continue;
        const cost = distance[current] + (next[0] !== x && next[1] !== z ? Math.SQRT2 : 1);
        if (cost >= distance[id]) continue;
        distance[id] = cost; previous[id] = current;
        pending.push({ id, score: cost + Math.hypot(goal[0] - next[0], goal[1] - next[1]) });
      }
    }
    return null;
  }
  return { width, height, cellSize, origin, cells, isOpen, cellAt, center, neighbors, common, path };
}
