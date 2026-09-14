/* office.outdoor.showroom.data.js — deterministic inventory for the procedural showroom. */

function entries(category, family, rows) {
  return rows.map(([kind, label, extra = {}]) => Object.freeze({
    id: `${family}-${kind}`,
    category,
    family,
    kind,
    label,
    ...extra,
  }));
}

export const SHOWROOM_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'all', label: 'Everything' }),
  Object.freeze({ id: 'ground', label: 'Ground + Roads' }),
  Object.freeze({ id: 'nature', label: 'Plants + Nature' }),
  Object.freeze({ id: 'street', label: 'Street Furniture' }),
  Object.freeze({ id: 'vehicles', label: 'Vehicles' }),
  Object.freeze({ id: 'wildlife', label: 'Wildlife' }),
  Object.freeze({ id: 'avatars', label: 'Avatars' }),
]);

export const OUTDOOR_SHOWROOM_ITEMS = Object.freeze([
  ...entries('ground', 'outdoor', [
    ['grass-tile', 'Grass Tile'], ['dirt-tile', 'Dirt Tile'], ['sand-tile', 'Sand Tile'],
    ['water-tile', 'Water Tile'], ['sidewalk', 'Sidewalk'], ['curb', 'Curb + Road Edge'],
    ['road-straight', 'Straight Road'], ['road-curve', 'Road Corner'],
    ['road-intersection', 'Intersection'], ['crosswalk', 'Crosswalk'],
    ['parking-bay', 'Parking Bay'],
  ]),
  ...entries('nature', 'outdoor', [
    ['oak-tree', 'Oak Tree'], ['pine-tree', 'Pine Tree'], ['birch-tree', 'Birch Tree'],
    ['palm-tree', 'Palm Tree'], ['flowering-tree', 'Flowering Tree'],
    ['shrub', 'Shrub'], ['hedge', 'Hedge'], ['flowers', 'Flower Patch'],
    ['rock-cluster', 'Rock Cluster'], ['stump', 'Tree Stump'], ['fallen-log', 'Fallen Log'],
  ]),
  ...entries('street', 'outdoor', [
    ['park-bench', 'Park Bench'], ['streetlamp', 'Street Lamp'],
    ['fire-hydrant', 'Fire Hydrant'], ['mailbox', 'Mailbox'],
    ['trash-can', 'Trash Can'], ['recycle-bin', 'Recycle Bin'], ['bollard', 'Bollard'],
    ['traffic-cone', 'Traffic Cone'], ['road-barrier', 'Road Barrier'],
    ['bus-stop', 'Bus Stop'], ['street-sign', 'Street Sign'], ['fountain', 'Fountain'],
    ['picnic-table', 'Picnic Table'],
  ]),
  ...entries('vehicles', 'cars', [
    ['sports', 'Sports Car', { vehicle: 'sports' }],
    ['luxsedan', 'Luxury Sedan', { vehicle: 'luxsedan' }],
    ['hatchback', 'Hatchback', { vehicle: 'hatchback' }],
    ['convertible', 'Convertible', { vehicle: 'convertible' }],
    ['pickup', 'Pickup Truck', { vehicle: 'pickup' }],
    ['suv', 'SUV', { vehicle: 'suv' }], ['limo', 'Limousine', { vehicle: 'limo' }],
    ['minivan', 'Minivan', { vehicle: 'minivan' }],
    ['schoolbus', 'School Bus', { vehicle: 'schoolbus' }],
    ['firetruck', 'Fire Truck', { vehicle: 'firetruck' }],
    ['towtruck', 'Tow Truck', { vehicle: 'towtruck' }],
    ['camper', 'Camper', { vehicle: 'camper' }],
    ['muscle', 'Muscle Car', { vehicle: 'muscle' }],
    ['beetle', 'Beetle', { vehicle: 'beetle' }],
    ['jeep', 'Open Jeep', { vehicle: 'jeep' }],
    ['foodtruck', 'Food Truck', { vehicle: 'foodtruck' }],
  ]),
  ...entries('wildlife', 'outdoor', [
    ['squirrel', 'Squirrel'], ['pigeon', 'Pigeon'], ['robin', 'Robin'], ['crow', 'Crow'],
    ['duck', 'Duck'], ['rabbit', 'Rabbit'], ['raccoon', 'Raccoon'], ['fox', 'Fox'],
    ['cat', 'Cat'], ['dog', 'Dog'], ['deer', 'Deer'], ['butterfly', 'Butterfly'],
  ]),
  ...entries('avatars', 'agent', [
    ['ninja', 'Ninja', { variant: 'ninja', lane: 'showroom-ninja' }],
    ['afro', 'Afro', { variant: 'afro', lane: 'showroom-afro' }],
    ['rainbow-hair', 'Rainbow Hair', { variant: 'rainbow-hair', lane: 'showroom-rainbow' }],
    ['furry-suit', 'Furry Suit', { variant: 'furry-suit', lane: 'showroom-furry' }],
    ['vietnamese', 'Vietnamese + Rice Hat', { variant: 'vietnamese', lane: 'showroom-vietnamese' }],
  ]),
]);

export function itemsForCategory(category) {
  return category === 'all'
    ? [...OUTDOOR_SHOWROOM_ITEMS]
    : OUTDOOR_SHOWROOM_ITEMS.filter((item) => item.category === category);
}
