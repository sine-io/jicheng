// AMap JS SDK coordinates are GCJ-02. Do not invent connections between path segments.
export function coordinates(value) {
  if (!value) return null;
  let lng, lat;
  if (Array.isArray(value)) [lng, lat] = value;
  else if (typeof value === 'string') [lng, lat] = value.split(',');
  else { lng = value.getLng?.() ?? value.lng; lat = value.getLat?.() ?? value.lat; }
  lng = Number(lng); lat = Number(lat);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}
function pathOf(value) {
  const points = typeof value === 'string' ? value.split(';') : value;
  return Array.isArray(points) ? points.map(coordinates).filter(Boolean) : [];
}
function scalar(value) { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
export function placeFromPoi(poi) {
  const point = coordinates(poi.location);
  if (!point) return null;
  const city = scalar(poi.citycode) || scalar(poi.cityname) || scalar(poi.adcode) || scalar(poi.pname);
  return {poiId: scalar(poi.id), name: scalar(poi.name) || '地图选点', point,
    address: [scalar(poi.pname), scalar(poi.cityname), scalar(poi.adname), scalar(poi.address)].filter((v, i, a) => v && a.indexOf(v) === i).join(' '), city};
}
export function routeFailure(status, data) {
  const raw = typeof data === 'string' ? data : data?.info || data?.infocode || data?.message || '';
  const code = String(raw).match(/\b[A-Z][A-Z0-9_]{2,70}\b/)?.[0];
  const messages = {
    INVALID_USER_KEY: '地图 Key 无效，请检查高德配置',
    INVALID_USER_SCODE: '高德安全校验未通过，请检查安全密钥与域名设置',
    USERKEY_PLAT_NOMATCH: 'Key 类型不匹配，需要 Web 端 JS API Key',
    INVALID_USER_DOMAIN: '当前网站域名未获授权，请检查高德域名白名单',
    INVALID_USER_SIGNATURE: '高德签名校验未通过',
    DAILY_QUERY_OVER_LIMIT: '今日高德调用额度已用完',
    USER_DAILY_QUERY_OVER_LIMIT: '今日高德调用额度已用完',
    CUQPS_HAS_EXCEEDED_THE_LIMIT: '查询过于频繁，请稍后重试',
    ACCESS_TOO_FREQUENT: '查询过于频繁，请稍后重试',
    SERVICE_NOT_AVAILABLE: '高德服务暂不可用，请稍后重试',
    TIMEOUT: '查询超时，请重试',
  };
  if (status === 'no_data') return {status: 'no-route', reason: '高德未返回可用路线'};
  return {status: 'error', reason: messages[code] || '高德查询失败，请稍后重试', code};
}
export function normalizeRoute(mode, data) {
  const route = mode === 'transit' ? data?.plans?.[0] : data?.routes?.[0];
  if (!route) return {status: 'no-route', reason: '高德未返回可用路线'};
  const seconds = Number(route.time), distance = Number(route.distance);
  if (route.time == null || route.time === '' || !Number.isFinite(seconds) || seconds < 0 || route.distance == null || route.distance === '' || !Number.isFinite(distance) || distance < 0) {
    return {status: 'error', reason: '高德返回的路线数据不完整，请重试'};
  }
  let pieces;
  if (mode === 'transit') {
    pieces = (route.segments || []).flatMap(segment => {
      const transit = segment.transit || {};
      return transit.path?.length ? [transit.path] : (transit.steps || []).map(step => step.path);
    });
  } else pieces = (mode === 'cycling' ? route.rides || route.steps || [] : route.steps || []).map(step => step.path);
  const segments = pieces.map(pathOf).filter(points => points.length > 1);
  if (!segments.length && distance > 0) return {status: 'error', reason: '高德未返回可绘制的路线，请重试'};
  return {status: 'success', minutes: Math.ceil(seconds / 60), seconds, distance, segments};
}
