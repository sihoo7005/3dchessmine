import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync('3d_minesweeper.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('window.addEventListener("resize",resize);','window.__game={get state(){return {cells,mines,ended,hintKey,selectedClue,selectedClosed,clueRange,yaw,distance};},countMines,inferMoves,activate,tileStyle,layout2d,showHint,setFind3d(fn){find3d=fn;},setInference(fn){inferMoves=fn;},setCluePositions(fn){cluePositions=fn;},setRandom(fn){Math.random=fn;}};window.addEventListener("resize",resize);');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
function page(search){
  const ctx2d=new Proxy({}, {get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
  class Element{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.listeners={};this.children=[];this.style={};this.classList={toggle(){},add(){},remove(){}};}
    addEventListener(name,fn){this.listeners[name]=fn;}
    click(){this.listeners.click?.({});}
    setAttribute(){} replaceChildren(...children){this.children=children;if(this.id==='layer')this.value=children[0]?.value??'';} append(...children){this.children.push(...children);} add(){} setPointerCapture(){} focus(){} showModal(){this.open=true;} close(){this.open=false;}
    getContext(kind){return kind==='2d'?ctx2d:null;} getBoundingClientRect(){return{width:800,height:600,left:0,top:0};}
  }
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  elements.sizeInput.value='3';elements.mineInput.value='2';elements.spacing.value='1.3';elements.layer.value='all';
  for(const piece of ['K','R','B','Q','N'])elements['weight'+piece].value=html.match(new RegExp(`id="weight${piece}"[^>]*value="([^"]+)"`))[1];
  const urls=new Map();let nextUrl=0,workers=0;
  class FakeBlob{constructor(parts){this.text=parts.join('');}}
  const fakeURL={createObjectURL(blob){const id=String(++nextUrl);urls.set(id,blob.text);return id;},revokeObjectURL(id){urls.delete(id);}};
  class FakeWorker{
    constructor(url){this.source=urls.get(url);this.terminated=false;workers++;}
    terminate(){this.terminated=true;}
    postMessage(data){setTimeout(()=>{if(this.terminated)return;const worker={postMessage:message=>{if(!this.terminated)this.onmessage?.({data:message});}};try{vm.runInNewContext(this.source,worker);worker.onmessage({data});}catch(error){this.onerror?.(error);}},0);}
  }
  let tick=0;const window={devicePixelRatio:1,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};
  const document={getElementById:id=>elements[id],createElement:tag=>new Element(tag),title:''};
  const globals={window,document,location:{search},URLSearchParams,URL:fakeURL,Blob:FakeBlob,Worker:FakeWorker,Option:class{constructor(text,value){this.text=text;this.value=value;}},setTimeout,clearTimeout,performance:{now:()=>tick},console:{error(){}}};
  vm.runInNewContext(script,globals);
  return{window,elements,advance(ms){tick+=ms;},get workers(){return workers;}};
}

const original=page('');
assert.equal(original.workers,0);assert.equal(original.window.__game.state.cells.size,27);
assert.equal(original.elements.weightK.value,'10');for(const piece of ['R','B','Q','N'])assert.equal(original.elements['weight'+piece].value,'1');
const boardBeforeHelp=original.window.__game.state.cells;original.elements.helpButton.click();assert.equal(original.elements.helpDialog.open,true,'Help must open as a dialog');
original.window.listeners.keydown({key:'r',target:{matches:()=>false}});assert.equal(original.window.__game.state.cells,boardBeforeHelp,'Game shortcuts must not run while help is open');
original.elements.helpClose.click();assert.equal(original.elements.helpDialog.open,false,'The help dialog must close');assert.equal(original.window.__game.state.cells,boardBeforeHelp);
const game=page('?mode=no-guess');
assert.equal(game.elements.start.disabled,true);assert.equal(game.window.__game.state.cells.size,0);
for(let i=0;i<100&&game.elements.start.disabled;i++)await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(game.elements.start.disabled,false);assert.match(game.elements.boardInfo.textContent,/추측 없이/);
game.elements.helpButton.click();assert.equal(game.elements.helpDialog.open,true);game.elements.helpClose.click();assert.equal(game.elements.helpDialog.open,false);
const state=game.window.__game.state,opened=[...state.cells].filter(([,cell])=>cell.revealed);
assert.equal(state.cells.size,27);assert.equal(opened.length,1);assert.equal(state.mines.size,2);
assert.equal(game.window.__game.countMines(opened[0][0].split(',').map(Number),opened[0][1].piece),0);
game.elements.start.click();game.elements.cancelGeneration.click();
assert.equal(game.elements.start.disabled,false);assert.match(game.elements.message.textContent,/취소/);
assert.equal(game.window.__game.state.cells,state.cells);
function setBoard(p,mineIds){const s=p.window.__game.state;for(const cell of s.cells.values()){cell.revealed=false;cell.flagged=false;cell.piece='K';}s.mines.clear();for(const id of mineIds)s.mines.add(id);s.cells.get('0,0,0').revealed=true;return s;}
for(const p of [original,game]){
  const s=setBoard(p,['0,0,1','2,2,2']),app=p.window.__game,clue='0,0,0',target='0,1,0';
  app.activate(clue,false);
  assert.equal(app.state.clueRange.size,7);assert.ok(app.state.clueRange.has('0,0,1'));assert.equal(app.tileStyle(target,s.cells.get(target)).fill,'#438c80');
  assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'Selecting a clue must not open its range');
  app.activate(clue,false);
  assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'A different flag count must not open cells');
  app.activate('0,0,1',true);app.activate(clue,false);app.activate(clue,false);
  assert.equal([...s.cells.values()].filter(c=>c.revealed).length,7,'A matching flag count must open the six remaining neighbors');
  assert.equal(s.cells.get('0,0,1').flagged,true);assert.equal(s.cells.get('2,2,2').revealed,false);
}
for(const p of [page(''),game]){
  const s=setBoard(p,['0,0,1','2,2,2']),app=p.window.__game,canvas=p.elements.board,{cols,s:scale,left,top}=app.layout2d();
  function tap2d(x,y,z,button=0){const event={pointerId:5,button,clientX:left+(z%cols)*(3+.58)*scale+(x+.5)*scale,clientY:top+Math.floor(z/cols)*(3+.42+.3)*scale+(.42+y+.5)*scale};canvas.listeners.pointerdown(event);canvas.listeners.pointerup(event);}
  p.elements.flagMode.click();tap2d(0,0,1);
  assert.equal(s.cells.get('0,0,1').flagged,true,'A closed cell must still toggle a flag in flag mode');
  tap2d(0,0,0);assert.equal(app.state.selectedClue,'0,0,0');assert.equal(app.state.clueRange.size,7);
  p.advance(451);tap2d(0,0,0);assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'Slow taps must not chord in flag mode');
  tap2d(0,0,0);assert.equal([...s.cells.values()].filter(c=>c.revealed).length,7,'Two quick taps must chord an opened clue in flag mode');
  assert.equal(s.cells.get('0,0,1').flagged,true);
}
const flag3dPage=page(''),flag3d=setBoard(flag3dPage,['0,0,1','2,2,2']);let picked='0,0,1';
flag3dPage.window.__game.setFind3d(()=>picked);flag3dPage.elements.flagMode.click();
const flag3dEvent={pointerId:8,button:0,clientX:400,clientY:300};
function tap3d(event=flag3dEvent){flag3dPage.elements.board3d.listeners.pointerdown(event);flag3dPage.elements.board3d.listeners.pointerup(event);}
tap3d();assert.equal(flag3d.cells.get('0,0,1').flagged,true);picked='0,0,0';tap3d();
assert.equal(flag3dPage.window.__game.state.clueRange.size,7);tap3d();assert.equal([...flag3d.cells.values()].filter(c=>c.revealed).length,7);
const zeroPage=page(''),zero=setBoard(zeroPage,['2,2,1','2,2,2']);
zeroPage.window.__game.activate('0,0,0',false);zeroPage.window.__game.activate('0,0,0',false);
assert.equal([...zero.cells.values()].filter(c=>c.revealed).length,8,'A zero clue must open its entire unflagged range');
for(const p of [page(''),game]){
  const s=setBoard(p,['2,2,1','2,2,2']);s.cells.get('1,1,0').flagged=true;
  const canvas=p.elements.board,event={pointerId:12,button:0,clientX:1,clientY:1};
  function backgroundTap(){canvas.listeners.pointerdown(event);canvas.listeners.pointerup(event);}
  backgroundTap();assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'One background tap must not expand');
  p.advance(451);backgroundTap();assert.equal([...s.cells.values()].filter(c=>c.revealed).length,1,'Slow background taps must not expand');
  backgroundTap();assert.equal(s.cells.get('0,0,2').revealed,true,'Quick background taps must recursively expand zero clues across layers');
  assert.equal(s.cells.get('1,1,0').flagged,true);assert.equal(s.cells.get('1,1,0').revealed,false,'Expansion must leave flagged cells closed');
  for(const id of s.mines)assert.equal(s.cells.get(id).revealed,false,'Zero expansion must not open a mine');
}
const background3dPage=page(''),background3d=setBoard(background3dPage,['2,2,1','2,2,2']);background3d.cells.get('1,1,0').flagged=true;background3dPage.window.__game.setFind3d(()=>null);
const background3dEvent={pointerId:13,button:0,clientX:10,clientY:10};
for(let i=0;i<2;i++){background3dPage.elements.board3d.listeners.pointerdown(background3dEvent);background3dPage.elements.board3d.listeners.pointerup(background3dEvent);}
assert.equal(background3d.cells.get('0,0,2').revealed,true,'Double tapping empty 3D space must expand zero clues');
const nonzeroPage=page(''),nonzero=setBoard(nonzeroPage,['0,0,1','2,2,2']);nonzeroPage.window.__game.activate(null,false);nonzeroPage.window.__game.activate(null,false);
assert.equal([...nonzero.cells.values()].filter(c=>c.revealed).length,1,'Hidden zero clues must not be expanded');
const chainPage=page(''),chain=setBoard(chainPage,['2,2,1','2,2,2']),chainMap=new Map([['0,0,0',['1,0,0']],['1,0,0',['2,0,0']],['2,0,0',['2,2,2']]]);
chainPage.window.__game.setCluePositions(pos=>(chainMap.get(pos.join(','))||[]).map(id=>id.split(',').map(Number)));
chainPage.window.__game.activate(null,false);chainPage.window.__game.activate(null,false);
assert.equal(chain.cells.get('1,0,0').revealed,true);assert.equal(chain.cells.get('2,0,0').revealed,true,'New zero clues must continue the chain');
assert.equal(chain.cells.get('1,1,1').revealed,false,'Expansion must stop beyond a nonzero clue');
const backgroundWinPage=page(''),backgroundWin=setBoard(backgroundWinPage,['2,2,1','2,2,2']);
for(const[id,cell]of backgroundWin.cells)if(!backgroundWin.mines.has(id))cell.revealed=id!=='0,1,0';
backgroundWinPage.window.__game.activate(null,false);backgroundWinPage.window.__game.activate(null,false);
assert.equal(backgroundWinPage.window.__game.state.ended,true);assert.equal(backgroundWinPage.elements.successEffect.hidden,false,'Expansion must trigger success when it opens the final safe cell');backgroundWinPage.elements.start.click();
for(const newPage of [page(''),game]){
const newBoard=setBoard(newPage,['2,2,1','2,2,2']);
newPage.window.__game.activate('0,0,1',false);
assert.equal(newBoard.cells.get('0,0,1').revealed,false,'A single tap must not open a closed cell');
assert.equal(newPage.window.__game.state.selectedClosed,'0,0,1');
newPage.advance(451);newPage.window.__game.activate('0,0,1',false);
assert.equal(newBoard.cells.get('0,0,1').revealed,false,'Slow taps must not open a closed cell');
newPage.window.__game.activate('0,0,1',false);
assert.equal(newBoard.cells.get('0,0,1').revealed,true,'A quick second tap must open the cell');
assert.equal(newPage.window.__game.state.selectedClue,null,'Opening a cell must not select its movement range');assert.equal(newPage.window.__game.state.clueRange.size,0);
newPage.window.__game.activate('0,0,1',false);assert.equal(newPage.window.__game.state.selectedClue,'0,0,1');assert.ok(newPage.window.__game.state.clueRange.size>0,'A later tap on the opened piece must show its range');
newPage.advance(451);newPage.window.__game.activate('0,0,1',false);
assert.equal([...newBoard.cells.values()].filter(c=>c.revealed).length,2,'Slow taps must not chord a clue');
newPage.window.__game.activate('0,0,1',false);
assert.ok([...newBoard.cells.values()].filter(c=>c.revealed).length>2,'A quick second tap on an opened zero clue must open its range');
}
const wrongPage=page(''),wrong=setBoard(wrongPage,['0,0,1','2,2,2']);
wrongPage.window.__game.activate('0,1,0',true);wrongPage.window.__game.activate('0,0,0',false);wrongPage.window.__game.activate('0,0,0',false);
assert.equal(wrongPage.window.__game.state.ended,true);assert.equal(wrong.cells.get('0,0,1').revealed,true,'An incorrect flag must not protect another mine');
assert.equal(wrongPage.elements.successEffect.hidden,true,'Losing must not show the success effect');
assert.equal(wrongPage.window.__game.tileStyle('0,0,1',wrong.cells.get('0,0,1')).text,'✹','A lost game must still show mines');
const successNoGuess=page('?mode=no-guess');
for(let i=0;i<100&&successNoGuess.elements.start.disabled;i++)await new Promise(resolve=>setTimeout(resolve,50));
for(const p of [page(''),successNoGuess]){
  const s=setBoard(p,['0,0,1','2,2,2']);for(const[id,cell]of s.cells)if(!s.mines.has(id))cell.revealed=id!=='0,1,0';
  s.cells.get('0,0,1').flagged=true;p.window.__game.activate('0,0,0',false);p.window.__game.activate('0,0,0',false);
  assert.equal(p.window.__game.state.ended,true);assert.equal(p.elements.successEffect.hidden,false,'Winning by chord must show the success effect');
  for(const id of s.mines){const style=p.window.__game.tileStyle(id,s.cells.get(id));assert.equal(style.text,'✿','Every mine, including flagged mines, must become a flower on success');assert.equal(style.fill,'#405f57');}
  p.elements.start.click();assert.equal(p.elements.successEffect.hidden,true,'Starting a new game must dismiss the success effect');
  for(let i=0;i<100&&p.elements.start.disabled;i++)await new Promise(resolve=>setTimeout(resolve,50));
  const next=p.window.__game.state,nextMine=[...next.mines][0];assert.equal(p.window.__game.tileStyle(nextMine,next.cells.get(nextMine)).text,'','A new game must hide its mines again');
}
const directWinPage=page(''),directWin=setBoard(directWinPage,['0,0,1','2,2,2']);
for(const[id,cell]of directWin.cells)if(!directWin.mines.has(id))cell.revealed=id!=='0,1,0';
directWinPage.window.__game.activate('0,1,0',false);directWinPage.window.__game.activate('0,1,0',false);
assert.equal(directWinPage.elements.successEffect.hidden,false,'Opening the final safe cell must show the success effect');directWinPage.elements.start.click();
const flatPage=page(''),flat=setBoard(flatPage,['2,2,1','2,2,2']),layout=flatPage.window.__game.layout2d();
const flatEvent={pointerId:1,button:0,clientX:layout.left+1.5*layout.s,clientY:layout.top+1.92*layout.s};
const threePage=page(''),three=setBoard(threePage,['2,2,1','2,2,2']);threePage.window.__game.setFind3d(()=> '1,1,0');
const threeEvent={pointerId:2,button:0,clientX:400,clientY:300};
flatPage.window.__game.activate('1,1,0',false);threePage.window.__game.activate('1,1,0',false);
flatPage.elements.board.listeners.pointerdown(flatEvent);threePage.elements.board3d.listeners.pointerdown(threeEvent);
await new Promise(resolve=>setTimeout(resolve,550));
flatPage.elements.board.listeners.pointerup(flatEvent);threePage.elements.board3d.listeners.pointerup(threeEvent);
for(const s of [flat,three]){assert.equal(s.cells.get('1,1,0').flagged,true,'A long press must toggle a flag');assert.equal(s.cells.get('1,1,0').revealed,false,'Releasing a long press must not open the cell');}
const dragPage=page(''),drag=setBoard(dragPage,['2,2,1','2,2,2']);dragPage.window.__game.setFind3d(()=> '1,1,0');
dragPage.elements.board3d.listeners.pointerdown(threeEvent);dragPage.elements.board3d.listeners.pointermove({...threeEvent,clientX:420});
const flatDragPage=page(''),flatDrag=setBoard(flatDragPage,['2,2,1','2,2,2']);
flatDragPage.elements.board.listeners.pointerdown(flatEvent);flatDragPage.elements.board.listeners.pointermove({...flatEvent,clientX:flatEvent.clientX+20});
const pinchPage=page(''),pinch=setBoard(pinchPage,['2,2,1','2,2,2']);pinchPage.window.__game.setFind3d(()=> '1,1,0');
const beforeDistance=pinchPage.window.__game.state.distance,secondFinger={...threeEvent,pointerId:3,clientX:440};
pinchPage.elements.board3d.listeners.pointerdown(threeEvent);pinchPage.elements.board3d.listeners.pointerdown(secondFinger);
pinchPage.elements.board3d.listeners.pointermove({...secondFinger,clientX:480});
await new Promise(resolve=>setTimeout(resolve,550));dragPage.elements.board3d.listeners.pointerup({...threeEvent,clientX:420});
flatDragPage.elements.board.listeners.pointerup({...flatEvent,clientX:flatEvent.clientX+20});
pinchPage.elements.board3d.listeners.pointerup({...secondFinger,clientX:480});pinchPage.elements.board3d.listeners.pointerup(threeEvent);
assert.equal(drag.cells.get('1,1,0').flagged,false,'Dragging must cancel the long press');assert.notEqual(dragPage.window.__game.state.yaw,.72);
assert.equal(flatDrag.cells.get('1,1,0').flagged,false,'Moving in 2D must cancel the long press');
assert.equal(pinch.cells.get('1,1,0').flagged,false,'Pinching must cancel the long press');assert.ok(pinchPage.window.__game.state.distance<beforeDistance);
const hintPage=page(''),hintBoard=setBoard(hintPage,['0,0,1','2,2,2']),hintApp=hintPage.window.__game,hintCell='0,0,1';
hintApp.setInference(()=>({moves:[{key:hintCell,mine:true}],conflict:false}));hintApp.showHint();
const mineStyle=JSON.stringify(hintApp.tileStyle(hintCell,hintBoard.cells.get(hintCell))),mineMessage=hintPage.elements.cellInfo.textContent;
hintApp.setInference(()=>({moves:[{key:hintCell,mine:false}],conflict:false}));hintApp.showHint();
assert.equal(JSON.stringify(hintApp.tileStyle(hintCell,hintBoard.cells.get(hintCell))),mineStyle,'Mine and safe hints must look identical');
assert.equal(hintPage.elements.cellInfo.textContent,mineMessage,'Mine and safe hints must use the same message');
assert.doesNotMatch(mineMessage,/지뢰|안전|깃발/);
hintApp.setRandom(()=>.9);hintApp.setInference(()=>({moves:[{key:hintCell,mine:true},{key:'1,1,0',mine:false}],conflict:false}));hintApp.showHint();
assert.equal(hintApp.state.hintKey,hintCell,'Hints must not prefer safe cells over mines');
hintApp.setInference(()=>({moves:[{key:'1,1,0',mine:false,sources:['0,0,0','0,1,0']},{key:hintCell,mine:true,sources:['0,0,0'],method:'direct'}],conflict:false}));hintApp.showHint();
assert.equal(hintApp.state.hintKey,hintCell,'Hints with fewer source clues must be preferred independently of their type');
hintPage.elements.hintEvidence.children[0].children[0].click();
assert.equal(hintApp.tileStyle(hintCell,hintBoard.cells.get(hintCell)).fill,'#438c80');assert.equal(hintApp.tileStyle(hintCell,hintBoard.cells.get(hintCell)).text,'·');
const proofPage=page(''),proofBoard=setBoard(proofPage,['2,2,1','2,2,2']),proofApp=proofPage.window.__game;
proofApp.showHint();assert.equal(proofPage.elements.hintExplanation.hidden,false);
assert.equal(proofApp.tileStyle('0,0,0',proofBoard.cells.get('0,0,0')).fill,'#364b5d','A related clue must be subtly highlighted');
assert.equal(proofApp.tileStyle(proofApp.state.hintKey,proofBoard.cells.get(proofApp.state.hintKey)).fill,'#5b6d84','The target must keep its neutral hint color');
assert.match(proofPage.elements.hintExplanationSummary.textContent,/숫자와 깃발 수/);
const proofRow=proofPage.elements.hintEvidence.children[0];assert.match(proofRow.children[0].textContent,/0 − 0 = 0/);assert.match(proofRow.children[1].textContent,/\[힌트\]/);
const savedHint=proofApp.state.hintKey;proofRow.children[0].click();assert.equal(proofApp.state.selectedClue,'0,0,0');assert.equal(proofApp.state.hintKey,savedHint);
assert.equal(proofApp.tileStyle(savedHint,proofBoard.cells.get(savedHint)).fill,'#438c80','A hinted cell inside the movement range must show the range color');
assert.equal(proofApp.tileStyle(savedHint,proofBoard.cells.get(savedHint)).text,'·','The hint marker must remain visible inside the movement range');
assert.equal(proofApp.tileStyle('0,0,0',proofBoard.cells.get('0,0,0')).fill,'#356a89','Selecting a clue must take priority over the hint color');
proofApp.activate('2,0,0',true);assert.equal(proofPage.elements.hintExplanation.hidden,true,'Changing flags must clear stale hint evidence');
assert.equal(proofApp.tileStyle('0,0,0',proofBoard.cells.get('0,0,0')).fill,'#26374a','Changing flags must remove the clue highlight');
const comparePage=page(''),compareApp=comparePage.window.__game,compare=compareApp.state,compareIds=[...compare.cells.keys()],[p,q,a,b,c]=compareIds;
for(const cell of compare.cells.values()){cell.revealed=false;cell.flagged=false;cell.piece='K';}compare.cells.get(p).revealed=true;compare.cells.get(q).revealed=true;compare.mines.clear();compare.mines.add(b);compare.mines.add(c);
const clueMap=new Map([[p,[a,b]],[q,[a,b,c]]]);compareApp.setCluePositions(pos=>(clueMap.get(pos.join(','))||[]).map(id=>id.split(',').map(Number)));
const inferred=compareApp.inferMoves().moves.find(move=>move.key===c);assert.equal(inferred.method,'compare');assert.deepEqual([...inferred.sources].sort(),[p,q].sort());
compareApp.showHint();assert.equal(comparePage.elements.hintEvidence.children.length,2);assert.match(comparePage.elements.hintExplanationSummary.textContent,/겹침과 차이/);assert.match(comparePage.elements.hintExplanationSummary.textContent,/식을 빼/);
assert.equal(compareApp.tileStyle(p,compare.cells.get(p)).fill,'#364b5d');assert.equal(compareApp.tileStyle(q,compare.cells.get(q)).fill,'#364b5d');
const searchPage=page(''),searchApp=searchPage.window.__game,search=searchApp.state,searchIds=[...search.cells.keys()],[p1,p2,p3,p4,a1,b1,c1,a2,b2,c2]=searchIds;
for(const cell of search.cells.values()){cell.revealed=false;cell.flagged=false;cell.piece='K';}for(const id of [p1,p2,p3,p4])search.cells.get(id).revealed=true;
search.mines.clear();search.mines.add(b1);search.mines.add(b2);const searchMap=new Map([[p1,[a1,b1]],[p2,[b1,c1]],[p3,[a2,b2]],[p4,[b2,c2]]]);
searchApp.setCluePositions(pos=>(searchMap.get(pos.join(','))||[]).map(id=>id.split(',').map(Number)));
const searchMove=searchApp.inferMoves().moves.find(move=>move.key===b1);assert.equal(searchMove.method,'search');
searchApp.setInference(()=>({moves:[searchMove],conflict:false}));searchApp.showHint();
assert.equal(searchPage.elements.hintEvidence.children.length,2);assert.equal(searchPage.elements.hintOtherEvidence.children.length,2);assert.match(searchPage.elements.hintExplanationSummary.textContent,/다른 공개 단서/);
assert.equal(searchApp.tileStyle(p1,search.cells.get(p1)).fill,'#364b5d');assert.equal(searchApp.tileStyle(p3,search.cells.get(p3)).fill,'#26374a');
console.log('Verified both modes, fast double taps, long-press flags, and drag cancellation');
