// Optional hosting gateway only. All product behavior runs in the native Go app.
export default {
  async fetch(request, env) {
    if (!env.GO_APP_ORIGIN || !env.GO_PROXY_TOKEN) {
      return new Response('Go application host is not configured.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
    }
    let target;
    try {
      target = new URL(env.GO_APP_ORIGIN);
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error();
    } catch {return new Response('Invalid Go application host.', {status: 503});}
    const incoming = new URL(request.url);
    // Assign path/search, rather than resolving a user-supplied URL against the host.
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.set('X-Route-Proxy-Token', env.GO_PROXY_TOKEN);
    headers.set('X-Forwarded-Host', incoming.host);
    headers.set('X-Forwarded-Proto', incoming.protocol.slice(0, -1));
    headers.delete('OAI-Sites-Authorization');
    headers.delete('Host');
    try {
      const response = await globalThis.fetch(target.toString(), {method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual'});
      // Application routes return fragments, not backend-origin redirects.
      if (response.status >= 300 && response.status < 400) return new Response('Unexpected application redirect.', {status: 502});
      return response;
    } catch {return new Response('Go application is temporarily unavailable.', {status: 502, headers: {'Cache-Control': 'no-store'}});}
  },
};
