import assert from 'node:assert/strict';
import test from 'node:test';
import {queryRoute, searchPlaces, reversePlace} from '../src/amap.js';
const origin = {point: [117.2, 39.1], city: '022'}, destination = {point: [117.21, 39.11], city: '022'};
const path = [origin.point, destination.point];
test('calls all four JS services and supplies the selected origin city for transit', async () => {
  const calls = [];
  const sdk = Object.fromEntries([['Driving', 'driving'], ['Transfer', 'transit'], ['Riding', 'cycling'], ['Walking', 'walking']].map(([name, mode]) => [name, class {
    constructor(options) {this.options = options;}
    search(from, to, callback) {
      calls.push({mode, from, to, options: this.options});
      callback('complete', mode === 'transit' ? {plans: [{time: 600, distance: 1000, segments: [{transit: {path}}]}]} : {routes: [{time: 600, distance: 1000, [mode === 'cycling' ? 'rides' : 'steps']: [{path}]}]});
    }
  }]));
  const results = await Promise.all(['driving', 'transit', 'cycling', 'walking'].map(mode => queryRoute(sdk, origin, destination, mode)));
  assert.ok(results.every(result => result.status === 'success' && result.minutes === 10));
  assert.equal(calls.length, 4); assert.ok(calls.every(call => call.from === origin.point && call.to === destination.point));
  assert.equal(calls.find(call => call.mode === 'transit').options.city, '022');
});
test('cancelled queued jobs never query the stale origin', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  const sdk = {Driving: class {search() {calls++;}}};
  await assert.rejects(queryRoute(sdk, origin, destination, 'driving', controller.signal), {name: 'AbortError'});
  assert.equal(calls, 0);
});
test('real search and reverse geocoding preserve city and coordinates', async () => {
  const sdk = {
    PlaceSearch: class {search(query, callback) {assert.equal(query, '地点'); callback('complete', {poiList: {pois: [{id: 'real-id', name: '地点', location: origin.point, citycode: '022'}]}});}},
    Geocoder: class {getAddress(point, callback) {callback('complete', {regeocode: {formattedAddress: '天津市和平区测试路', addressComponent: {province: '天津市', city: [], citycode: '022'}}});}},
  };
  const [place] = await searchPlaces(sdk, '地点'); assert.deepEqual(place.point, origin.point); assert.equal(place.city, '022');
  const reversed = await reversePlace(sdk, origin.point); assert.equal(reversed.city, '022'); assert.deepEqual(reversed.point, origin.point);
});

test('forwards explicit driving strategies including zero for speed priority', async () => {
  const policies = [];
  const sdk = {Driving: class {
    constructor(options) {policies.push(options.policy);}
    search(from, to, callback) {callback('complete', {routes: [{time: 60, distance: 100, steps: [{path}]}]});}
  }};
  for (const drivingPolicy of [10, 12, 0]) await queryRoute(sdk, origin, destination, 'driving', undefined, {drivingPolicy});
  assert.deepEqual(policies, [10, 12, 0]);
});
test('does not use bicycle routing when electric-bike service is unconfigured', async () => {
  const result = await queryRoute({}, origin, destination, 'electric');
  assert.equal(result.status, 'unconfigured');
});

test('enabled electric-bike lookup uses the server and parses actual v5 duration fields', async () => {
  const {mapCapabilities} = await import('../src/amap.js');
  const originalFetch = globalThis.fetch;
  mapCapabilities.electricBike = true;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^\/api\/maps\/electric-route\?/); assert.equal(options.cache, 'no-store');
    return Response.json({status: '1', route: {paths: [{duration: '1111', distance: '3718', steps: [{polyline: '117.2,39.1;117.21,39.11'}]}]}});
  };
  try {
    const result = await queryRoute({}, origin, destination, 'electric');
    assert.equal(result.status, 'success'); assert.equal(result.minutes, 19); assert.equal(result.distance, 3718);
    assert.equal(result.alternatives.length, 1);
  } finally {globalThis.fetch = originalFetch; mapCapabilities.electricBike = false;}
});
