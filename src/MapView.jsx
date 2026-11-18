import {useEffect, useRef, useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MapPin, Car, Bus, Bicycle, PersonSimpleWalk, ArrowsOut, Plus, Minus, Crosshair, SpinnerGap} from '@phosphor-icons/react';
import {MODES, colorFor, letter} from './model';
const ICONS = {driving: Car, transit: Bus, cycling: Bicycle, walking: PersonSimpleWalk};
function pin(color, text, origin) {return renderToStaticMarkup(<div className={'pin-visual' + (origin ? ' origin-pin' : '')} style={{color}}><MapPin size={45} weight="fill"/><span>{text}</span></div>);}
export default function MapView({sdk, sdkError, onReady, origin, destinations, results, focusId, onFocus, onMapPick, picking, pickBusy, cancelPicking, fitRevision}) {
  const container = useRef(null), map = useRef(null), overlays = useRef([]), latest = useRef({}), reset = useRef(() => {});
  const [initialized, setInitialized] = useState(false), [mapError, setMapError] = useState('');
  latest.current = {onMapPick, onFocus, picking, onReady};
  useEffect(() => {
    if (!sdk) return;
    let instance;
    try {
      instance = new sdk.Map(container.current, {viewMode: '2D', zoom: 11, center: [117.200, 39.125], resizeEnable: true, scrollWheel: true});
      map.current = instance;
      instance.on('complete', () => latest.current.onReady());
      instance.on('click', event => {if (latest.current.picking) latest.current.onMapPick([event.lnglat.getLng(), event.lnglat.getLat()]);});
      reset.current = () => {if (overlays.current.length) instance.setFitView(overlays.current, false, [60, 90, 70, 70], 16);};
      setInitialized(true);
    } catch {setMapError('地图初始化失败，请刷新页面重试');}
    return () => {overlays.current = []; map.current = null; instance?.destroy();};
  }, [sdk]);
  useEffect(() => {map.current?.setDefaultCursor(picking ? 'crosshair' : 'grab');}, [picking, initialized]);
  useEffect(() => {
    if (!initialized || !map.current || !sdk) return;
    const instance = map.current;
    instance.remove(overlays.current);
    const items = [], focusItems = [];
    destinations.forEach((destination, index) => {
      const color = colorFor(destination), route = results?.[destination.id]?.[destination.mode], focused = !focusId || focusId === destination.id;
      if (origin && route?.status === 'success') for (const path of route.segments) {
        const line = new sdk.Polyline({path, strokeColor: color, strokeWeight: focused ? 6 : 4, strokeOpacity: focused ? 1 : .42, isOutline: true, outlineColor: '#ffffff', borderWeight: 2, lineJoin: 'round', lineCap: 'round', zIndex: focused ? 70 : 60});
        items.push(line);
        if (focusId === destination.id) focusItems.push(line);
      }
      const Icon = ICONS[destination.mode], mode = MODES.find(m => m.id === destination.mode);
      const time = !origin ? '待设置出发地' : !route || route.status === 'pending' ? '查询中…' : route.status === 'success' ? route.minutes + '分钟' : route.status === 'no-route' ? '暂无路线' : '查询失败';
      const marker = new sdk.Marker({position: destination.point, content: pin(color, letter(index), false), offset: new sdk.Pixel(-22, -44), title: destination.name, zIndex: focused ? 120 : 110, bubble: false});
      marker.setLabel({direction: 'right', offset: new sdk.Pixel(5, -15), content: renderToStaticMarkup(<div className="map-label-content"><span className="map-place-name">{destination.name}</span><span className="map-place-time" style={{color}}><Icon size={16} weight="bold"/>{mode.short} {time}</span></div>)});
      marker.on('click', () => {if (!latest.current.picking) latest.current.onFocus(destination.id);});
      items.push(marker);
      if (focusId === destination.id) focusItems.push(marker);
    });
    if (origin) {
      const marker = new sdk.Marker({position: origin.point, content: pin('#15354e', '起', true), offset: new sdk.Pixel(-22, -44), title: origin.name, zIndex: 150});
      marker.setLabel({direction: 'bottom', offset: new sdk.Pixel(0, 6), content: renderToStaticMarkup(<strong className="origin-label">{origin.name}</strong>)});
      items.push(marker);
      if (focusId) focusItems.push(marker);
    }
    overlays.current = items; instance.add(items);
    if (focusItems.length) instance.setFitView(focusItems, false, [60, 90, 70, 70], 16);
  }, [initialized, sdk, origin, destinations, results, focusId]);
  useEffect(() => {if (initialized) reset.current();}, [initialized, fitRevision]);
  const error = sdkError || mapError;
  return <section className={'map-workspace' + (picking ? ' picking' : '')} aria-label="高德路线地图"><div className="map-canvas" ref={container} data-testid="route-map" role="application" aria-label={picking ? '地图选点区域，点击设置地点' : '高德地图，可拖动或使用缩放按钮'}/>{error ? <div className="map-state-message map-load-error" role="alert"><MapPin size={30}/><strong>{error}</strong><button className="secondary-button" onClick={() => location.reload()}>重新加载</button></div> : !initialized ? <div className="map-state-message" role="status"><SpinnerGap size={28} className="spin"/><span>正在加载高德地图…</span></div> : null}{picking && <div className="pick-banner" role="status">{pickBusy ? <SpinnerGap className="spin" size={18}/> : <Crosshair size={18}/>} {pickBusy ? '正在识别地点…' : '点击地图，设置' + (picking.kind === 'origin' ? '出发地' : '目的地')}<button onClick={cancelPicking}>取消选点</button></div>}{initialized && !origin && !destinations.length && !picking && <div className="map-empty-message">先搜索地点，或在地图上选点</div>}<div className="map-controls" aria-label="地图视图控制"><button className="fit-button" title="显示全部地点" aria-label="显示全部地点" disabled={!initialized || (!origin && !destinations.length)} onClick={() => reset.current()}><ArrowsOut size={24}/></button><div className="zoom-controls"><button title="放大地图" aria-label="放大地图" disabled={!initialized} onClick={() => map.current?.zoomIn()}><Plus size={25}/></button><button title="缩小地图" aria-label="缩小地图" disabled={!initialized} onClick={() => map.current?.zoomOut()}><Minus size={25}/></button></div></div></section>;
}
