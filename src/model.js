// Fictional image-pixel positions, never geographic coordinates.
export const MAP_SIZE = [2048, 768];
export const COLORS = ['#1680ff','#ff8914','#29b538','#9867d8','#e05c83','#0a9f99','#a47529','#4668d2'];
export const MODES = [{id:'driving',name:'驾车',short:'驾车'},{id:'transit',name:'公交·地铁',short:'公交'},{id:'cycling',name:'骑行',short:'骑行'},{id:'walking',name:'步行',short:'步行'}];
export const PROVIDERS = [{id:'baidu',name:'百度',description:'地点搜索、四种出行方式',transit:true},{id:'amap',name:'高德',description:'地点搜索、四种出行方式',transit:true},{id:'open',name:'开源方案',description:'公交数据尚未接入',transit:false}];
export const INITIAL_ORIGINS = [{id:'o1',name:'出发地 1',point:[1050,600]},{id:'o2',name:'出发地 2',point:[900,200]},{id:'o3',name:'出发地 3',point:[1400,430]}];
export const INITIAL_DESTINATIONS = [{id:'d1',name:'目的地 A',point:[260,220],color:0,mode:'driving'},{id:'d2',name:'目的地 B',point:[1590,180],color:1,mode:'transit'},{id:'d3',name:'目的地 C',point:[400,550],color:2,mode:'walking'}];
export const CATALOG = [...INITIAL_ORIGINS,...INITIAL_DESTINATIONS,{id:'p1',name:'示例地点 01',point:[700,330]},{id:'p2',name:'示例地点 02',point:[1150,380]},{id:'p3',name:'示例地点 03',point:[820,620]},{id:'p4',name:'示例地点 04',point:[1550,370]}];
export function copyPlaces(places) { return places.map(p=>({...p,point:[...p.point]})); }
export function letter(index) { let text=''; for(let n=index+1;n>0;n=Math.floor((n-1)/26)) text=String.fromCharCode(65+(n-1)%26)+text; return text; }
export function samePoint(a,b) { return Math.hypot(a[0]-b[0],a[1]-b[1])<1; }
export function colorFor(d) { return COLORS[d.color%COLORS.length]; }
const BRANCHES = [
 [[1050,600],[1070,540],[1100,485],[1110,440],[1100,410],[1080,380],[1040,330],[1000,285],[950,235],[900,200],[850,260],[800,300],[700,330],[600,340],[500,365],[400,410],[350,420],[340,365],[330,330],[315,290],[290,260],[260,220]],
 [[1100,410],[1150,380],[1200,380],[1300,395],[1400,430],[1500,450],[1550,370],[1580,300],[1590,250],[1590,180]],
 [[1050,600],[1010,650],[920,650],[820,620],[770,560],[710,510],[600,480],[500,510],[400,550]]
];
const key=p=>p[0]+':'+p[1];
const points=new Map(), graph=new Map();
BRANCHES.forEach(branch=>branch.forEach((p,i)=>{const k=key(p);points.set(k,p);if(!graph.has(k))graph.set(k,[]);if(i){const q=branch[i-1],before=key(q),w=Math.hypot(p[0]-q[0],p[1]-q[1]);graph.get(k).push([before,w]);graph.get(before).push([k,w]);}}));
function nearest(p) { let best=null,dist=Infinity; for(const [k,q] of points){const d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<dist){best=k;dist=d;}}return best; }
export function routePath(start,end) {
 if(samePoint(start,end))return [start,end];
 const from=nearest(start),to=nearest(end),dist=new Map([[from,0]]),prev=new Map(),queue=new Set(points.keys());
 while(queue.size){let node=null,best=Infinity;for(const k of queue)if((dist.get(k)??Infinity)<best){node=k;best=dist.get(k);}if(node===null||node===to)break;queue.delete(node);for(const [next,w] of graph.get(node))if(best+w<(dist.get(next)??Infinity)){dist.set(next,best+w);prev.set(next,node);}}
 const seq=[to];while(seq[0]!==from&&prev.has(seq[0]))seq.unshift(prev.get(seq[0]));
 return [start,...seq.map(k=>points.get(k)),end].filter((p,i,a)=>!i||!samePoint(p,a[i-1]));
}
const FIXTURES=[[[28,48,36,115],[22,42,32,95],[6,18,5,12]],[[17,34,21,68],[31,56,47,142],[11,26,15,42]],[[36,64,48,152],[12,23,16,48],[18,38,27,82]]];
export function computeResults(origin,destinations,provider){
 const oi=INITIAL_ORIGINS.findIndex(p=>samePoint(p.point,origin.point)),result={};
 for(const d of destinations){const path=routePath(origin.point,d.point);const km=path.reduce((sum,p,i)=>i?sum+Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1]):0,0)*.004;const di=INITIAL_DESTINATIONS.findIndex(p=>samePoint(p.point,d.point));const fixed=oi>=0&&di>=0?FIXTURES[oi][di]:null;result[d.id]={};
 MODES.forEach((m,i)=>{if(m.id==='transit'&&!provider.transit){result[d.id][m.id]={supported:false,path,reason:'开源方案尚未接入公交数据'};return;}const times=[Math.max(1,Math.round(km/26*60+3)),Math.max(1,Math.round(km/18*60+12)),Math.max(1,Math.round(km/14*60)),Math.max(1,Math.round(km/4.5*60))];result[d.id][m.id]={supported:true,minutes:samePoint(origin.point,d.point)?0:fixed?fixed[i]:times[i],distance:km,path};});}
 return result;
}
