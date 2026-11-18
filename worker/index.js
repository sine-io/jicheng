const SERVICE_PREFIX = '/_AMapService';
const SERVICE_PATH = /^\/(?:v3|v4|v5)\/(?:place\/(?:text|detail|around)|geocode\/(?:geo|regeo)|direction\/(?:driving|walking|bicycling|riding|transit\/integrated))$/;
function json(data, status = 200) {
  return Response.json(data, {status, headers: {'Cache-Control': 'private, no-store'}});
}
export async function mapApi(request, env, upstreamFetch = (input, init) => globalThis.fetch(input, init)) {
  const url = new URL(request.url);
  const config = url.pathname === '/api/maps/config';
  if (!config && url.pathname !== SERVICE_PREFIX && !url.pathname.startsWith(SERVICE_PREFIX + '/')) return null;
  if (request.method !== 'GET') return json({error: 'METHOD_NOT_ALLOWED'}, 405);
  if (!env.AMAP_JS_KEY || !env.AMAP_JS_SECURITY_CODE) return json({error: 'MAP_NOT_CONFIGURED', message: '地图服务尚未完成配置'}, 503);
  if (config) return json({provider: 'amap', jsKey: env.AMAP_JS_KEY});
  const pathname = url.pathname.slice(SERVICE_PREFIX.length);
  const styles = pathname === '/v4/map/styles';
  if (!styles && !SERVICE_PATH.test(pathname)) return json({error: 'UNSUPPORTED_MAP_ENDPOINT'}, 404);
  if (url.search.length > 16000) return json({error: 'QUERY_TOO_LONG'}, 414);
  const upstream = new URL(pathname, styles ? 'https://webapi.amap.com' : 'https://restapi.amap.com');
  upstream.search = url.search;
  // Bind requests to this Site's configured JS key, ignoring client credentials.
  upstream.searchParams.set('key', env.AMAP_JS_KEY);
  upstream.searchParams.set('jscode', env.AMAP_JS_SECURITY_CODE);
  try {
    const response = await upstreamFetch(upstream, {method: 'GET', redirect: 'error',
      headers: {Accept: '*/*', Referer: url.origin + '/'}, signal: AbortSignal.timeout(18000)});
    return new Response(response.body, {status: response.status, headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    }});
  } catch (error) {
    // Never log or echo the upstream URL: it contains the server-side jscode.
    const message = String(error?.message || '');
    const category = /Illegal invocation|incorrect this/.test(message) ? 'RUNTIME_BINDING'
      : /not a function/.test(message) ? 'RUNTIME_API'
      : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT'
      : /DNS|hostname|resolve/i.test(message) ? 'DNS'
      : /fetch|network|connect/i.test(message) ? 'CONNECTION' : 'UPSTREAM';
    console.error('MAP_PROXY_FAILURE', category);
    return json({error: 'MAP_UPSTREAM_UNAVAILABLE', info: 'SERVICE_NOT_AVAILABLE', category}, 502);
  }
}
export default {
  async fetch(request, env) {
    const apiResponse = await mapApi(request, env);
    if (apiResponse) return apiResponse;
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
