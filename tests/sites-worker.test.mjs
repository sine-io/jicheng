import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test('browser config exposes the JS key but never the security code', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/maps/config'), {AMAP_JS_KEY: 'public-test-key', AMAP_JS_SECURITY_CODE: 'private-test-code'});
  assert.deepEqual(await response.json(), {provider: 'amap', jsKey: 'public-test-key', electricBikeEnabled: false});
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('missing map configuration fails explicitly without falling back to HTML', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/maps/config'), {});
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'MAP_NOT_CONFIGURED');
});
test('fixed-upstream proxy overwrites credentials and does not forward cookies or authorization', async () => {
  const {mapApi} = await import('../worker/index.js');
  let outgoing;
  const response = await mapApi(new Request('https://example.test/_AMapService/v3/place/text?keywords=test&key=attacker&jscode=attacker&callback=cb', {headers: {Cookie: 'private-cookie', Authorization: 'Bearer private-token'}}), {AMAP_JS_KEY: 'test-key', AMAP_JS_SECURITY_CODE: 'test-secret'}, async (url, options) => {
    outgoing = {url, options}; return new Response('cb({"status":"1"})', {headers: {'Content-Type': 'application/javascript'}});
  });
  assert.equal(outgoing.url.origin, 'https://restapi.amap.com');
  assert.equal(outgoing.url.searchParams.get('key'), 'test-key');
  assert.equal(outgoing.url.searchParams.get('jscode'), 'test-secret');
  assert.equal(outgoing.url.searchParams.getAll('jscode').length, 1);
  assert.equal(outgoing.url.searchParams.get('callback'), 'cb');
  assert.equal(outgoing.options.redirect, 'manual');
  assert.deepEqual(Object.keys(outgoing.options.headers).sort(), ['Accept', 'Referer']);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal(await response.text(), 'cb({"status":"1"})');
});
test('map proxy rejects arbitrary paths and write requests without making upstream requests', async () => {
  const {mapApi} = await import('../worker/index.js'); let calls = 0;
  const env = {AMAP_JS_KEY: 'key', AMAP_JS_SECURITY_CODE: 'secret'};
  for (const [url, method, status] of [['https://example.test/_AMapService/https://evil.test', 'GET', 404], ['https://example.test/_AMapService/v3/place/text', 'POST', 405]]) {
    const response = await mapApi(new Request(url, {method}), env, () => {calls++;}); assert.equal(response.status, status);
  }
  assert.equal(calls, 0);
});
test('upstream errors never echo a credential-bearing URL', async () => {
  const {mapApi} = await import('../worker/index.js');
  const response = await mapApi(new Request('https://example.test/_AMapService/v3/direction/driving'), {AMAP_JS_KEY: 'key', AMAP_JS_SECURITY_CODE: 'sensitive-test-code'}, () => {throw new Error('https://upstream.test/?jscode=sensitive-test-code');});
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /sensitive-test-code/);
});

test('uses a receiver-safe runtime fetch adapter', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    return Promise.resolve(new Response('{"status":"1"}'));
  };
  try {
    const response = await worker.fetch(new Request('https://example.test/_AMapService/v3/place/text'), {AMAP_JS_KEY: 'key', AMAP_JS_SECURITY_CODE: 'secret'});
    assert.equal(response.status, 200);
  } finally {globalThis.fetch = original;}
});

test('does not follow or expose credential-bearing upstream redirects', async () => {
  const {mapApi} = await import('../worker/index.js');
  const response = await mapApi(new Request('https://example.test/_AMapService/v3/place/text'), {AMAP_JS_KEY: 'key', AMAP_JS_SECURITY_CODE: 'secret'}, async () => new Response(null, {status: 302, headers: {Location: 'https://other.test/?jscode=secret'}}));
  assert.equal(response.status, 502); assert.equal(response.headers.get('location'), null);
  assert.doesNotMatch(await response.text(), /jscode=secret|other.test/);
});

test('accepts SDK JSONP callbacks and rejects executable callback expressions', async () => {
  const {mapApi} = await import('../worker/index.js');
  const env = {AMAP_JS_KEY: 'key', AMAP_JS_SECURITY_CODE: 'secret'};
  let calls = 0;
  const fetcher = async () => {calls++; return new Response('AMap.callback({})', {headers: {'Content-Type': 'application/json'}});};
  const valid = await mapApi(new Request('https://example.test/_AMapService/v3/place/text?callback=AMap.callback'), env, fetcher);
  assert.equal(valid.status, 200); assert.match(valid.headers.get('content-type'), /application\/javascript/);
  const invalid = await mapApi(new Request('https://example.test/_AMapService/v3/place/text?callback=alert(1)'), env, fetcher);
  assert.equal(invalid.status, 400); assert.equal(calls, 1);
});

test('electric-bike config exposes availability only and leaves its Web key on the server', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/maps/config'), {AMAP_JS_KEY: 'js-key', AMAP_JS_SECURITY_CODE: 'secret-code', AMAP_WEB_SERVICE_KEY: 'web-secret'});
  assert.deepEqual(await response.json(), {provider: 'amap', jsKey: 'js-key', electricBikeEnabled: true});
});
test('electric-bike planning uses the separate Web API key and requests actual alternatives', async () => {
  const {mapApi} = await import('../worker/index.js');
  let outgoing;
  const response = await mapApi(new Request('https://example.test/api/maps/electric-route?origin=117.2,39.1&destination=117.3,39.2&key=attacker'), {AMAP_WEB_SERVICE_KEY: 'web-secret'}, async (url, init) => {
    outgoing = {url, init}; return Response.json({status: '1', info: 'OK', route: {paths: []}, ignored_secret: 'web-secret'});
  });
  assert.equal(outgoing.url.origin, 'https://restapi.amap.com'); assert.equal(outgoing.url.pathname, '/v5/direction/electrobike');
  assert.equal(outgoing.url.searchParams.get('key'), 'web-secret'); assert.equal(outgoing.url.searchParams.get('alternative_route'), '3');
  assert.equal(outgoing.url.searchParams.get('show_fields'), 'cost,polyline'); assert.equal(outgoing.init.redirect, 'manual');
  assert.doesNotMatch(await response.text(), /web-secret/);
});
test('electric-bike planning rejects missing configuration and invalid coordinates without upstream requests', async () => {
  const {mapApi} = await import('../worker/index.js'); let calls = 0;
  const request = new Request('https://example.test/api/maps/electric-route?origin=400,300&destination=117.2,39.1');
  assert.equal((await mapApi(request, {}, () => {calls++;})).status, 503);
  assert.equal((await mapApi(request, {AMAP_WEB_SERVICE_KEY: 'key'}, () => {calls++;})).status, 400);
  assert.equal(calls, 0);
});
