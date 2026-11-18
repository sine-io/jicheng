(() => {
  'use strict';
  const colors = ['#1680ff', '#ff8914', '#29b538', '#9867d8', '#e05c83', '#0a9f99', '#a47529', '#4668d2'];
  const modes = {driving:'驾车', transit:'公交', cycling:'自行车', electric:'电动车', walking:'步行'};
  let map, sdk, overlays = [], currentState, pendingRefresh, requestVersion = 0, lastFit = '', mapRequest, pickBusy = false, panelCollapsed = false, toastTimer;
  const meta = () => Object.fromEntries(new FormData(document.getElementById('workspace-meta')));
  const selected = result => result?.alternatives?.find(route => route.id === result.selectedId) || result?.alternatives?.[0];
  function action(name, values = {}) {
    return htmx.ajax('POST', '/ui/' + name, {target:'#updates', swap:'innerHTML', values:{...meta(), ...values}});
  }
  function requestJSON(url, callback) {
    const request = new XMLHttpRequest(); request.open('GET', url); request.timeout = 25000;
    request.onload = () => {
      let data; try {data = JSON.parse(request.responseText);} catch {callback(new Error('服务返回数据异常')); return;}
      if (request.status < 200 || request.status >= 300) {callback(new Error(request.status === 403 ? '页面会话已过期，请刷新后重试' : '服务连接失败，请稍后重试')); return;}
      callback(null, data);
    };
    request.onerror = request.ontimeout = () => callback(new Error('网络连接失败，请稍后重试'));
    request.send(); return request;
  }
  function notify(message) {
    const node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role','status');
    const text = document.createElement('span'); text.textContent = message;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => node.remove();
    node.append(text, close); document.getElementById('notice').replaceChildren(node);
  }
  function mapFailure(message) {
    document.getElementById('map-status').textContent = '连接失败';
    const loading = document.getElementById('map-loading'); loading.hidden = false; loading.replaceChildren();
    const text = document.createElement('strong'); text.textContent = message;
    const button = document.createElement('button'); button.type='button'; button.className='secondary-button'; button.textContent='重新加载'; button.onclick=()=>location.reload();
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
    document.querySelector('.refresh-routes')?.toggleAttribute('disabled', document.querySelector('[aria-busy="true"]') !== null || !currentState?.origin || !currentState?.destinations?.length);
  }
  function draw() {
    if (!map || !sdk || !currentState) return;
    const state=currentState, items=[], focused=[];
    if (overlays.length) map.remove(overlays);
    for (const destination of state.destinations || []) {
      const color=colors[destination.color % colors.length], result=destination.route, route=selected(result), isFocus=!state.focusId || state.focusId===destination.id;
      if (state.origin && result?.status==='success' && route) {
        for (const path of route.segments || []) {
          if (path.length<2) continue;
          const line=new sdk.Polyline({path,strokeColor:color,strokeWeight:isFocus?6:4,strokeOpacity:isFocus?1:.42,isOutline:true,outlineColor:'#fff',borderWeight:2,lineJoin:'round',lineCap:'round',zIndex:isFocus?70:60});
          items.push(line); if (state.focusId===destination.id) focused.push(line);
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
    const signature=JSON.stringify([state.revision,state.origin?.id,state.preview?.point,state.focusId,(state.destinations||[]).map(d=>[d.id,d.point,d.mode,d.route?.status,selected(d.route)?.id])]);
    if (signature!==lastFit && items.length) {map.setFitView(previewMarker?[previewMarker]:focused.length?focused:items,false,fitPadding(),16);lastFit=signature;}
    map.setDefaultCursor(state.picking?'crosshair':'grab');
  }

  function loadMap() {
    requestJSON('/api/maps/config',(error,config)=>{
      if (error || !config?.jsKey) {mapFailure('地图服务尚未完成配置'); return;}
      window._AMapSecurityConfig={serviceHost:location.origin+'/_AMapService'};
      const script=document.createElement('script'), callback='__jichengMapReady';
      const timer=setTimeout(()=>mapFailure('高德地图加载超时，请检查网络后重试'),22000);
      window[callback]=()=>{
        clearTimeout(timer); delete window[callback]; sdk=window.AMap;
        try {
          map=new sdk.Map('route-map',{viewMode:'2D',center:[117.200,39.125],zoom:11,resizeEnable:true});
          map.on('complete',()=>{document.getElementById('map-status').textContent='已接入';document.getElementById('map-status-dot').classList.add('ready');});
          map.on('click',event=>{
            if (pickBusy || document.querySelector('dialog[open]')) return;
            pickBusy=true; action(currentState?.picking?'pick':'inspect-point',{point:event.lnglat.getLng().toFixed(6)+','+event.lnglat.getLat().toFixed(6)}).finally(()=>{pickBusy=false;});
          });
          document.getElementById('map-loading').hidden=true;
          document.getElementById('map-fit').onclick=()=>{if(overlays.length)map.setFitView(overlays,false,fitPadding(),16);};
          document.getElementById('map-zoom-in').onclick=()=>map.zoomIn();
          document.getElementById('map-zoom-out').onclick=()=>map.zoomOut();
          draw();
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
    if(event.target.closest('[data-search-focus]')) { document.getElementById('place-query').focus(); document.getElementById('place-query').select(); if(innerWidth<=760) {panelCollapsed=true; syncUI();} }
    if(event.target.closest('[data-collapse-panel]')) {panelCollapsed=true; syncUI();}
    if(event.target.closest('#panel-toggle')) {panelCollapsed=false; if(innerWidth<=760 && document.querySelector('[data-search-open]')?.dataset.searchOpen==='true') action('clear-search'); syncUI();}
    if(event.target.closest('[hx-post="/ui/assign-place"]')) panelCollapsed=false;
    if(event.target.closest('[data-open-help]'))document.getElementById('help-dialog').showModal();
    if(event.target.closest('[data-close-help]'))document.getElementById('help-dialog').close();
  });
  document.addEventListener('keydown',event=>{
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
    if(event.detail.target?.id==='route-options') document.querySelector('.sidebar-scroll').scrollTop=0;
  });
  document.addEventListener('htmx:beforeRequest',event=>{
    if(event.detail.elt?.matches('.search-toolbar')) document.getElementById('place-query')?.blur();
  });
  window.addEventListener('resize',syncUI);
  document.addEventListener('route:updated',refreshMap);
  document.addEventListener('htmx:responseError',event=>notify(event.detail.xhr.status===403?'页面会话已过期，请刷新后重试':'操作失败，请稍后重试'));
  document.addEventListener('htmx:sendError',()=>notify('网络连接失败，请稍后重试'));
  // Page layout and map instance remain mounted across every htmx update.
  syncUI(); refreshMap(); loadMap(); initializeDialogs();
})();
