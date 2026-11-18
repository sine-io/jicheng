export const COLORS = ['#1680ff', '#ff8914', '#29b538', '#9867d8', '#e05c83', '#0a9f99', '#a47529', '#4668d2'];
export const MODES = [
  {id: 'driving', name: '驾车', short: '驾车'},
  {id: 'transit', name: '公交·地铁', short: '公交'},
  {id: 'cycling', name: '自行车', short: '自行车'},
  {id: 'electric', name: '电动车', short: '电动车'},
  {id: 'walking', name: '步行', short: '步行'},
];
// JS Driving uses the v3 direction strategy values (not the v5 numbering).
export const DRIVING_POLICIES = [
  {id: 10, name: '高德推荐'},
  {id: 12, name: '躲避拥堵'},
  {id: 0, name: '速度优先'},
  {id: 14, name: '少收费'},
  {id: 13, name: '不走高速'},
];
export const PROVIDERS = [
  {id: 'amap', name: '高德', description: '真实地图、地点搜索与路线规划', configured: true},
  {id: 'baidu', name: '百度', description: '尚未接入', configured: false},
  {id: 'open', name: '开源方案', description: '尚未接入', configured: false},
];
export function letter(index) {
  let text = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text;
  return text;
}
export function colorFor(destination) { return COLORS[destination.color % COLORS.length]; }
export function distanceLabel(meters) { return meters >= 1000 ? (meters / 1000).toFixed(1) + ' 公里' : Math.round(meters) + ' 米'; }
