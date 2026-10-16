// Placement points confirmed by scorekeepers; lobby creation limits are separate.
const ffa8 = Object.freeze([9, 8, 7, 5, 4, 3, 2, 1]);
const ffa4 = Object.freeze([5, 3, 2, 1]);
const linear4 = Object.freeze([4, 3, 2, 1]);
const linear6 = Object.freeze([6, 5, 4, 3, 2, 1]);
const linear8 = Object.freeze([8, 7, 6, 5, 4, 3, 2, 1]);
const race4v4 = Object.freeze([10, 8, 6, 5, 4, 3, 2, 1]);
const ffaByCount = Object.freeze({
  4: ffa4,
  5: Object.freeze([6, 5, 3, 2, 1]),
  6: Object.freeze([7, 6, 5, 3, 2, 1]),
  7: Object.freeze([8, 7, 6, 4, 3, 2, 1]),
  8: ffa8,
});
const duosByCount = Object.freeze({ 4: linear4, 6: linear6, 8: linear8 });

const racePoints = Object.freeze({
  race_ffa: ffa8,
  race_duos: linear8,
  race_3v3: linear6,
  race_4v4: race4v4,
  race_itemless_ffa: ffa4,
  race_itemless_duos: linear8,
  race_itemless_3v3: linear6,
  race_itemless_4v4: race4v4,
  insta_duos: linear8,
  insta_3v3: linear6,
  insta_4v4: race4v4,
  battle_ffa: ffa4,
  battle_duos: linear4,
  battle_3v3: linear6,
  battle_4v4: linear8,
});

function pointsFor(type, count) {
  if (!Object.prototype.hasOwnProperty.call(racePoints, type)) return null;
  const defaults = racePoints[type];
  const size = count === undefined ? defaults.length : count;
  if (!Number.isInteger(size)) return null;
  if (type.endsWith('_ffa')) return ffaByCount[size] || null;
  if (type.endsWith('_duos')) return duosByCount[size] || null;
  return size === defaults.length ? defaults : null;
}

module.exports = { pointsFor };
