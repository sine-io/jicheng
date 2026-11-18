import {useEffect,useRef} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {MapPin,Car,Bus,Bicycle,PersonSimpleWalk,ArrowsOut,Plus,Minus,Crosshair} from '@phosphor-icons/react';
import {MAP_SIZE,MODES,colorFor,letter} from './model';
const ICONS={driving:Car,transit:Bus,cycling:Bicycle,walking:PersonSimpleWalk};
const ll=p=>[MAP_SIZE[1]-p[1],p[0]];
function pinIcon(color,text,origin){return L.divIcon({className:'place-marker',html:renderToStaticMarkup(<div className={'pin-visual'+(origin?' origin-pin':'')} style={{color}}><MapPin size={45} weight="fill"/><span>{text}</span></div>),iconSize:[45,49],iconAnchor:[22.5,44]});}
export default function MapView({origin,destinations,results,loading,focusId,onFocus,onMapPick,picking,cancelPicking,fitRevision}){
 const container=useRef(null),map=useRef(null),layers=useRef(null),callback=useRef(onMapPick),focusCallback=useRef(onFocus),currentPicking=useRef(picking),reset=useRef(()=>{});
 callback.current=onMapPick;focusCallback.current=onFocus;currentPicking.current=picking;
 useEffect(()=>{const instance=L.map(container.current,{crs:L.CRS.Simple,preferCanvas:true,zoomControl:false,attributionControl:false,minZoom:-3,maxZoom:3,zoomSnap:.1,zoomDelta:.5,scrollWheelZoom:false,doubleClickZoom:false,maxBounds:[[-170,-400],[MAP_SIZE[1]+170,MAP_SIZE[0]+400]],maxBoundsViscosity:.8});map.current=instance;
 L.imageOverlay('/assets/city-map.png',[[0,0],[MAP_SIZE[1],MAP_SIZE[0]]],{interactive:false}).addTo(instance);layers.current=L.layerGroup().addTo(instance);
 reset.current=()=>{const size=instance.getSize(),zoom=Math.log2(Math.max(size.x/MAP_SIZE[0],size.y/MAP_SIZE[1]));instance.setMinZoom(zoom-.4);instance.setMaxZoom(zoom+2.5);instance.setView([MAP_SIZE[1]*.49,MAP_SIZE[0]*.5],zoom,{animate:false});};reset.current();
 instance.on('click',event=>{if(!currentPicking.current)return;callback.current([Math.round(Math.max(60,Math.min(MAP_SIZE[0]-60,event.latlng.lng))),Math.round(Math.max(60,Math.min(MAP_SIZE[1]-60,MAP_SIZE[1]-event.latlng.lat)))]);});
 const observer=new ResizeObserver(()=>{instance.invalidateSize({animate:false});reset.current();});observer.observe(container.current);
 return()=>{observer.disconnect();instance.remove();map.current=null;};},[]);
 useEffect(()=>{reset.current();},[fitRevision,origin?.id]);
 useEffect(()=>{if(!map.current||!layers.current)return;layers.current.clearLayers();
 destinations.forEach((d,index)=>{const color=colorFor(d),route=results?.[d.id]?.[d.mode];
 if(origin&&!loading&&route?.supported&&route.path.length>1){const coords=route.path.map(ll),focused=!focusId||d.id===focusId;L.polyline(coords,{color:'#fff',weight:focused?10:8,opacity:focused?.98:.75,lineCap:'round',lineJoin:'round',smoothFactor:.4}).addTo(layers.current);L.polyline(coords,{color,weight:focused?5:4,opacity:focused?1:.47,lineCap:'round',lineJoin:'round',smoothFactor:.4}).addTo(layers.current);}
 const Icon=ICONS[d.mode],mode=MODES.find(m=>m.id===d.mode),time=loading?'查询中…':route?.supported?route.minutes+'分钟':route?'暂不支持':'待查询';
 const html=renderToStaticMarkup(<div className="map-label-content"><span className="map-place-name"><b>{letter(index)}</b> {d.name}</span><span className="map-place-time" style={{color}}><Icon size={16} weight="bold"/>{mode.short} {time}</span></div>);
 const marker=L.marker(ll(d.point),{icon:pinIcon(color,'',false),title:d.name,keyboard:true}).addTo(layers.current);marker.bindTooltip(html,{permanent:true,direction:'right',offset:[19,-26],className:'route-tooltip'});marker.on('click',()=>{if(!currentPicking.current)focusCallback.current(d.id);});});
 if(origin){const marker=L.marker(ll(origin.point),{icon:pinIcon('#15354e','起',true),title:origin.name,zIndexOffset:1000}).addTo(layers.current);marker.bindTooltip(renderToStaticMarkup(<strong className="origin-label">{origin.name}</strong>),{permanent:true,direction:'bottom',offset:[0,9],className:'route-tooltip origin-tooltip'});}
 },[origin,destinations,results,loading,focusId]);
 return <section className={'map-workspace'+(picking?' picking':'')} aria-label="路线地图"><div className="map-canvas" ref={container} data-testid="route-map" role="application" aria-label={picking?'地图选点区域，点击设置地点':'示意路线地图，可拖动或使用缩放按钮'}/>{picking&&<div className="pick-banner" role="status"><Crosshair size={18}/>点击地图，设置{picking.kind==='origin'?'出发地':'目的地'}<button onClick={cancelPicking}>取消选点</button></div>}{!origin&&!picking&&<div className="map-empty-message">添加出发地，开始查看路线</div>}<div className="map-controls" aria-label="地图视图控制"><button className="fit-button" title="显示全部地点" aria-label="显示全部地点" onClick={()=>reset.current()}><ArrowsOut size={24}/></button><div className="zoom-controls"><button title="放大地图" aria-label="放大地图" onClick={()=>map.current?.zoomIn()}><Plus size={25}/></button><button title="缩小地图" aria-label="缩小地图" onClick={()=>map.current?.zoomOut()}><Minus size={25}/></button></div></div><span className="map-attribution">示意地图</span></section>;
}
