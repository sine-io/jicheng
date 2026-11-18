import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeRoute, placeFromPoi, routeFailure, coordinates} from '../src/route-data.js';
const a = {getLng: () => 117.2, getLat: () => 39.1}, b = [117.21, 39.11];
test('normalizes actual JS SDK paths and rounds seconds upward', () => {
  const route = normalizeRoute('driving', {routes: [{time: 121, distance: 1200, steps: [{path: [a, b]}]}]});
  assert.equal(route.status, 'success'); assert.equal(route.minutes, 3); assert.equal(route.distance, 1200);
  assert.deepEqual(route.segments, [[[117.2, 39.1], b]]);
});
test('uses rides for cycling and preserves disconnected route segments', () => {
  const route = normalizeRoute('cycling', {routes: [{time: 300, distance: 800, rides: [{path: [a, b]}, {path: '117.3,39.2;117.31,39.21'}]}]});
  assert.equal(route.status, 'success'); assert.equal(route.segments.length, 2);
  assert.deepEqual(route.segments[1], [[117.3, 39.2], [117.31, 39.21]]);
});
test('keeps walking and transit paths, taking the first transit plan', () => {
  const route = normalizeRoute('transit', {plans: [{time: 1500, distance: 4500, segments: [{transit: {steps: [{path: [a, b]}]}}, {transit: {path: [[117.22, 39.12], [117.23, 39.13]]}}]}, {time: 2000}]});
  assert.equal(route.minutes, 25); assert.equal(route.segments.length, 2);
});
test('never substitutes estimates or straight lines for missing provider results', () => {
  assert.equal(normalizeRoute('walking', {}).status, 'no-route');
  assert.equal(normalizeRoute('driving', {routes: [{time: 3, distance: 20}]}).status, 'error');
  assert.equal(normalizeRoute('walking', {routes: [{distance: 20, steps: [{path: [a, b]}]}]}).status, 'error');
  assert.equal(routeFailure('no_data').status, 'no-route');
  assert.match(routeFailure('error', 'DAILY_QUERY_OVER_LIMIT').reason, /额度/);
});
test('retains actual POI location and city; rejects unusable search results', () => {
  const place = placeFromPoi({id: 'test-poi', name: '测试地点', location: a, citycode: '022', pname: '天津市', cityname: [], adname: '和平区', address: '测试地址'});
  assert.equal(place.city, '022'); assert.deepEqual(place.point, [117.2, 39.1]);
  assert.equal(place.address, '天津市 和平区 测试地址');
  assert.equal(placeFromPoi({name: 'no location'}), null);
  assert.equal(coordinates([400, 300]), null);
});

test('keeps alternatives in provider order and selects complete route data together', async () => {
  const {selectedRoute} = await import('../src/route-data.js');
  const result = normalizeRoute('driving', {routes: [
    {time: 900, distance: 4000, tolls: 0, steps: [{path: [a, b], road: '甲路'}]},
    {time: 600, distance: 5000, tolls: 5, steps: [{path: [[117.2, 39.1], [117.4, 39.3]], road: '乙路'}]},
  ]});
  assert.equal(result.alternatives.length, 2); assert.equal(result.minutes, 15);
  const selected = selectedRoute(result, 'route-1');
  assert.equal(selected.minutes, 10); assert.equal(selected.distance, 5000); assert.equal(selected.tolls, 5);
  assert.match(selected.summary, /乙路/); assert.deepEqual(selected.segments[0][1], [117.4, 39.3]);
  assert.equal(selected.alternatives, result.alternatives); assert.equal(selectedRoute(selected, 'invalid-id'), selected);
});
test('skips malformed alternatives while retaining other usable plans', () => {
  const result = normalizeRoute('walking', {routes: [{time: 500, distance: 10}, {time: 600, distance: 1200, steps: [{path: [a, b]}]}]});
  assert.equal(result.status, 'success'); assert.equal(result.providerIndex, 1); assert.equal(result.alternatives.length, 1);
});
test('reads electric-bike times and paths from the independent v5 API response', async () => {
  const {electricResult} = await import('../src/route-data.js');
  const result = normalizeRoute('electric', electricResult({route: {paths: [{distance: '3000', cost: {duration: '700'}, steps: [{polyline: '117.2,39.1;117.21,39.11', road_name: '测试路'}]}]}}));
  assert.equal(result.status, 'success'); assert.equal(result.minutes, 12); assert.equal(result.distance, 3000); assert.equal(result.alternatives.length, 1);
});
