(() => {
  'use strict';
  const colors = ['#1680ff', '#ff8914', '#29b538', '#9867d8', '#e05c83', '#0a9f99', '#a47529', '#4668d2'];
  const modes = {driving:'驾车', transit:'公交', cycling:'自行车', electric:'电动车', walking:'步行'};
  const transitColors = {walk:'#485767', metro:'#2a6ec4', bus:'#217e62', rail:'#2a6ec4'};
  let map, sdk, overlays = [], currentState, pendingRefresh, requestVersion = 0, lastFit = '', mapRequest, pickBusy = false, panelCollapsed = false, toastTimer;
  let activeLeg, panelKey;
  let sdkKey, configRequest;
  let locationMarker, locationNotice;
  const meta = () => Object.fromEntries(new FormData(document.getElementById('workspace-meta')));
  const selected = result => result?.alternatives?.find(route => route.id === result.selectedId) || result?.alternatives?.[0];
  function action(name, values = {}) {
    return htmx.ajax('POST', '/ui/' + name, {target:'#updates', swap:'innerHTML', values:{...meta(), ...values}});
  }
  function requestJSON(url, callback) {
    const request = new XMLHttpRequest(); request.open('GET', url); request.timeout = 25000;
    request.onload = () => {
      let data; try {data = JSON.parse(request.responseText);} catch {callback(new Error('服务返回数据异常')); return;}
      if (request.status < 200 || request.status >= 300) {callback(new Error(request.status === 403 ? '页面会话已过期，请刷新后重试' : '服务连接失败，请稍后重试', {cause:data?.error})); return;}
      callback(null, data);
    };
    request.onerror = request.ontimeout = () => callback(new Error('网络连接失败，请稍后重试'));
    request.send(); return request;
  }
  function notify(message, action) {
    const node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role','status');
    const text = document.createElement('span'); text.textContent = message;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => node.remove();
    node.append(text);
    if (action) node.append(action);
    node.append(close); document.getElementById('notice').replaceChildren(node);
    return node;
  }
  function mapFailure(message, unconfigured = false) {
    document.getElementById('map-status').textContent = unconfigured ? '未配置' : '连接失败';
    const loading = document.getElementById('map-loading'); loading.hidden = false; loading.replaceChildren();
    const text = document.createElement('strong'); text.textContent = message;
    const button = document.createElement('button'); button.type='button'; button.className='secondary-button';
    if (unconfigured) {button.textContent='配置高德地图'; button.setAttribute('data-open-map-settings','');}
    else {button.textContent='重新加载'; button.setAttribute('data-reload-map','');}
    loading.append(text, button);
  }
  function refreshMap() {
    clearTimeout(pendingRefresh);
    pendingRefresh = setTimeout(() => {
      const version = ++requestVersion;
      mapRequest?.abort();
      mapRequest = requestJSON('/api/map-state?workspace=' + encodeURIComponent(meta().workspace), (error, data) => {
        if (version !== requestVersion) return;
        if (error) {notify(error.message); return;}
        currentState = data; draw();
      });
    }, 45);
  }
  function pin(color, text, extra = '') {
    const node = document.createElement('div'); node.className = 'native-pin ' + extra;
    node.style.setProperty('--pin-color', color); node.textContent = text; return node;
  }
  function fitPadding() {
    const panel = document.getElementById('route-sidebar'), dock = document.querySelector('.search-dock');
    const bottom = Math.min(dock.getBoundingClientRect().height + 70, innerHeight * .48);
    const mobile = innerWidth <= 760;
    const top = mobile && !panel.hidden ? Math.min(panel.getBoundingClientRect().bottom + 18, innerHeight - bottom - 150) : 100;
    // AMap expects top, bottom, left, right, rather than CSS inset order.
    return [Math.max(75, top), bottom, !mobile && !panel.hidden ? panel.getBoundingClientRect().right + 40 : 45, mobile ? 115 : 220];
  }
  function syncUI() {
    const count = Number(document.querySelector('[data-place-count]')?.dataset.placeCount || 0);
    const searching = document.querySelector('[data-search-open]')?.dataset.searchOpen === 'true';
    const panel = document.getElementById('route-sidebar'), toggle = document.getElementById('panel-toggle');
    panel.hidden = !count || panelCollapsed || (innerWidth <= 760 && searching);
    toggle.hidden = !count || !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    document.getElementById('place-count').textContent = count + ' 个地点';
    document.getElementById('route-app').classList.toggle('panel-open', !panel.hidden);
    document.getElementById('route-app').classList.toggle('searching', searching);
  }
  function draw() {
    if (!map || !sdk || !currentState) return;
    const state=currentState, items=[], focused=[], legOverlays=[];
    if (overlays.length) map.remove(overlays);
    for (const destination of state.destinations || []) {
      const color=colors[destination.color % colors.length], result=destination.route, route=selected(result), isFocus=!state.focusId || state.focusId===destination.id;
      if (state.origin && result?.status==='success' && route) {
        const isTransitFocus=destination.mode==='transit' && state.focusId===destination.id;
        const legFocus=isTransitFocus && activeLeg?.place===destination.id && activeLeg?.route===route.id ? route.legs?.[activeLeg.index] : null;
        for (const [index, path] of (route.segments || []).entries()) {
          if (path.length<2) continue;
          const kind=isTransitFocus ? route.legs?.find(leg => index>=leg.pathStart && index<leg.pathEnd)?.kind : null;
          const isSelected=legFocus && index>=legFocus.pathStart && index<legFocus.pathEnd;
          const line=new sdk.Polyline({path,strokeColor:transitColors[kind] || color,strokeStyle:kind==='walk'?'dashed':'solid',strokeDasharray:kind==='walk'?[2,7]:undefined,strokeWeight:isSelected?8:kind==='walk'||!isFocus?4:6,strokeOpacity:isSelected||isFocus&&!legFocus?1:.42,isOutline:true,outlineColor:'#fff',borderWeight:isSelected?3:2,lineJoin:'round',lineCap:'round',zIndex:isSelected?85:isFocus?70:60});
          items.push(line); if (state.focusId===destination.id) focused.push(line);
          if (isSelected) legOverlays.push(line);
        }
      }
      const marker=new sdk.Marker({position:destination.point,content:pin(color,destination.letter),offset:new sdk.Pixel(-16,-16),title:destination.name,bubble:false,zIndex:isFocus?120:110});
      const label=document.createElement('div'); label.className='map-pin-label';
      const name=document.createElement('strong'); name.textContent=destination.name;
      const time=document.createElement('span'); time.className='map-pin-time'; time.style.color=color;
      const value=!state.origin?'待设置出发地':result?.status==='success'?route.minutes+'分钟':result?.status==='pending'?'查询中…':result?.status==='no-route'?'暂无路线':result?.status==='error'?'查询失败':'待查询';
      time.textContent=(modes[destination.mode] || '')+' '+value; label.append(name,time);
      marker.setLabel({direction:'right',offset:new sdk.Pixel(6,-14),content:label.outerHTML});
      marker.on('click',()=>{if (!currentState?.picking && result?.status==='success') {panelCollapsed=false; syncUI(); action('select-mode',{id:destination.id,mode:destination.mode});}});
      items.push(marker); if (state.focusId===destination.id) focused.push(marker);
    }
    if (state.origin) {
      const marker=new sdk.Marker({position:state.origin.point,content:pin('#15354e','起'),offset:new sdk.Pixel(-16,-16),title:state.origin.name,zIndex:150,bubble:false});
      const label=document.createElement('strong'); label.className='map-place-origin'; label.textContent=state.origin.name;
      marker.setLabel({direction:'bottom',offset:new sdk.Pixel(0,5),content:label.outerHTML}); items.push(marker); if (state.focusId) focused.push(marker);
    }
    for (const [index, origin] of (state.origins || []).entries()) {
      if (origin.id === state.origin?.id) continue;
      const marker = new sdk.Marker({position:origin.point, content:pin('#708b8e','起'+(index+1),'inactive'), offset:new sdk.Pixel(-16,-16), title:origin.name, bubble:false, zIndex:100});
      marker.on('click',()=>{panelCollapsed=false; action('activate-origin',{id:origin.id});});
      items.push(marker);
    }
    let previewMarker;
    if (state.preview) {
      const content = pin('#087f83','', 'preview');
      const icon = document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('width','23'); icon.setAttribute('height','23'); icon.setAttribute('viewBox','0 0 256 256'); icon.setAttribute('fill','currentColor');
      const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href','/assets/icons.svg#MapPin'); icon.append(use); content.append(icon);
      previewMarker = new sdk.Marker({position:state.preview.point,content,offset:new sdk.Pixel(-18,-18),title:state.preview.name,bubble:false,zIndex:200});
      items.push(previewMarker);
    }
    overlays=items; if (items.length) map.add(items);
    syncUI();
    const signature=JSON.stringify([state.revision,state.origin?.id,state.preview?.point,state.focusId,legOverlays.length ? activeLeg : null,(state.destinations||[]).map(d=>[d.id,d.point,d.mode,d.route?.status,selected(d.route)?.id])]);
    if (signature!==lastFit && items.length) {map.setFitView(previewMarker?[previewMarker]:legOverlays.length?legOverlays:focused.length?focused:items,false,fitPadding(),16);lastFit=signature;}
    map.setDefaultCursor(state.picking?'crosshair':'grab');
  }

  async function locationDenialMessage() {
    const policy = document.permissionsPolicy ?? document.featurePolicy;
    if (policy?.allowsFeature('geolocation') === false) return '当前页面不允许定位，请用浏览器直接打开';
    try {
      const permission = await navigator.permissions?.query({name:'geolocation'});
      if (permission?.state === 'granted') return '网站已允许定位，请检查系统位置权限';
      if (permission?.state === 'prompt') return '未完成定位授权，可以重试';
    } catch {}
    return '定位被拦截，请检查网站和系统的定位权限';
  }

  async function locate(button) {
    if (button.getAttribute('aria-disabled') === 'true') return;
    locationNotice?.remove();
    if (!window.isSecureContext || !navigator.geolocation) {
      locationNotice = notify(window.isSecureContext ? '当前浏览器不支持定位' : '定位需要通过 HTTPS 或本机地址打开页面');
      return;
    }
    const icon = button.querySelector('use');
    button.setAttribute('aria-disabled', 'true');
    button.title = '正在定位…';
    icon.setAttribute('href', '/assets/icons.svg#SpinnerGap');
    let conversionTimer;
    try {
      const { coords } = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy:true, timeout:12000});
      });
      const position = await new Promise((resolve, reject) => {
        conversionTimer = setTimeout(reject, 12000);
        sdk.convertFrom([coords.longitude, coords.latitude], 'gps', (status, result) => {
          const point = result?.locations?.[0];
          if (status === 'complete' && point) resolve(point);
          else reject();
        });
      });
      if (locationMarker) locationMarker.setPosition(position);
      else {
        const content = document.createElement('div');
        content.className = 'current-location-marker';
        content.setAttribute('role', 'img');
        content.setAttribute('aria-label', '当前位置');
        locationMarker = new sdk.Marker({position, content, offset:new sdk.Pixel(-9,-9), title:'当前位置', bubble:false, zIndex:210});
        map.add(locationMarker);
      }
      const zoom = Math.max(map.getZoom(), 16);
      if (document.getElementById('route-app').matches('.panel-open, .searching')) {
        map.setFitView([locationMarker], true, fitPadding(), zoom);
      } else map.setZoomAndCenter(zoom, position, true);
    } catch (error) {
      if (error?.code === 1 || error?.code === 2) {
        const message = error.code === 1 ? await locationDenialMessage() : '设备暂未提供当前位置，请检查系统定位';
        const help = document.createElement('button');
        help.type = 'button';
        help.textContent = '如何开启';
        help.setAttribute('aria-haspopup', 'dialog');
        help.onclick = () => document.getElementById('location-help').showModal();
        clearTimeout(toastTimer);
        locationNotice = notify(message, help);
      } else {
        locationNotice = notify(error?.code === 3 ? '定位超时，请重试' : '无法在地图上显示当前位置，请重试');
      }
    } finally {
      clearTimeout(conversionTimer);
      button.removeAttribute('aria-disabled');
      button.title = '我的位置';
      icon.setAttribute('href', '/assets/icons.svg#GpsFix');
    }
  }

  function loadMap() {
    configRequest?.abort();
    configRequest = requestJSON('/api/maps/config',(error,config)=>{
      if (error?.cause === 'MAP_NOT_CONFIGURED') {mapFailure('地图服务尚未完成配置', true); return;}
      if (error || !config?.jsKey) {if (!map) mapFailure('地图配置加载失败，请稍后重试'); return;}
      if (sdkKey) {
        if (sdkKey !== config.jsKey) document.getElementById('map-status').textContent = '需刷新';
        return;
      }
      sdkKey = config.jsKey;
      document.getElementById('map-status').textContent = '连接中';
      document.getElementById('map-loading').textContent = '正在加载地图…';
      window._AMapSecurityConfig={serviceHost:location.origin+'/_AMapService'};
      const script=document.createElement('script'), callback='__jichengMapReady';
      const timer=setTimeout(()=>mapFailure('高德地图加载超时，请检查网络后重试'),22000);
      window[callback]=()=>{
        clearTimeout(timer); delete window[callback]; sdk=window.AMap;
        try {
          map=new sdk.Map('route-map',{viewMode:'2D',center:[117.200,39.125],zoom:11,resizeEnable:true});
          map.on('complete',()=>{const status=document.getElementById('map-status');if(status.textContent!=='需刷新')status.textContent='已接入';document.getElementById('map-status-dot').classList.add('ready');});
          map.on('click',event=>{
            if (pickBusy || document.querySelector('dialog[open]')) return;
            pickBusy=true; action(currentState?.picking?'pick':'inspect-point',{point:event.lnglat.getLng().toFixed(6)+','+event.lnglat.getLat().toFixed(6)}).finally(()=>{pickBusy=false;});
          });
          document.getElementById('map-loading').hidden=true;
          document.getElementById('map-fit').onclick=()=>{if(overlays.length)map.setFitView(overlays,false,fitPadding(),16);};
          document.getElementById('map-zoom-in').onclick=()=>map.zoomIn();
          document.getElementById('map-zoom-out').onclick=()=>map.zoomOut();
          draw();
          const locateButton = document.getElementById('map-locate');
          locateButton.onclick = () => locate(locateButton);
          locateButton.disabled = false;
        } catch {mapFailure('地图初始化失败，请刷新后重试');}
      };
      script.onerror=()=>{clearTimeout(timer);mapFailure('无法加载高德地图，请检查网络');};
      script.src='https://webapi.amap.com/maps?'+new URLSearchParams({v:'2.0',key:config.jsKey,callback});script.async=true;document.head.appendChild(script);
    });
  }
  function initializeDialogs() {
    const editor=document.querySelector('dialog[data-editor]');
    if (editor && !editor.open) {
      editor.showModal();
      editor.addEventListener('cancel',event=>{event.preventDefault();action('close-editor');});
      editor.addEventListener('click',event=>{if(event.target===editor)action('close-editor');});
    }
  }
  document.addEventListener('click',event=>{
    const providers=document.getElementById('map-provider'), settings=document.getElementById('map-settings-dialog');
    if (event.target.closest('[data-open-map-settings]')) {
      providers.open=false;
      settings.showModal();
    } else if (!providers.contains(event.target)) providers.open=false;
    if (event.target.closest('[data-close-map-settings]')) settings.close();
    if (event.target.closest('[data-reload-map]')) location.reload();
    if(event.target.closest('[data-search-focus]')) { document.getElementById('place-query').focus(); document.getElementById('place-query').select(); if(innerWidth<=760) {panelCollapsed=true; syncUI();} }
    if(event.target.closest('[data-collapse-panel]')) {panelCollapsed=true; syncUI();}
    if(event.target.closest('#panel-toggle')) {panelCollapsed=false; if(innerWidth<=760 && document.querySelector('[data-search-open]')?.dataset.searchOpen==='true') action('clear-search'); syncUI();}
    if(event.target.closest('[hx-post="/ui/assign-place"]')) panelCollapsed=false;
    if(event.target.closest('[data-open-help]'))document.getElementById('help-dialog').showModal();
    if(event.target.closest('[data-close-help]'))document.getElementById('help-dialog').close();
    const leg=event.target.closest('[data-map-leg]');
    if (leg) {
      const itinerary=leg.closest('.transit-itinerary'), on=leg.getAttribute('aria-pressed')!=='true';
      itinerary.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed','false');
      if (on) leg.setAttribute('aria-pressed','true');
      activeLeg=on ? {place:itinerary.dataset.place, route:itinerary.dataset.route, index:Number(leg.dataset.mapLeg)} : null;
      draw();
    }
  });
  document.addEventListener('toggle',event=>{
    const itinerary=event.target;
    if (activeLeg && itinerary.isConnected && itinerary.matches('.transit-itinerary:not([open])')) {
      itinerary.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed','false');
      activeLeg=null;
      draw();
    }
  },true);
  document.addEventListener('keydown',event=>{
    const providers=document.getElementById('map-provider');
    if (event.key==='Escape' && providers.open) {providers.open=false; providers.querySelector('summary').focus(); return;}
    if(event.key==='Enter' && event.target.matches('[data-search-on-enter]')){
      event.preventDefault();const form=document.getElementById('place-form');action('search-editor',Object.fromEntries(new FormData(form)));
    }
    if(event.key==='Escape' && !document.querySelector('dialog[open]')) {if(currentState?.picking)action('cancel-pick');else if(document.querySelector('[data-search-open]')?.dataset.searchOpen==='true')action('clear-search');}
  });
  document.addEventListener('htmx:afterSettle',()=>{initializeDialogs();syncUI();});
  document.addEventListener('htmx:oobAfterSwap',event=>{
    initializeDialogs();syncUI();
    if(event.detail.target?.id==='notice') {
      clearTimeout(toastTimer); const notice = document.getElementById('notice');
      toastTimer=setTimeout(()=>notice.replaceChildren(),5500);
    }
    if(event.detail.target?.id==='route-options') {
      const nextPanel=document.querySelector('[data-route-detail]')?.dataset.routeDetail;
      if (nextPanel!==panelKey) document.querySelector('.sidebar-scroll').scrollTop=0;
      panelKey=nextPanel;
      activeLeg=null;
    }
  });
  document.addEventListener('htmx:beforeRequest',event=>{
    if(event.detail.elt?.matches('.search-toolbar')) document.getElementById('place-query')?.blur();
  });
  window.addEventListener('resize',syncUI);
  document.addEventListener('route:updated',refreshMap);
  document.addEventListener('route:map-configured',()=>{document.getElementById('map-settings-form').reset();loadMap();});
  document.getElementById('map-settings-dialog').addEventListener('close',()=>{
    document.getElementById('map-settings-form')?.reset();
    document.getElementById('map-settings-feedback')?.replaceChildren();
    document.querySelector('#map-provider > summary').focus();
  });
  document.addEventListener('htmx:responseError',event=>notify(event.detail.xhr.status===403?'页面会话已过期，请刷新后重试':'操作失败，请稍后重试'));
  document.addEventListener('htmx:sendError',()=>notify('网络连接失败，请稍后重试'));
  // Page layout and map instance remain mounted across every htmx update.
  syncUI(); refreshMap(); loadMap(); initializeDialogs();
})();
