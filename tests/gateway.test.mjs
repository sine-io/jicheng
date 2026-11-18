import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';

test('missing native host is explicit rather than an emulated application',async()=>{
  const response=await worker.fetch(new Request('https://site.test/'),{});assert.equal(response.status,503);
});
test('gateway uses a fixed HTTPS backend and preserves partial requests',async()=>{
  const previous=globalThis.fetch;let captured;
  globalThis.fetch=async(url,init)=>{captured={url:new URL(url),init};return new Response('<div id="results">go</div>',{headers:{'Content-Type':'text/html','HX-Trigger-After-Swap':'route:updated'}});};
  try {
    const response=await worker.fetch(new Request('https://site.test//other.test/ui/query?x=1',{headers:{'HX-Request':'true','Cookie':'route_session=example','X-Route-Proxy-Token':'attacker','OAI-Sites-Authorization':'private-platform-token'}}),{GO_APP_ORIGIN:'https://native.test',GO_PROXY_TOKEN:'server-secret'});
    assert.equal(captured.url.origin,'https://native.test');assert.equal(captured.url.pathname,'//other.test/ui/query');
    assert.equal(captured.init.headers.get('HX-Request'),'true');assert.equal(captured.init.headers.get('X-Route-Proxy-Token'),'server-secret');assert.equal(captured.init.headers.has('OAI-Sites-Authorization'),false);
    assert.equal(response.headers.get('HX-Trigger-After-Swap'),'route:updated');
  }finally{globalThis.fetch=previous;}
});
