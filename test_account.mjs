import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('account.js','utf8');
class Element {
  constructor(tag=''){this.tag=tag;this.children=[];this.hidden=false;this.listeners={};this.style={};this.textContent='';}
  setAttribute(){} append(...nodes){this.children.push(...nodes)} prepend(...nodes){this.children.unshift(...nodes)} replaceChildren(...nodes){this.children=nodes} addEventListener(name,fn){this.listeners[name]=fn}
}
async function run(authenticated, failFirstSession=false){
  const area=new Element(),events={},calls=[];let failNext=false;
  const window={addEventListener(name,fn){events[name]=fn}};let reloaded=false;
  const document={createElement:tag=>new Element(tag),getElementById:()=>area};
  const fetch=async(url,options={})=>{calls.push({url,options});if(url==='api/session'){if(failFirstSession){failFirstSession=false;return{ok:false}}return{ok:true,json:async()=>({authenticated,name:'User',csrfToken:'token'})}};if(url==='api/records'&&options.method==='POST'){if(failNext){failNext=false;return{ok:false}}return{ok:true}};return{ok:true,json:async()=>({records:[]})}};
  const crypto={randomUUID:()=> 'a8ddc11e-7077-4111-9c8d-844761443756'};
  const context={window,document,location:{pathname:'/chessmine/3d_minesweeper.html',search:'?mode=no-guess',reload(){reloaded=true}},fetch,crypto,Date,String,confirm:()=>true,globalThis:{crypto}};
  vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  return {area,events,calls,get reloaded(){return reloaded},failNext(){failNext=true}};
}
const app=await run(true);const panel=app.area.children[0];assert.equal(panel.hidden,false);
app.events['chessmine:game-finished']({detail:{mode:'normal',size:3,mines:2,weights:{K:7,R:1,B:1,Q:1,N:1},result:'won',durationMs:1234}});
await new Promise(resolve=>setImmediate(resolve));
const firstPost=app.calls.find(call=>call.options.method==='POST');assert.equal(firstPost.url,'api/records');
assert.equal(firstPost.options.headers['X-CSRFToken'],'token');assert.equal(JSON.parse(firstPost.options.body).result,'won');
app.failNext();app.events['chessmine:game-finished']({detail:{mode:'normal'}});await new Promise(resolve=>setImmediate(resolve));
const retry=panel.children.find(child=>child.textContent==='기록 저장 다시 시도');assert.equal(retry.hidden,false);
await retry.listeners.click();assert.equal(retry.hidden,true);
const deleteButton=panel.children.find(child=>child.textContent==='계정 및 기록 삭제');await deleteButton.listeners.click();
const deleteCall=app.calls.find(call=>call.url==='api/account/delete');assert.equal(deleteCall.options.headers['X-CSRFToken'],'token');assert.equal(app.reloaded,true);
const guest=await run(false);guest.events['chessmine:game-finished']({detail:{mode:'normal'}});await new Promise(resolve=>setImmediate(resolve));
assert.equal(guest.calls.filter(call=>call.options.method==='POST').length,0,'Guests must not send game records');
const disconnected=await run(true,true),disconnectedPanel=disconnected.area.children[0];
assert.equal(disconnectedPanel.hidden,false);const reconnect=disconnectedPanel.children.find(child=>child.textContent==='계정 다시 연결');assert.equal(reconnect.hidden,false);
disconnected.events['chessmine:game-finished']({detail:{mode:'normal'}});await reconnect.listeners.click();await new Promise(resolve=>setImmediate(resolve));
assert.equal(disconnected.calls.filter(call=>call.options.method==='POST').length,1,'A result awaiting session verification should be sent after reconnecting');
console.log('Verified account session, record save, retry and guest behavior');
