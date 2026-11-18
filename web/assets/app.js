(() => {
  'use strict';
  const colors = ['#1680ff', '#ff8914', '#29b538', '#9867d8', '#e05c83', '#0a9f99', '#a47529', '#4668d2'];
  const modes = {driving:'驾车', transit:'公交', cycling:'自行车', electric:'电动车', walking:'步行'};
  let map, sdk, overlays = [], currentState, pendingRefresh, requestVersion = 0, lastFit = '', mapRequest, pickBusy = false;
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
  function pin(color, text) {
    const node = document.createElement('div'); node.className='native-pin';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 38 48');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M19 1C9 1 2 8 2 18c0 13 17 28 17 28s17-15 17-28C36 8 29 1 19 1Z'); path.setAttribute('fill',color); path.setAttribute('stroke','#fff'); path.setAttribute('stroke-width','2');
    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle'); dot.setAttribute('cx','19'); dot.setAttribute('cy','18'); dot.setAttribute('r','7'); dot.setAttribute('fill',color);
    svg.append(path,dot); const label=document.createElement('span'); label.textContent=text; node.append(svg,label); return node;
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
      const marker=new sdk.Marker({position:destination.point,content:pin(color,destination.letter),offset:new sdk.Pixel(-19,-45),title:destination.name,bubble:false,zIndex:isFocus?120:110});
      const label=document.createElement('div'); label.className='map-pin-label';
      const name=document.createElement('strong'); name.textContent=destination.name;
      const time=document.createElement('span'); time.className='map-pin-time'; time.style.color=color;
      const value=!state.origin?'待设置出发地':result?.status==='success'?route.minutes+'分钟':result?.status==='pending'?'查询中…':result?.status==='no-route'?'暂无路线':result?.status==='error'?'查询失败':'待查询';
      time.textContent=(modes[destination.mode] || '')+' '+value; label.append(name,time);
      marker.setLabel({direction:'right',offset:new sdk.Pixel(6,-14),content:label.outerHTML});
      marker.on('click',()=>{if (!currentState?.picking && result?.status==='success') action('select-mode',{id:destination.id,mode:destination.mode});});
      items.push(marker); if (state.focusId===destination.id) focused.push(marker);
    }
    if (state.origin) {
      const marker=new sdk.Marker({position:state.origin.point,content:pin('#15354e','起'),offset:new sdk.Pixel(-19,-45),title:state.origin.name,zIndex:150});
      const label=document.createElement('strong'); label.className='map-place-origin'; label.textContent=state.origin.name;
      marker.setLabel({direction:'bottom',offset:new sdk.Pixel(0,5),content:label.outerHTML}); items.push(marker); if (state.focusId) focused.push(marker);
    }
    overlays=items; if (items.length) map.add(items);
    const signature=JSON.stringify([state.revision,state.origin?.id,state.focusId,(state.destinations||[]).map(d=>[d.id,d.point,d.mode,d.route?.status,selected(d.route)?.id])]);
    if (signature!==lastFit && items.length) {map.setFitView(focused.length?focused:items,false,[60,90,70,70],16);lastFit=signature;}
    map.setDefaultCursor(state.picking?'crosshair':'grab');
    document.getElementById('map-empty').hidden=!!state.origin || !!state.destinations?.length || state.picking;
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
            if (!currentState?.picking || pickBusy) return;
            pickBusy=true; action('pick',{point:event.lnglat.getLng().toFixed(6)+','+event.lnglat.getLat().toFixed(6)}).finally(()=>{pickBusy=false;});
          });
          document.getElementById('map-loading').hidden=true;
          document.getElementById('map-fit').onclick=()=>{if(overlays.length)map.setFitView(overlays,false,[60,90,70,70],16);};
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
    if(event.target.closest('[data-open-help]'))document.getElementById('help-dialog').showModal();
    if(event.target.closest('[data-close-help]'))document.getElementById('help-dialog').close();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter' && event.target.matches('[data-search-on-enter]')){
      event.preventDefault();const form=document.getElementById('place-form');action('search-editor',Object.fromEntries(new FormData(form)));
    }
    if(event.key==='Escape' && currentState?.picking)action('cancel-pick');
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='origin-search'){
      const input=event.target;document.getElementById('query-button-text').textContent=input.value.trim() && input.value.trim()!==input.dataset.activeName?'搜索地点':'查询路线';
    }
  });
  document.addEventListener('htmx:afterSettle',()=>{initializeDialogs();});
  document.addEventListener('htmx:oobAfterSwap',()=>{initializeDialogs();});
  document.addEventListener('route:updated',refreshMap);
  document.addEventListener('htmx:responseError',event=>notify(event.detail.xhr.status===403?'页面会话已过期，请刷新后重试':'操作失败，请稍后重试'));
  document.addEventListener('htmx:sendError',()=>notify('网络连接失败，请稍后重试'));
  // Page layout and map instance remain mounted across every htmx update.
  refreshMap(); loadMap(); initializeDialogs();
})();
