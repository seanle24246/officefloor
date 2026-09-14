/* office.webgl.mesh.shelving.js — detailed storage meshes from voxel metadata. */

const BOOKSHELF_SKUS = new Set([
  'sku-8570',
  'sku-8571',
  'sku-8572',
  '8570',
  '8571',
  '8572',
]);

const WIDTH = 1;
const DEPTH = 0.45;
const HEIGHT = 1.75;
const SIDE_W = 0.07;
const CAP_H = 0.08;
const PLINTH_H = 0.07;
const SHELF_H = 0.055;
const INNER_W = WIDTH - SIDE_W * 2;
const CABINET_H = 0.43;
const CABINET_Y = PLINTH_H;
const BACK_Y = CABINET_Y + CABINET_H;
const BACK_H = HEIGHT - CAP_H - BACK_Y;
const SHELF_LEVELS = Object.freeze([0.5, 0.88, 1.26]);
const BOOK_COLORS = Object.freeze([
  Object.freeze(['red', 'foliage-dark', 'blue', 'brass', 'red', 'green']),
  Object.freeze(['foliage-dark', 'red', 'blue', 'wood-light', 'green', 'brass']),
  Object.freeze(['brass', 'green', 'red', 'blue', 'foliage-dark', 'wood-light']),
]);

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function part(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `shelving-part:${name}`;
  return result;
}

function bookRow(ctx, level, colors) {
  const width = 0.72;
  const depth = 0.08;
  const edge = 0.075;
  const books = ctx.greeble(width, depth, colors.length, 'red', edge);
  books.name = 'book-spine-greebles';

  for (let index = 0; index < books.children.length; index += 1) {
    const book = books.children[index];
    const bookWidth = edge * [0.72, 1, 0.82, 1.08, 0.76, 0.94][index];
    const bookHeight = [0.27, 0.3, 0.245, 0.285, 0.255, 0.29][index];
    book.position.set(
      -width / 2 + (index + 0.5) * width / colors.length,
      0,
      0,
    );
    book.scale.set(bookWidth / edge, bookHeight / edge, 1);
    book.traverse((node) => {
      if (node.isMesh) node.material = ctx.material(colors[index]);
    });
  }

  return place(books, WIDTH / 2, level + SHELF_H, DEPTH - 0.075);
}

function buildBookshelf(ctx) {
  const root = ctx.group();
  root.name = 'shelving:bookshelf';

  const leftSide = place(
    ctx.strip(SIDE_W, DEPTH, HEIGHT - CAP_H - PLINTH_H, 'wood-mid'),
    SIDE_W / 2,
    PLINTH_H,
    DEPTH / 2,
  );
  const rightSide = place(
    ctx.strip(SIDE_W, DEPTH, HEIGHT - CAP_H - PLINTH_H, 'wood-mid'),
    WIDTH - SIDE_W / 2,
    PLINTH_H,
    DEPTH / 2,
  );
  const topCap = place(
    ctx.strip(WIDTH, DEPTH, CAP_H, 'wood-light'),
    WIDTH / 2,
    HEIGHT - CAP_H,
    DEPTH / 2,
  );
  const rearBacking = place(
    ctx.strip(INNER_W, 0.035, BACK_H, 'wood-dark'),
    WIDTH / 2,
    BACK_Y,
    0.0175,
  );

  const shelves = SHELF_LEVELS.map((level) => place(
    ctx.strip(INNER_W, DEPTH - 0.05, SHELF_H, 'wood-light'),
    WIDTH / 2,
    level,
    DEPTH / 2,
  ));

  const cabinetFrame = place(
    ctx.tileBox(INNER_W, DEPTH - 0.055, CABINET_H, 'wood-mid'),
    WIDTH / 2,
    CABINET_Y,
    (DEPTH - 0.055) / 2,
  );
  const doorW = (INNER_W - 0.035) / 2;
  const doorH = CABINET_H - 0.075;
  const doorZ = DEPTH - 0.0275;
  const leftDoor = place(
    ctx.strip(doorW, 0.025, doorH, 'wood-light'),
    SIDE_W + doorW / 2,
    CABINET_Y + 0.035,
    doorZ,
  );
  const rightDoor = place(
    ctx.strip(doorW, 0.025, doorH, 'wood-light'),
    WIDTH - SIDE_W - doorW / 2,
    CABINET_Y + 0.035,
    doorZ,
  );
  const handles = ctx.group(
    place(ctx.strip(0.022, 0.022, 0.16, 'brass'), WIDTH / 2 - 0.035, 0.22, DEPTH - 0.006),
    place(ctx.strip(0.022, 0.022, 0.16, 'brass'), WIDTH / 2 + 0.035, 0.22, DEPTH - 0.006),
  );
  const plinth = ctx.group(
    place(ctx.strip(WIDTH - 0.04, DEPTH - 0.02, PLINTH_H, 'wood-dark'), WIDTH / 2, 0, DEPTH / 2),
    place(ctx.contactShadow(WIDTH, DEPTH), WIDTH / 2, 0, DEPTH / 2),
  );

  root.add(
    part(ctx, 'left-side-panel', leftSide),
    part(ctx, 'right-side-panel', rightSide),
    part(ctx, 'top-cap', topCap),
    part(ctx, 'rear-backing', rearBacking),
    part(ctx, 'upper-shelf', shelves[2]),
    part(ctx, 'middle-shelf', shelves[1]),
    part(ctx, 'lower-shelf', shelves[0]),
    part(ctx, 'bottom-cabinet-frame', cabinetFrame),
    part(ctx, 'left-cabinet-door', leftDoor),
    part(ctx, 'right-cabinet-door', rightDoor),
    part(ctx, 'cabinet-handles', handles),
    part(ctx, 'upper-shelf-books', bookRow(ctx, SHELF_LEVELS[2], BOOK_COLORS[0])),
    part(ctx, 'middle-shelf-books', bookRow(ctx, SHELF_LEVELS[1], BOOK_COLORS[1])),
    part(ctx, 'lower-shelf-books', bookRow(ctx, SHELF_LEVELS[0], BOOK_COLORS[2])),
    part(ctx, 'floor-plinth', plinth),
  );

  return root;
}

function build(entry, ctx) {
  if (!BOOKSHELF_SKUS.has(String(entry?.sku))) return null;
  return buildBookshelf(ctx);
}

export function init(reg) {
  reg.registerMesh('shelving', build);
}
