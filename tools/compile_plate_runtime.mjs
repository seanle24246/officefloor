#!/usr/bin/env node
/**
 * Compile verbose engine-scene metadata into the small runtime plate contract.
 *
 * Usage: node tools/compile_plate_runtime.mjs SOURCE.json RUNTIME.json
 *    or: node tools/compile_plate_runtime.mjs --input SOURCE.json --output RUNTIME.json
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeError = (message) => {
  throw new Error(`plate runtime compiler: ${message}`);
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function pointForTile(tile) {
  const point = tile?.coordinates?.grid ?? tile?.grid ?? tile?.tile;
  if (!Array.isArray(point) || point.length !== 2
      || !point.every(Number.isInteger)) {
    runtimeError(`tile ${tile?.id ?? '<unknown>'} has no integer grid coordinate`);
  }
  return point;
}

function tileIdIndex(source) {
  return new Map((source.tiles ?? []).map((tile) => [tile.id, tile]));
}

function requiredGrid(source) {
  const grid = source.grid;
  if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height)
      || grid.width < 1 || grid.height < 1) {
    runtimeError('source grid requires positive integer width and height');
  }
  return grid;
}

function sourceTransform(source) {
  if (source.transform) return clone(source.transform);
  const projection = source.camera_and_projection;
  const forward = projection?.grid_to_screen;
  const inverse = projection?.screen_to_grid;
  if (!forward?.origin_px || !forward?.x_basis_px || !forward?.y_basis_px
      || !inverse?.inverse_matrix_2x2) {
    runtimeError('source has no calibrated grid transform');
  }
  // These values are deliberately selected, never recalculated: calibration is
  // source authority and even harmless rounding would make a plate drift.
  return {
    origin_px: clone(forward.origin_px),
    x_basis_px: clone(forward.x_basis_px),
    y_basis_px: clone(forward.y_basis_px),
    inverse_2x2: clone(inverse.inverse_matrix_2x2),
  };
}

function sourceImage(source) {
  if (Array.isArray(source.image_px) && source.image_px.length === 2) {
    return clone(source.image_px);
  }
  const image = source.source_assets?.clean_render;
  if (!Number.isInteger(image?.width_px) || !Number.isInteger(image?.height_px)) {
    runtimeError('source has no image dimensions');
  }
  return [image.width_px, image.height_px];
}

function sourcePlate(source) {
  if (typeof source.plate === 'string' && source.plate) return source.plate;
  const path = source.source_assets?.clean_render?.path;
  if (typeof path !== 'string' || !path) runtimeError('source has no plate path');
  return path.startsWith('assets/') ? path : `assets/${basename(path)}`;
}

function roomRect(id, label, tiles) {
  if (!tiles.length) return null;
  const points = tiles.map(pointForTile);
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    id,
    label: typeof label === 'string' && label ? label : id,
    x,
    y,
    w: Math.max(...xs) - x + 1,
    h: Math.max(...ys) - y + 1,
  };
}

function sourceRooms(source, byId) {
  if (Array.isArray(source.rooms)) {
    return source.rooms.map((room) => ({
      id: room.id,
      label: room.label ?? room.id,
      x: room.x,
      y: room.y,
      w: room.w,
      h: room.h,
    }));
  }
  const rooms = [];
  for (const id of Object.keys(source.zone_catalog ?? {}).sort()) {
    const zone = source.zone_catalog[id];
    const tiles = (zone.tile_ids ?? []).map((tileId) => {
      const tile = byId.get(tileId);
      if (!tile) runtimeError(`zone ${id} references missing tile ${tileId}`);
      return tile;
    });
    const room = roomRect(zone.id ?? id, zone.label, tiles);
    if (room) rooms.push(room);
  }
  if (!rooms.length) runtimeError('source has no rooms or zone catalog');
  return rooms;
}

function compactBlocked(source, grid) {
  const count = grid.width * grid.height;
  const bits = Buffer.alloc(Math.ceil(count / 8));
  for (const tile of source.tiles ?? []) {
    const [x, y] = pointForTile(tile);
    if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
      runtimeError(`tile ${tile.id ?? '<unknown>'} is outside the grid`);
    }
    const blocked = tile?.spatial?.inside_floor === false
      || tile?.navigation?.walkable === false
      || tile?.occupancy?.blocking === true;
    if (blocked) bits[(y * grid.width + x) >> 3] |= 1 << ((y * grid.width + x) & 7);
  }
  return bits.toString('base64');
}

function pointInside(room, point) {
  return point[0] >= room.x && point[0] < room.x + room.w
    && point[1] >= room.y && point[1] < room.y + room.h;
}

function sourceSpots(source, rooms, byId) {
  if (source.spots && typeof source.spots === 'object') return clone(source.spots);
  const knownRooms = new Map(rooms.map((room) => [room.id, room]));
  const spots = {};
  for (const objectId of Object.keys(source.object_catalog ?? {}).sort()) {
    const object = source.object_catalog[objectId];
    const room = knownRooms.get(object.zone);
    if (!room) continue;
    for (const slot of object.interaction?.slots ?? []) {
      const tile = byId.get(slot.tile_id);
      if (!tile) runtimeError(`interaction ${slot.id ?? objectId} references a missing tile`);
      const point = pointForTile(tile);
      // The runtime contract promises legal stand tiles. Source may describe
      // non-agent objects (for example lights) with slots, so retain only
      // walkable, unblocked anchors inside their declared room.
      if (tile.navigation?.walkable !== false && tile.occupancy?.blocking !== true
          && tile.spatial?.inside_floor !== false && pointInside(room, point)) {
        (spots[room.id] ??= []).push(point);
      }
    }
  }
  for (const id of Object.keys(spots)) {
    const unique = new Map(spots[id].map((point) => [point.join(','), point]));
    spots[id] = [...unique.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  return spots;
}

function validateSpots(spots, rooms, blocked, grid) {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const bits = Buffer.from(blocked, 'base64');
  for (const [roomId, points] of Object.entries(spots)) {
    const room = roomsById.get(roomId);
    if (!room || !Array.isArray(points)) runtimeError(`spots for ${roomId} have no room`);
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)) {
        runtimeError(`spot in ${roomId} is not an integer tile`);
      }
      if (!pointInside(room, point)) runtimeError(`spot ${point} is outside room ${roomId}`);
      const index = point[1] * grid.width + point[0];
      if (point[0] < 0 || point[0] >= grid.width || point[1] < 0 || point[1] >= grid.height
          || (bits[index >> 3] & (1 << (index & 7)))) {
        runtimeError(`spot ${point} is blocked`);
      }
    }
  }
}

function sourceTerrace(source) {
  const terrace = source.terrace ?? source.terrace_transform
    ?? source.camera_and_projection?.terrace;
  if (!terrace) return null;
  return { transform: clone(terrace.transform ?? terrace) };
}

function sourceFingerprint(source) {
  const fingerprint = source.content_fingerprint_sha256
    ?? source.scene?.content_fingerprint_sha256;
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
    runtimeError('source has no SHA-256 content fingerprint');
  }
  return fingerprint;
}

/** Compile parsed verbose metadata; returns the runtime object and stable bytes. */
export function compilePlateRuntime(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    runtimeError('source must be a metadata object');
  }
  const grid = requiredGrid(source);
  const byId = tileIdIndex(source);
  const rooms = sourceRooms(source, byId);
  const blocked = compactBlocked(source, grid);
  const spots = sourceSpots(source, rooms, byId);
  validateSpots(spots, rooms, blocked, grid);
  const runtime = {
    plate: sourcePlate(source),
    image_px: sourceImage(source),
    transform: sourceTransform(source),
    grid: [grid.width, grid.height],
    rooms,
    blocked,
    spots,
    terrace: sourceTerrace(source),
    content_fingerprint_sha256: sourceFingerprint(source),
  };
  const bytes = Buffer.from(`${JSON.stringify(runtime)}\n`, 'utf8');
  if (bytes.length > 50 * 1024) runtimeError(`runtime is ${bytes.length} bytes (limit 51200)`);
  return { runtime, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function compilePlateRuntimeFile(inputPath, outputPath) {
  const source = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = compilePlateRuntime(source);
  await writeFile(outputPath, result.bytes);
  return result;
}

function cliArgs(argv) {
  if (argv.length === 2) return argv;
  if (argv.length === 4 && argv[0] === '--input' && argv[2] === '--output') {
    return [argv[1], argv[3]];
  }
  runtimeError('usage: compile_plate_runtime.mjs SOURCE.json RUNTIME.json');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [inputPath, outputPath] = cliArgs(process.argv.slice(2));
    const result = await compilePlateRuntimeFile(inputPath, outputPath);
    process.stdout.write(`compiled ${outputPath} ${result.bytes.length} bytes ${result.sha256}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
