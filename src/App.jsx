import {useEffect, useRef, useState} from 'react';
import {Path, MagnifyingGlass, PencilSimple, X, Plus, Check, CaretDown, Car, Bus, Bicycle, PersonSimpleWalk, MapPin, Crosshair, SpinnerGap, Info, ArrowRight, MapTrifold} from '@phosphor-icons/react';
import MapView from './MapView';
import RouteOptions from './RouteOptions';
import {selectedRoute} from './route-data';
import {MODES, PROVIDERS, DRIVING_POLICIES, colorFor, letter, distanceLabel} from './model';
import {loadAMap, searchPlaces, reversePlace, queryRoute, mapCapabilities} from './amap';
const MODE_ICONS = {driving: Car, transit: Bus, cycling: Bicycle, electric: Bicycle, walking: PersonSimpleWalk};
function IconButton({label, children, onClick, className = '', disabled = false}) {
  return <button type="button" className={'icon-button ' + className} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Dialog({title, children, onClose, className = ''}) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement, node = dialog.current;
    if (!node.open) node.showModal();
    return () => {node.close(); if (previous?.isConnected) previous.focus();};
  }, []);
  return <dialog ref={dialog} className={'app-dialog ' + className} onCancel={e => {e.preventDefault(); onClose();}} onClick={e => {if (e.target === e.currentTarget) onClose();}}><div className="dialog-heading"><h2>{title}</h2><IconButton label="关闭窗口" onClick={onClose}><X size={21}/></IconButton></div>{children}</dialog>;
}
function PlaceEditor({sdk, editor, onSave, onClose, onPick, city}) {
  const [name, setName] = useState(editor.name || ''), [selected, setSelected] = useState(editor.selected || null);
  const [filter, setFilter] = useState(''), [choices, setChoices] = useState([]), [searched, setSearched] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(null), epoch = useRef(0);
  useEffect(() => () => {epoch.current++; request.current?.abort();}, []);
  const kindName = editor.kind === 'origin' ? '出发地' : '目的地';
  async function search() {
    if (!filter.trim() || !sdk) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const version = ++epoch.current;
    setBusy(true); setChoices([]); setError(''); setSearched(false);
    try {
      const places = await searchPlaces(sdk, filter, city, controller.signal);
      if (version !== epoch.current) return;
      setChoices(places); setSearched(true);
    } catch (e) {if (version === epoch.current && e.name !== 'AbortError') setError(e.message);}
    finally {if (version === epoch.current) setBusy(false);}
  }
  function submit(e) {
    e.preventDefault();
    if (!selected) {setError('请从搜索结果中选择地点，或在地图上选点'); return;}
    onSave({...editor, name: name.trim() || selected.name, selected});
  }
  return <Dialog title={(editor.id ? '编辑' : '添加') + kindName} onClose={onClose}><form onSubmit={submit}>
    <label className="form-label" htmlFor="place-search">搜索真实地点</label>
    <div className="dialog-search live-search"><MagnifyingGlass size={19}/><input id="place-search" autoFocus placeholder="输入地点，建议加上城市名" value={filter} maxLength={100} onChange={e => {epoch.current++; request.current?.abort(); setFilter(e.target.value); setChoices([]); setSearched(false); setBusy(false); setError('');}} onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault(); search();}}}/><button type="button" disabled={!sdk || !filter.trim() || busy} onClick={search}>{busy ? <SpinnerGap className="spin" size={19}/> : '搜索'}</button></div>
    <div className="place-choices" aria-label="高德地点搜索结果" aria-live="polite">
      {choices.map((choice, i) => <button type="button" className={'place-choice' + (selected?.poiId === choice.poiId && selected?.address === choice.address ? ' selected' : '')} key={choice.poiId || i} onClick={() => {setSelected(choice); setError('');}}><MapPin size={19}/><span className="place-result-copy"><strong>{choice.name}</strong><small>{choice.address}</small></span>{selected?.poiId === choice.poiId && selected?.address === choice.address && <Check size={18}/>}</button>)}
      {!choices.length && <p className="search-empty">{busy ? '正在搜索高德地点…' : searched ? '没有找到地点，换个名称或加上城市再试。' : '搜索后选择准确地址，也可以在地图上选点。'}</p>}
    </div>
    <button type="button" className="map-pick-action" onClick={() => onPick({...editor, name, selected})}><Crosshair size={19}/>在地图上选点<ArrowRight size={17}/></button>
    {selected && <div className="chosen-position live-chosen"><Check size={16}/><span>已选择：{selected.name}<small>{selected.address}</small></span></div>}
    <label className="form-label" htmlFor="place-name">显示名称 <span className="optional-label">可选</span></label><input id="place-name" className="form-input" value={name} maxLength={32} placeholder="留空使用地点名称" onChange={e => setName(e.target.value)}/>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">{editor.id ? '保存修改' : '添加' + kindName}</button></div>
  </form></Dialog>;
}
export function App() {
  const [sdk, setSdk] = useState(null), [sdkError, setSdkError] = useState(''), [mapReady, setMapReady] = useState(false);
  const [origins, setOrigins] = useState([]), [destinations, setDestinations] = useState([]), [activeId, setActiveId] = useState(null);
  const [providerOpen, setProviderOpen] = useState(false), [infoOpen, setInfoOpen] = useState(false);
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false), [searchIndex, setSearchIndex] = useState(-1), [searchOptions, setSearchOptions] = useState([]), [searchBusy, setSearchBusy] = useState(false), [searchError, setSearchError] = useState('');
  const [editor, setEditor] = useState(null), [picking, setPicking] = useState(null), [pickBusy, setPickBusy] = useState(false), [focusId, setFocusId] = useState(null);
  const [drivingPolicy, setDrivingPolicy] = useState(10), [routeContext, setRouteContext] = useState(null);
  const [batch, setBatch] = useState(null), [revision, setRevision] = useState(0), [fitRevision, setFitRevision] = useState(0), [toast, setToast] = useState(null);
  const serial = useRef(1), colorSerial = useRef(0), toastTimer = useRef(null), searchEpoch = useRef(0), searchRequest = useRef(null), pickEpoch = useRef(0), pickRequest = useRef(null), providerControl = useRef(null), searchControl = useRef(null);
  const active = origins.find(p => p.id === activeId) || null;
  const requestKey = JSON.stringify({origin: active && [active.id, active.point, active.city], destinations: destinations.map(d => [d.id, d.point, d.city]), revision, drivingPolicy});
  const results = batch?.key === requestKey ? batch.results : null;
  const loading = !!sdk && !!active && !!destinations.length && (batch?.key !== requestKey || batch.loading);
  const searchIntent = !!query.trim() && query.trim() !== active?.name;
  useEffect(() => {let live = true; loadAMap().then(value => {if (live) setSdk(value);}).catch(e => {if (live) setSdkError(e.message);}); return () => {live = false;};}, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!sdk || !active || !destinations.length) {setBatch(null); return () => controller.abort();}
    const initial = Object.fromEntries(destinations.map(d => [d.id, Object.fromEntries(MODES.map(m => [m.id, {status: 'pending'}]))]));
    setBatch({key: requestKey, results: initial, loading: true});
    let remaining = destinations.length * MODES.length;
    for (const destination of destinations) for (const mode of MODES) {
      queryRoute(sdk, active, destination, mode.id, controller.signal, {drivingPolicy}).catch(e => e.name === 'AbortError' ? null : {status: 'error', reason: '路线查询失败，请重试'}).then(route => {
        if (controller.signal.aborted || !route) return;
        remaining--;
        setBatch(previous => previous?.key !== requestKey ? previous : {...previous, results: {...previous.results, [destination.id]: {...previous.results[destination.id], [mode.id]: route}}, loading: remaining > 0, queriedAt: Date.now()});
      });
    }
    return () => controller.abort();
  }, [sdk, requestKey]);
  useEffect(() => () => {clearTimeout(toastTimer.current); searchRequest.current?.abort(); pickRequest.current?.abort();}, []);
  useEffect(() => {
    function dismiss(e) {if (!providerControl.current?.contains(e.target)) setProviderOpen(false); if (!searchControl.current?.contains(e.target) && !e.target.closest('.query-button')) setSearchOpen(false);}
    function key(e) {if (e.key === 'Escape') {setProviderOpen(false); setSearchOpen(false); cancelPick();}}
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', key);
    return () => {document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key);};
  }, []);
  function notify(message, undo) {clearTimeout(toastTimer.current); setToast({message, undo}); toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 4500);}
  function cancelSearch() {searchEpoch.current++; searchRequest.current?.abort(); setSearchBusy(false); setSearchOpen(false); setSearchOptions([]); setSearchError(''); setSearchIndex(-1);}
  function cancelPick() {pickEpoch.current++; pickRequest.current?.abort(); setPicking(null); setPickBusy(false);}
  function switchOrigin(id) {if (id === activeId) return; cancelSearch(); cancelPick(); setActiveId(id); setQuery(origins.find(p => p.id === id)?.name || ''); setFocusId(null); setFitRevision(n => n + 1);}
  function openEditor(kind, place) {cancelSearch(); cancelPick(); setEditor({kind, id: place?.id, name: place?.name || '', selected: place || null, color: place?.color, mode: place?.mode});}
  function saveEditor(next) {
    const place = {...next.selected, id: next.id || 'place-' + serial.current++, name: next.name};
    if (next.kind === 'origin') {setOrigins(before => next.id ? before.map(p => p.id === place.id ? place : p) : [...before, place]); setActiveId(place.id); setQuery(place.name);}
    else {place.color = next.color ?? colorSerial.current++; place.mode = next.mode || 'driving'; setDestinations(before => next.id ? before.map(p => p.id === place.id ? place : p) : [...before, place]);}
    setEditor(null); cancelPick(); setFocusId(null); setFitRevision(n => n + 1); notify(next.id ? '地点已更新' : '地点已添加');
  }
  function deleteOrigin(place) {
    const index = origins.findIndex(p => p.id === place.id), next = origins.filter(p => p.id !== place.id);
    cancelSearch(); cancelPick(); setOrigins(next); setFocusId(null);
    if (activeId === place.id) {setActiveId(next[0]?.id || null); setQuery(next[0]?.name || '');}
    notify('已删除 ' + place.name, () => {setOrigins(before => {const restored = [...before]; restored.splice(Math.min(index, restored.length), 0, place); return restored;}); setActiveId(place.id); setQuery(place.name);});
  }
  function deleteDestination(place) {
    const index = destinations.findIndex(p => p.id === place.id);
    setDestinations(before => before.filter(p => p.id !== place.id)); setFocusId(null);
    notify('已删除 ' + place.name, () => setDestinations(before => {const restored = [...before]; restored.splice(Math.min(index, restored.length), 0, place); return restored;}));
  }
  function chooseSearch(place) {
    const id = activeId || 'place-' + serial.current++, next = {...place, id};
    setOrigins(before => activeId ? before.map(p => p.id === activeId ? next : p) : [...before, next]); setActiveId(id); setQuery(place.name); cancelSearch(); cancelPick(); setFocusId(null); setFitRevision(n => n + 1);
  }
  async function submitQuery(e) {
    e?.preventDefault(); if (!sdk) return;
    if (!searchIntent) {if (active && destinations.length) {cancelSearch(); cancelPick(); setRevision(n => n + 1);} return;}
    searchRequest.current?.abort(); const controller = new AbortController(); searchRequest.current = controller; const version = ++searchEpoch.current;
    setSearchOpen(true); setSearchBusy(true); setSearchOptions([]); setSearchError(''); setSearchIndex(-1);
    try {const places = await searchPlaces(sdk, query, active?.city, controller.signal); if (version === searchEpoch.current) setSearchOptions(places);}
    catch (error) {if (version === searchEpoch.current && error.name !== 'AbortError') setSearchError(error.message);}
    finally {if (version === searchEpoch.current) setSearchBusy(false);}
  }
  async function pickPoint(point) {
    if (!picking || pickBusy || !sdk) return;
    const version = ++pickEpoch.current, draft = picking; pickRequest.current?.abort(); const controller = new AbortController(); pickRequest.current = controller; setPickBusy(true);
    try {
      const place = await reversePlace(sdk, point, controller.signal);
      if (version !== pickEpoch.current) return;
      setPicking(null); setPickBusy(false);
      if (draft.quick) chooseSearch(place); else setEditor({...draft.editor, selected: place});
    } catch (error) {if (version === pickEpoch.current) {setPickBusy(false); if (error.name !== 'AbortError') notify(error.message);}}
  }
  function selectMode(destination, mode) {
    if (results?.[destination.id]?.[mode.id]?.status !== 'success') return;
    setDestinations(before => before.map(p => p.id === destination.id ? {...p, mode: mode.id} : p)); setFocusId(destination.id); setRouteContext({destinationId: destination.id, modeId: mode.id, key: requestKey});
  }
  function selectAlternative(id) {
    if (!routeContext || routeContext.key !== requestKey) return;
    const {destinationId, modeId} = routeContext;
    setBatch(previous => {
      if (previous?.key !== requestKey) return previous;
      const current = previous.results[destinationId]?.[modeId];
      const next = selectedRoute(current, id);
      return next === current ? previous : {...previous, results: {...previous.results, [destinationId]: {...previous.results[destinationId], [modeId]: next}}};
    });
  }
  function focusDestination(id) {
    const destination = destinations.find(d => d.id === id), mode = MODES.find(m => m.id === destination?.mode);
    if (destination && mode && results?.[id]?.[mode.id]?.status === 'success') selectMode(destination, mode);
    else setFocusId(id);
  }
  const optionDestination = routeContext?.key === requestKey ? destinations.find(d => d.id === routeContext.destinationId) : null;
  const optionMode = MODES.find(m => m.id === routeContext?.modeId);
  const optionResult = optionDestination && results?.[optionDestination.id]?.[optionMode?.id];
  const statusText = sdkError ? '连接失败' : mapReady ? '已接入' : '连接中';
  const routeErrors = Object.values(results || {}).flatMap(row => Object.values(row)).filter(route => route.status === 'error');
  return <main className="route-app">
    <header className="app-header"><div className="brand"><Path size={46} weight="bold" aria-hidden="true"/><h1>路线查询</h1></div><p className="brand-subtitle">切换出发地，查看多目的地路线</p><div className="header-actions"><div className="provider-control" ref={providerControl}><button className="provider-trigger" aria-expanded={providerOpen} aria-haspopup="menu" onClick={() => setProviderOpen(!providerOpen)}><span>地图服务：</span><strong>高德</strong><CaretDown size={16}/></button>{providerOpen && <div className="provider-menu" role="menu" aria-label="地图服务"><p className="menu-caption">地图来源</p>{PROVIDERS.map(item => <button role="menuitemradio" aria-checked={item.id === 'amap'} disabled={!item.configured} key={item.id} onClick={() => setProviderOpen(false)}><MapTrifold size={20}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{item.id === 'amap' && <Check size={18} weight="bold"/>}</button>)}</div>}</div><button className={'demo-badge live-status ' + (sdkError ? 'failed' : '')} onClick={() => setInfoOpen(true)}><span className={'status-dot' + (mapReady ? ' ready' : '')}/>{statusText}<Info size={14}/></button></div></header>
    <section className="origin-toolbar" aria-label="出发地管理"><span className="toolbar-label">出发地</span><div className="origin-tabs" role="tablist" aria-label="选择出发地">{origins.map(origin => <div className={'origin-tab-wrap' + (activeId === origin.id ? ' active' : '')} key={origin.id}><button role="tab" aria-selected={activeId === origin.id} className="origin-tab" onClick={() => switchOrigin(origin.id)} title={origin.address}>{origin.name}</button>{activeId === origin.id && <div className="origin-tab-actions"><IconButton label={'编辑' + origin.name} onClick={() => openEditor('origin', origin)}><PencilSimple size={18}/></IconButton><IconButton label={'删除' + origin.name} onClick={() => deleteOrigin(origin)}><X size={18}/></IconButton></div>}</div>)}{!origins.length && <span className="no-origin-label">搜索地点，或添加一个出发地</span>}</div><button className="text-button add-origin" disabled={!sdk} onClick={() => openEditor('origin')}><Plus size={21}/>添加出发地</button></section>
    <form className="search-toolbar" onSubmit={submitQuery}><div className="search-combobox" ref={searchControl}><MagnifyingGlass size={25} aria-hidden="true"/><input aria-label="搜索出发地" role="combobox" aria-expanded={searchOpen} aria-controls="origin-search-options" aria-autocomplete="list" aria-activedescendant={searchIndex >= 0 ? 'search-option-' + searchIndex : undefined} placeholder="搜索出发地，建议加上城市名" disabled={!sdk} value={query} maxLength={100} onChange={e => {cancelSearch(); setQuery(e.target.value);}} onKeyDown={e => {if (e.key === 'ArrowDown' && searchOptions.length) {e.preventDefault(); setSearchOpen(true); setSearchIndex(Math.min(searchIndex + 1, searchOptions.length - 1));} if (e.key === 'ArrowUp' && searchOptions.length) {e.preventDefault(); setSearchIndex(Math.max(0, searchIndex - 1));} if (e.key === 'Enter' && searchOpen && searchIndex >= 0 && searchOptions[searchIndex]) {e.preventDefault(); chooseSearch(searchOptions[searchIndex]);}}}/>{query && <IconButton label="清空搜索" onClick={() => {cancelSearch(); setQuery('');}}><X size={15} weight="bold"/></IconButton>}{searchOpen && <div className="search-options" role="listbox" id="origin-search-options" aria-busy={searchBusy}><div className="search-options-caption">选择准确的出发位置</div>{searchOptions.map((place, index) => <button type="button" id={'search-option-' + index} role="option" aria-selected={searchIndex === index} className={searchIndex === index ? 'highlighted' : ''} key={place.poiId || index} onMouseDown={e => e.preventDefault()} onClick={() => chooseSearch(place)}><MapPin size={18}/><span className="place-result-copy"><strong>{place.name}</strong><small>{place.address}</small></span></button>)}{!searchOptions.length && <p className="search-empty" role="status">{searchBusy ? '正在搜索高德地点…' : searchError || '没有找到地点，换个名称或加上城市再试。'}</p>}</div>}</div><div className="search-help"><span>搜索地点，或</span><button type="button" disabled={!sdk} onClick={() => {cancelSearch(); setPicking({kind: 'origin', quick: true});}}>在地图上选点</button></div><button className="primary-button query-button" type="submit" disabled={!sdk || searchBusy || (!searchIntent && (!active || !destinations.length || loading))}>{(searchBusy || (loading && !searchIntent)) && <SpinnerGap className="spin" size={20}/>} {searchBusy ? '搜索中' : searchIntent ? '搜索地点' : loading ? '查询中' : '查询路线'}</button></form>
    <section className="driving-preferences" aria-label="驾车路线偏好"><label htmlFor="driving-policy"><Car size={20}/>驾车偏好</label><select id="driving-policy" value={drivingPolicy} onChange={e => {setDrivingPolicy(Number(e.target.value)); setFocusId(null);}}>{DRIVING_POLICIES.map(policy => <option value={policy.id} key={policy.id}>{policy.name}</option>)}</select><p>点击目的地耗时，可选择高德返回的备选路线</p></section>
    <MapView sdk={sdk} sdkError={sdkError} onReady={() => setMapReady(true)} origin={active} destinations={destinations} results={results} focusId={focusId} onFocus={focusDestination} onMapPick={pickPoint} picking={picking} pickBusy={pickBusy} cancelPicking={cancelPick} fitRevision={fitRevision}/>
    {optionResult?.status === 'success' && <RouteOptions destination={optionDestination} mode={optionMode} result={optionResult} policyName={DRIVING_POLICIES.find(p => p.id === drivingPolicy)?.name} onSelect={selectAlternative} onClose={() => setRouteContext(null)}/>}
    <section className="results-section" aria-label="目的地路线查询结果" aria-busy={loading}><div className="results-heading"><h2>目的地与耗时</h2><p>点击时长，查看并选择路线</p><button className="text-button add-destination" disabled={!sdk} onClick={() => openEditor('destination')}><Plus size={21}/>添加目的地</button></div><div className="results-table-scroll"><table className="results-table"><thead><tr><th scope="col" className="destination-column">目的地</th>{MODES.map(mode => {const Icon = MODE_ICONS[mode.id]; return <th scope="col" key={mode.id}><span className="mode-heading"><Icon size={25}/>{mode.name}</span></th>;})}<th scope="col" className="actions-column"><span className="sr-only">地点操作</span></th></tr></thead><tbody>{destinations.map((d, index) => {
      const color = colorFor(d);
      return <tr key={d.id} className={focusId === d.id ? 'focused-row' : ''}><th scope="row"><button className="destination-name" onClick={() => focusDestination(d.id)} title={d.address}><span className="destination-letter" style={{background: color}}>{letter(index)}</span><span>{d.name}</span></button></th>{MODES.map(mode => {
        const route = results?.[d.id]?.[mode.id], success = route?.status === 'success', selected = d.mode === mode.id && success, unconfigured = mode.id === 'electric' && !mapCapabilities.electricBike, pending = !unconfigured && active && (!route || route.status === 'pending');
        const label = unconfigured ? '电动车路线待接入' : !active ? '请先添加出发地' : success ? distanceLabel(route.distance) + ' · 点击查看路线' : route?.reason || '正在查询';
        return <td key={mode.id}><button type="button" className={'time-cell' + (selected ? ' selected' : '') + (pending ? ' pending' : '') + (route?.status === 'error' ? ' route-error' : '')} style={{'--route-color': color, '--route-tint': color + '20'}} aria-pressed={selected} aria-label={d.name + '，' + mode.name + '，' + (success ? route.minutes + '分钟，' + distanceLabel(route.distance) : label)} disabled={!success} title={label} onClick={() => selectMode(d, mode)}>{unconfigured ? <span className="unsupported-time">待接入</span> : pending ? <span className="loading-dots" aria-label="查询中">···</span> : !active ? <span className="missing-time">—</span> : success ? <>{selected && <Check size={21} weight="bold"/>}<span>{route.minutes}<span className="minutes-unit"> 分钟</span></span></> : <span className="unsupported-time">{route?.status === 'no-route' ? '暂无路线' : '查询失败'}</span>}</button></td>;
      })}<td className="row-actions"><IconButton label={'编辑' + d.name} onClick={() => openEditor('destination', d)}><PencilSimple size={21}/></IconButton><IconButton label={'删除' + d.name} onClick={() => deleteDestination(d)}><X size={21}/></IconButton></td></tr>;
    })}</tbody></table></div>{!destinations.length && <div className="destinations-empty"><MapPin size={29}/><h3>添加一个目的地</h3><p>设置出发地和目的地后，比较不同出行方式的真实路线与预计耗时。</p><button className="primary-button" disabled={!sdk} onClick={() => openEditor('destination')}><Plus size={18}/>添加目的地</button></div>}{!mapCapabilities.electricBike && <p className="mode-availability-note">自行车与电动车分别规划，电动车路线暂未接入。</p>}{routeErrors.length > 0 && <p className="route-error-notice" role="status"><Info size={16}/>{routeErrors[0].reason}，可点击“查询路线”重试。</p>}<div className="sr-only" role="status" aria-live="polite">{loading ? '正在查询路线' : active && destinations.length ? active.name + '的路线查询已结束' : '请设置出发地和目的地'}</div></section>
    <footer className="app-footer"><span>数据来源：高德地图 · 耗时为查询时的预估{batch?.key === requestKey && batch.queriedAt ? ' · ' + new Date(batch.queriedAt).toLocaleTimeString('zh-CN', {hour12: false}) : ''}</span><button onClick={() => setInfoOpen(true)}><Info size={15}/><span>使用说明</span></button></footer>
    {editor && <PlaceEditor key={(editor.id || 'new-' + editor.kind) + (editor.selected?.point?.join(',') || '')} sdk={sdk} city={active?.city} editor={editor} onClose={() => setEditor(null)} onSave={saveEditor} onPick={draft => {setEditor(null); cancelPick(); setPicking({kind: draft.kind, editor: draft});}}/>}
    {infoOpen && <Dialog title="路线查询使用说明" onClose={() => setInfoOpen(false)}><div className="demo-info-icon"><MapTrifold size={30}/></div><p>搜索或在地图上选点，设置一个出发地和多个目的地。添加更多出发地后，点击顶部页签切换，目的地保持不变。</p><p>自行车与电动车分开显示；电动车路线在接入后可查询。点击目的地耗时，可选择该出行方式的备选路线，地图和表格会同步更新。无可用结果时会显示“暂无路线”或失败提示。</p><p>驾车默认使用高德推荐，也可选择躲避拥堵、速度优先、少收费或不走高速。备选条数以高德实际返回为准。预计耗时受路况、班次和服务覆盖范围影响。这里只查询当前出发地，修改地点或重新查询会更新结果。</p><p className="demo-info-small">地点仅保存在当前页面，刷新后会清空。百度与开源方案尚未接入。</p><div className="dialog-actions"><button className="primary-button" onClick={() => setInfoOpen(false)}>知道了</button></div></Dialog>}
    {toast && <div className="toast" role="status"><Check size={18}/><span>{toast.message}</span>{toast.undo && <button onClick={() => {toast.undo(); setToast(null); clearTimeout(toastTimer.current);}}>撤销</button>}<IconButton label="关闭提示" onClick={() => {setToast(null); clearTimeout(toastTimer.current);}}><X size={16}/></IconButton></div>}
  </main>;
}
