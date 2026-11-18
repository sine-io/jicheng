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
