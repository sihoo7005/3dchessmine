// Node 22+: node test.mjs http://127.0.0.1:9224
// Start Chromium with --remote-debugging-port=9224 first.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const endpoint=process.argv[2]||'http://127.0.0.1:9224';
const tab=await(await fetch(`${endpoint}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true});});
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{
  const m=JSON.parse(event.data);
  if(m.id){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.fail(new Error(JSON.stringify(m.error))):p.ok(m.result);}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+m.params.exceptionDetails.exception?.description);
});
function cdp(method,params={}){return new Promise((ok,fail)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);fail(new Error(`${method} timed out`));},15000);pending.set(n,{ok,fail,timer});ws.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function navigate(url){await cdp('Page.navigate',{url});for(let attempt=0;attempt<100;attempt++){if(await evaluate('document.readyState === "complete" && !!document.getElementById("stats")?.textContent'))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Game initialization timed out');}
async function screenshot(name){if(!process.env.MINESWEEPER_SCREENSHOT_DIR)return;const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(resolve(process.env.MINESWEEPER_SCREENSHOT_DIR,name),Buffer.from(shot.data,'base64'));}

try{
  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1100,height:1100,deviceScaleFactor:1,mobile:false});
  const path=resolve('3d_minesweeper.html');await navigate(pathToFileURL(path).href);
  assert.equal(await evaluate('document.getElementById("board3d").hidden'),false,'The original HTML must initialize in 3D');
  assert.deepEqual(errors,[]);await screenshot('minesweeper-initial.png');
  const hook=`window.__game={cluePositions,countMines,pickPiece,find3d,find2d,layout2d,center,render3d,tileStyle,reveal,toggleFlag,startGame,setView,draw,resetCamera,cameraBasis,
    setCamera(y,p,d){yaw=y;pitch=p;distance=d;render3d();},
    get state(){return{N,cells,mines,ended,yaw,pitch,distance,visibleCells,vertexCount,view,gl,width,height};}};`;
  const html=(await readFile(path,'utf8')).replace('window.addEventListener("resize",resize);',hook+'window.addEventListener("resize",resize);');
  await navigate('data:text/html;base64,'+Buffer.from(html).toString('base64'));
  const openingValid='(()=>{const g=__game.state,opened=[...g.cells].filter(([k,c])=>c.revealed);return opened.length===1&&!g.mines.has(opened[0][0])&&__game.countMines(opened[0][0].split(",").map(Number),opened[0][1].piece)===0&&g.mines.size===Number(document.getElementById("mineInput").value);})()';
  assert.equal(await evaluate(openingValid),true,'A new game must reveal exactly one safe zero clue');
  assert.deepEqual(await evaluate(`(()=>{const random=Math.random,counts={K:0,R:0};try{for(let i=0;i<1000;i++){Math.random=()=>(i+.5)/1000;counts[__game.pickPiece({K:1,R:3,B:0,Q:0,N:0})]++;}return counts;}finally{Math.random=random;}})()`),{K:250,R:750},'Weights must set relative probabilities and exclude zero weights');
  for(const piece of ['K','R','B','Q','N']){
    await evaluate(`for(const p of ['K','R','B','Q','N'])document.getElementById('weight'+p).value=p===${JSON.stringify(piece)}?1:0;__game.startGame()`);
    assert.equal(await evaluate(`[...__game.state.cells.values()].every(c=>c.piece===${JSON.stringify(piece)})`),true,'Disabled pieces must never be generated');
    assert.equal(await evaluate(openingValid),true);
  }
  for(const bad of ['0','-1','1001','']){
    assert.equal(await evaluate(`(()=>{const old=__game.state.cells;for(const p of ['K','R','B','Q','N'])document.getElementById('weight'+p).value='0';document.getElementById('weightK').value=${JSON.stringify(bad)};document.getElementById('start').click();return __game.state.cells===old&&!!document.getElementById('settingError').textContent;})()`),true,'Invalid weights must keep the current game');
  }
  await evaluate("for(const p of ['K','R','B','Q','N'])document.getElementById('weight'+p).value=p==='R'?1:0;document.getElementById('sizeInput').value=3;document.getElementById('mineInput').value=21");
  assert.equal(await evaluate('(()=>{const old=__game.state.cells;__game.startGame();return __game.state.cells===old&&document.getElementById("settingError").textContent.includes("20개 이하");})()'),true,'An impossible zero opening must be rejected without changing the game');
  await evaluate('document.getElementById("mineInput").value=20;__game.startGame()');
  assert.equal(await evaluate(openingValid),true,'A zero opening must work at the maximum feasible mine count');
  await evaluate("document.getElementById('weightR').value=0;document.getElementById('weightN').value=1;document.getElementById('mineInput').value=26;__game.startGame()");
  assert.equal(await evaluate(openingValid),true);assert.equal(await evaluate('__game.state.ended'),true);
  assert.equal(await evaluate('document.getElementById("layer").value'),'1','An interior-only opening must be visible through its layer');
  await evaluate("for(const p of ['K','R','B','Q','N'])document.getElementById('weight'+p).value=1;document.getElementById('sizeInput').value=6;document.getElementById('mineInput').value=35;__game.startGame()");
  for(let i=0;i<10;i++){await evaluate('__game.startGame()');assert.equal(await evaluate(openingValid),true);}
  assert.equal(await evaluate(`(()=>{const g=__game.state.gl;__game.render3d();const pixels=new Uint8Array(g.drawingBufferWidth*g.drawingBufferHeight*4);g.readPixels(0,0,g.drawingBufferWidth,g.drawingBufferHeight,g.RGBA,g.UNSIGNED_BYTE,pixels);return pixels.some((v,i)=>i%4===3&&v>0)&&g.getError()===g.NO_ERROR;})()`),true,'WebGL must draw nonempty pixels without GL errors');
  assert.equal(await evaluate('__game.state.vertexCount'),216*36);
  await evaluate('document.getElementById("sizeInput").value=5;document.getElementById("mineInput").value=20;__game.startGame()');
  assert.deepEqual(await evaluate('Object.fromEntries(["K","R","B","Q","N"].map(p=>[p,__game.cluePositions([2,2,2],p).length]))'),{K:26,R:12,B:24,Q:36,N:24});
  assert.deepEqual(await evaluate('Object.fromEntries(["K","N"].map(p=>[p,__game.cluePositions([0,0,0],p).length]))'),{K:7,N:6});
  assert.equal(await evaluate(`(()=>{for(const p of ['K','R','B','Q','N'])for(let x=0;x<5;x++)for(let y=0;y<5;y++)for(let z=0;z<5;z++){const a=__game.cluePositions([x,y,z],p),s=new Set(a.map(v=>v.join(',')));if(a.length!==s.size||s.has([x,y,z].join(','))||a.some(v=>v.some(n=>n<0||n>=5)))return false;}return true;})()`),true,'Clues must be unique, bounded and exclude their own cell');
  await evaluate('__game.state.mines.clear();__game.state.mines.add("2,2,3");__game.state.mines.add("3,3,2");__game.state.mines.add("4,3,2")');
  assert.deepEqual(await evaluate('Object.fromEntries(["K","R","B","Q","N"].map(p=>[p,__game.countMines([2,2,2],p)]))'),{K:2,R:1,B:1,Q:2,N:1});
  await evaluate('document.getElementById("sizeInput").value=3;document.getElementById("mineInput").value=3;__game.startGame();for(const c of __game.state.cells.values())c.revealed=false;__game.setCamera(0,0,20)');
  assert.equal(await evaluate('__game.find3d(__game.state.width/2,__game.state.height/2)'),'1,2,1','Ray must hit nearest cube');
  await evaluate('__game.setCamera(Math.PI,0,20)');
  assert.equal(await evaluate('__game.find3d(__game.state.width/2,__game.state.height/2)'),'1,0,1','Ray must follow camera rotation');
  await evaluate('document.getElementById("layer").value="1";document.getElementById("layer").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('__game.state.visibleCells.length'),9,'Layer slicing must expose interior cells');
  assert.equal(await evaluate('__game.state.vertexCount'),9*36);
  await evaluate('__game.state.mines.clear();__game.state.mines.add("0,0,0");__game.setCamera(0,0,20)');
  const point=await evaluate('(()=>{const r=document.getElementById("board3d").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()');
  const mouse=(type,x,y,button='left',buttons=type==='mousePressed'?1:0)=>cdp('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:1});
  await mouse('mousePressed',point.x,point.y,'right',2);await mouse('mouseReleased',point.x,point.y,'right');
  assert.equal(await evaluate('__game.state.cells.get("1,2,1").flagged'),true);
  await mouse('mousePressed',point.x,point.y);await mouse('mouseReleased',point.x,point.y);
  assert.equal(await evaluate('__game.state.cells.get("1,2,1").revealed'),false,'Flag must prevent opening');
  await mouse('mousePressed',point.x,point.y,'right',2);await mouse('mouseReleased',point.x,point.y,'right');
  await mouse('mousePressed',point.x,point.y);await mouse('mouseReleased',point.x,point.y);
  assert.equal(await evaluate('__game.state.cells.get("1,2,1").revealed'),true);
  assert.match(await evaluate('__game.tileStyle("1,2,1",__game.state.cells.get("1,2,1")).text'),/^[♚♜♝♛♞]\n\d+$/);
  await screenshot('minesweeper-revealed.png');
  const beforeDrag=await evaluate('[__game.state.yaw,[...__game.state.cells.values()].filter(c=>c.revealed).length]');
  await mouse('mousePressed',point.x,point.y);await mouse('mouseMoved',point.x+80,point.y+30,'left',1);await mouse('mouseReleased',point.x+80,point.y+30);
  const afterDrag=await evaluate('[__game.state.yaw,[...__game.state.cells.values()].filter(c=>c.revealed).length]');
  assert.notEqual(afterDrag[0],beforeDrag[0]);assert.equal(afterDrag[1],beforeDrag[1],'Dragging must not open a cell');
  const beforeZoom=await evaluate('__game.state.distance');
  await cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:0,deltaY:-150});
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  assert.ok(await evaluate('__game.state.distance')<beforeZoom);
  await evaluate('document.getElementById("view2d").click()');
  assert.equal(await evaluate('__game.state.view'),'2d');assert.equal(await evaluate('__game.state.cells.get("1,2,1").revealed'),true);
  const flatPoint=await evaluate('(()=>{const r=document.getElementById("board").getBoundingClientRect(),{s,left,top}=__game.layout2d();return{x:r.left+left+2.5*s,y:r.top+top+.92*s};})()');
  await mouse('mousePressed',flatPoint.x,flatPoint.y);await mouse('mouseReleased',flatPoint.x,flatPoint.y);
  assert.equal(await evaluate('__game.state.cells.get("2,0,0").revealed'),true,'2D clicks must open their own cell');
  await screenshot('minesweeper-2d.png');
  await evaluate('document.getElementById("sizeInput").value=11;document.getElementById("start").click()');
  assert.equal(await evaluate('__game.state.N'),3);assert.notEqual(await evaluate('document.getElementById("settingError").textContent'),'');
  await evaluate('document.getElementById("sizeInput").value=3;document.getElementById("mineInput").value=27;document.getElementById("start").click()');
  assert.equal(await evaluate('__game.state.N'),3);assert.notEqual(await evaluate('document.getElementById("settingError").textContent'),'');
  await evaluate('document.getElementById("mineInput").value=1;__game.startGame();for(const c of __game.state.cells.values())c.revealed=false;__game.state.mines.clear();__game.state.mines.add("0,0,0");for(const k of __game.state.cells.keys())if(k!=="0,0,0")__game.reveal(k)');
  assert.equal(await evaluate('__game.state.ended'),true);assert.match(await evaluate('document.getElementById("message").textContent'),/성공/);
  await evaluate('__game.startGame();for(const c of __game.state.cells.values())c.revealed=false;__game.state.mines.clear();__game.state.mines.add("0,0,0");__game.reveal("0,0,0")');
  assert.equal(await evaluate('__game.state.ended'),true);assert.match(await evaluate('document.getElementById("message").textContent'),/지뢰를 밟/);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  await evaluate('document.getElementById("sizeInput").value=6;document.getElementById("mineInput").value=35;__game.startGame();__game.setView("3d");__game.resetCamera()');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true,'Mobile page must fit its width');
  const mobile=await evaluate('(()=>{const r=document.getElementById("board3d").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()');
  const mobileBefore=await evaluate('[__game.state.yaw,__game.state.distance,[...__game.state.cells.values()].filter(c=>c.revealed).length]');
  await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobile.x,y:mobile.y,id:1}]});
  await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobile.x+50,y:mobile.y+20,id:1}]});
  await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.notEqual(await evaluate('__game.state.yaw'),mobileBefore[0]);
  await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobile.x-30,y:mobile.y,id:1},{x:mobile.x+30,y:mobile.y,id:2}]});
  await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobile.x-65,y:mobile.y,id:1},{x:mobile.x+65,y:mobile.y,id:2}]});
  await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await evaluate('__game.state.distance')<mobileBefore[1]);assert.equal(await evaluate('[...__game.state.cells.values()].filter(c=>c.revealed).length'),mobileBefore[2],'Touch rotation and pinch must not reveal cells');
  await evaluate('__game.resetCamera()');await screenshot('minesweeper-mobile.png');
  await evaluate('document.getElementById("sizeInput").value=10;document.getElementById("mineInput").value=150;__game.startGame()');
  assert.equal(await evaluate('__game.state.vertexCount'),1000*36);assert.equal(await evaluate('__game.state.gl.getError()'),0);
  await evaluate('__game.state.gl.getExtension("WEBGL_lose_context").loseContext()');
  for(let i=0;i<50;i++){if(await evaluate('__game.state.view === "2d"'))break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(await evaluate('__game.state.view'),'2d');assert.equal(await evaluate('document.getElementById("board").hidden'),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: piece weights, disabled pieces, guaranteed zero openings, impossible settings, original initialization, WebGL pixels, chess clues, 3D ray picking, layers, flags, reveal, rotation, zoom, 2D state, validation, win/loss, mobile touch, 1000 cubes, context-loss fallback.');
}finally{
  ws.close();await fetch(`${endpoint}/json/close/${tab.id}`);
}
