/* office.train.showroom.data.js — deterministic modern-train arrival loop. */

export const TRAIN_SHOWROOM_ASSETS = Object.freeze([
  Object.freeze({
    id: 'modern-agent-train',
    sku_id: 'sku-1600',
    family: 'transit',
    kind: 'modern-train',
    footprint: Object.freeze({ w: 15, d: 3 }),
    heightUnits: 3.35,
  }),
  Object.freeze({
    id: 'straight-rail',
    family: 'transit',
    kind: 'rail-segment',
    footprint: Object.freeze({ w: 30, d: 4 }),
    heightUnits: 0.25,
  }),
  Object.freeze({
    id: 'agent-platform',
    sku_id: 'sku-1602',
    family: 'transit',
    kind: 'station-platform',
    footprint: Object.freeze({ w: 18, d: 4 }),
    heightUnits: 2.74,
  }),
]);

export const TRAIN_TIMELINE = Object.freeze({
  duration: 20,
  approachEnd: 4,
  settledEnd: 5,
  doorsOpenEnd: 6,
  unloadingEnd: 10,
  dwellEnd: 12,
  doorsCloseEnd: 13,
  departureEnd: 17,
  startX: -24,
  stopX: 0,
  endX: 24,
});

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smooth(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function between(value, start, end) {
  return clamp01((value - start) / (end - start));
}

export function sampleTrainTimeline(seconds) {
  const t = ((Number(seconds) || 0) % TRAIN_TIMELINE.duration + TRAIN_TIMELINE.duration)
    % TRAIN_TIMELINE.duration;
  const T = TRAIN_TIMELINE;

  if (t < T.approachEnd) {
    return Object.freeze({
      time: t,
      phase: 'Arriving',
      trainX: T.startX + (T.stopX - T.startX) * smooth(t / T.approachEnd),
      doorOpen: 0,
      dropoffProgress: 0,
      agentsVisible: false,
      trainVisible: true,
    });
  }
  if (t < T.settledEnd) {
    return Object.freeze({
      time: t, phase: 'Braking', trainX: T.stopX, doorOpen: 0,
      dropoffProgress: 0, agentsVisible: false, trainVisible: true,
    });
  }
  if (t < T.doorsOpenEnd) {
    return Object.freeze({
      time: t,
      phase: 'Opening doors',
      trainX: T.stopX,
      doorOpen: smooth(between(t, T.settledEnd, T.doorsOpenEnd)),
      dropoffProgress: 0,
      agentsVisible: false,
      trainVisible: true,
    });
  }
  if (t < T.unloadingEnd) {
    return Object.freeze({
      time: t,
      phase: 'Agents disembarking',
      trainX: T.stopX,
      doorOpen: 1,
      dropoffProgress: between(t, T.doorsOpenEnd, T.unloadingEnd),
      agentsVisible: true,
      trainVisible: true,
    });
  }
  if (t < T.dwellEnd) {
    return Object.freeze({
      time: t, phase: 'Drop-off complete', trainX: T.stopX, doorOpen: 1,
      dropoffProgress: 1, agentsVisible: true, trainVisible: true,
    });
  }
  if (t < T.doorsCloseEnd) {
    return Object.freeze({
      time: t,
      phase: 'Closing doors',
      trainX: T.stopX,
      doorOpen: 1 - smooth(between(t, T.dwellEnd, T.doorsCloseEnd)),
      dropoffProgress: 1,
      agentsVisible: true,
      trainVisible: true,
    });
  }
  if (t < T.departureEnd) {
    return Object.freeze({
      time: t,
      phase: 'Departing',
      trainX: T.stopX + (T.endX - T.stopX)
        * smooth(between(t, T.doorsCloseEnd, T.departureEnd)),
      doorOpen: 0,
      dropoffProgress: 1,
      agentsVisible: true,
      trainVisible: true,
    });
  }
  return Object.freeze({
    time: t, phase: 'Next service', trainX: T.startX, doorOpen: 0,
    dropoffProgress: 0, agentsVisible: false, trainVisible: false,
  });
}
