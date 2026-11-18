import {Check, X} from '@phosphor-icons/react';
import {distanceLabel} from './model';
export default function RouteOptions({destination, mode, result, policyName, onSelect, onClose}) {
  const routes = result.alternatives || [result];
  return <section className="route-options-panel" aria-label={destination.name + '的备选路线'}>
    <div className="route-options-heading"><div><h2>{destination.name}<span>· {mode.name}{mode.id === 'driving' ? ' · ' + policyName : ''}</span></h2><p>{routes.length > 1 ? '共 ' + routes.length + ' 条可选路线，点击后在地图上查看' : '高德本次仅返回 1 条可用路线'}</p></div><button className="icon-button" aria-label="收起备选路线" title="收起备选路线" onClick={onClose}><X size={20}/></button></div>
    <div className="route-option-cards">{routes.map((route, index) => <button type="button" className={'route-option-card' + (route.id === result.id ? ' active' : '')} key={route.id || index} aria-pressed={route.id === result.id} onClick={() => onSelect(route.id)}><span className="route-option-title">方案 {route.providerIndex == null ? index + 1 : route.providerIndex + 1}{route.id === result.id && <Check size={18} weight="bold"/>}</span><strong>{route.minutes}<span> 分钟</span></strong><span className="route-option-metrics">{distanceLabel(route.distance)}{route.tolls != null ? ' · 过路费约 ' + route.tolls + ' 元' : ''}</span><small>{route.summary || '高德返回的规划路线'}</small></button>)}</div>
  </section>;
}
