import {coordinates, normalizeRoute, placeFromPoi, routeFailure} from './route-data.js';
let sdkPromise;
export function loadAMap() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    let response, config;
    try {
      response = await fetch('/api/maps/config', {cache: 'no-store'});
      if (!response.ok) throw new Error();
      config = await response.json();
    } catch {throw new Error('地图服务连接失败，请稍后刷新重试');}
    if (!config.jsKey) throw new Error('地图服务配置不完整');
    window._AMapSecurityConfig = {serviceHost: location.origin + '/_AMapService'};
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const callback = '__routeWorkbenchAMapReady';
      const timer = setTimeout(() => finish(new Error('高德地图加载超时，请检查网络后刷新')), 22000);
      function finish(error) {
        clearTimeout(timer); delete window[callback];
        if (error) {script.remove(); reject(error);} else resolve(window.AMap);
      }
      window[callback] = () => window.AMap?.Map ? finish() : finish(new Error('高德地图加载失败'));
      script.onerror = () => finish(new Error('无法加载高德地图，请检查网络后刷新'));
      script.async = true;
      const params = new URLSearchParams({v: '2.0', key: config.jsKey, callback,
        plugin: 'AMap.PlaceSearch,AMap.Geocoder,AMap.Driving,AMap.Transfer,AMap.Riding,AMap.Walking'});
      script.src = 'https://webapi.amap.com/maps?' + params;
      document.head.appendChild(script);
    });
  })().catch(error => {sdkPromise = null; throw error;});
  return sdkPromise;
}

const pending = [];
let running = 0, lastStarted = 0, wake;
function pump() {
  clearTimeout(wake);
  while (pending.length && pending[0].signal?.aborted) pending.shift().reject(new DOMException('Cancelled', 'AbortError'));
  if (!pending.length || running >= 2) return;
  const delay = Math.max(0, 420 - (Date.now() - lastStarted));
  if (delay) {wake = setTimeout(pump, delay); return;}
  const job = pending.shift(); running++; lastStarted = Date.now();
  Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {running--; pump();});
  pump();
}
function scheduled(task, signal) {return new Promise((resolve, reject) => {pending.push({task, signal, resolve, reject}); pump();});}
function sdkCall(invoke) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => finish('error', {info: 'TIMEOUT'}), 20000);
    function finish(status, data) {if (done) return; done = true; clearTimeout(timer); resolve({status, data});}
    try {invoke(finish);} catch {finish('error', {info: 'SERVICE_NOT_AVAILABLE'});}
  });
}
export async function searchPlaces(AMap, query, city, signal) {
  const result = await scheduled(() => sdkCall(callback => {
    const search = new AMap.PlaceSearch({city: city || '全国', citylimit: false, pageSize: 8, extensions: 'all'});
    search.search(query.trim(), callback);
  }), signal);
  if (result.status === 'no_data') return [];
  if (result.status !== 'complete') throw new Error(routeFailure(result.status, result.data).reason);
  return (result.data.poiList?.pois || []).map(placeFromPoi).filter(Boolean);
}
export async function reversePlace(AMap, point, signal) {
  const result = await scheduled(() => sdkCall(callback => new AMap.Geocoder({extensions: 'base'}).getAddress(point, callback)), signal);
  if (result.status !== 'complete' || !result.data?.regeocode) throw new Error(routeFailure(result.status, result.data).reason);
  const data = result.data.regeocode, component = data.addressComponent || {};
  const city = component.citycode || (typeof component.city === 'string' ? component.city : '') || component.province || component.adcode;
  return {name: data.formattedAddress || '地图选点', point: coordinates(point), address: data.formattedAddress || '地图选点', city};
}
export async function queryRoute(AMap, origin, destination, mode, signal) {
  if (origin.point.every((v, i) => Math.abs(v - destination.point[i]) < 1e-7)) return {status: 'success', minutes: 0, seconds: 0, distance: 0, segments: []};
  if (mode === 'transit' && (!origin.city || !destination.city)) return {status: 'error', reason: '地点缺少城市信息，请重新搜索或选点'};
  const result = await scheduled(() => sdkCall(callback => {
    let service;
    if (mode === 'driving') service = new AMap.Driving({extensions: 'all'});
    else if (mode === 'transit') service = new AMap.Transfer({city: origin.city, cityd: destination.city, extensions: 'all'});
    else if (mode === 'cycling') service = new AMap.Riding();
    else service = new AMap.Walking();
    service.search(origin.point, destination.point, callback);
  }), signal);
  return result.status === 'complete' ? normalizeRoute(mode, result.data) : routeFailure(result.status, result.data);
}
