(() => {
  'use strict';
  if (!(location.origin === 'https://3dchessmine.pages.dev' || (location.origin === 'https://sihoo7005.github.io' && location.pathname.startsWith('/3dchessmine/')))) return;
  const server = location.origin === 'https://3dchessmine.pages.dev' ? location.origin : 'https://jsaur.duckdns.org';
  const base = `${server}/chessmine/`;
  const storageKey = 'chessmine:session';
  let token = null, session = null, pending = [], sending = false, popup = null, loginState = null;
  try { token = sessionStorage.getItem(storageKey); } catch {}
  const area = document.getElementById('gameArea'), accountSlot = document.getElementById('accountSlot'), panel = document.createElement('section');
  panel.className = 'camera-controls'; panel.setAttribute('aria-label', '계정 및 플레이 기록');
  const controls = document.createElement('div'), status = document.createElement('span'), list = document.createElement('div'), recordsDialog = document.createElement('dialog');
  controls.className = 'buttons'; status.setAttribute('aria-live', 'polite');
  recordsDialog.id='recordsDialog';recordsDialog.className='records-dialog';recordsDialog.setAttribute('aria-labelledby','recordsTitle');
  const button = (label, action) => {
    const element = document.createElement('button');element.type = 'button';element.textContent = label;
    element.addEventListener('click', action);return element;
  };
  const request = async (action, options = {}) => {
    const headers = {...options.headers};if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${base}api/cross/${action}`, {...options, headers, credentials: 'omit'});
  };
  const publishCredits = (credits,premium=null,premiumTestAvailable=false) => window.dispatchEvent(new CustomEvent('chessmine:hint-credits',{detail:{credits,premium,premiumTestAvailable}}));
  const hintRequest = async (action, method='GET', body) => {
    if (!token || !session) throw new Error('login_required');
    const currentToken=token, userId=session.userId, controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15000);
    let response;try{response=await request(action,{method,signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});}catch{if(token!==currentToken || session?.userId!==userId)throw new Error('account_changed');throw new Error('network_unavailable');}finally{clearTimeout(timeout);}
    if (token!==currentToken || session?.userId!==userId) throw new Error('account_changed');
    if (response.status===401) { clearSession();throw new Error('login_required'); }
    if (!response.ok) throw new Error('hint_request_failed');
    const data=await response.json();if(token!==currentToken || session?.userId!==userId)throw new Error('account_changed');if(Number.isSafeInteger(data.credits))publishCredits(data.credits,data.premium===true,data.premiumTestAvailable===true);return data;
  };
  window.chessmineHints={state:()=>!token?'guest':session?'authenticated':'connecting',owner:()=>session?.userId??null,balance:()=>hintRequest('hints'),start:()=>hintRequest('hint-start','POST'),claim:ticket=>hintRequest('hint-claim','POST',{ticket}),use:()=>hintRequest('hint-use','POST'),setPremium:enabled=>hintRequest('premium-test','POST',{enabled})};
  const refreshHints=()=>{if(session)hintRequest('hints').catch(()=>{});};
  function scheduleDailyRefresh(){const now=Date.now(),delay=86400000-now%86400000+100;setTimeout(()=>{refreshHints();scheduleDailyRefresh();},delay);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshHints();});scheduleDailyRefresh();
  const save = async () => {
    if (sending || !session || !pending.length) return;
    sending = true;
    try {
      while (pending.length) {
        const response = await request('records', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(pending[0].record)});
        if (response.status === 401) { clearSession();status.textContent = '로그인이 만료됐습니다. 다시 로그인해 주세요.';return; }
        if (!response.ok) throw new Error('save failed');
        pending.shift();
      }
      status.textContent = '플레이 기록을 저장했습니다.';
    } catch { status.textContent = '기록을 저장하지 못했습니다. 다시 시도를 눌러 주세요.'; }
    finally { sending = false;retry.hidden = !pending.length || !session; }
  };
  const retry = button('기록 저장 다시 시도', save);retry.hidden = true;
  const recordsHeader=document.createElement('div'), recordsTitle=document.createElement('h2');recordsHeader.className='helpHeader';recordsTitle.id='recordsTitle';recordsTitle.textContent='플레이 기록';recordsHeader.append(recordsTitle,button('닫기',()=>recordsDialog.close()));recordsDialog.append(recordsHeader,list);
  recordsDialog.addEventListener('click',event=>{const r=recordsDialog.getBoundingClientRect();if(event.target===recordsDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))recordsDialog.close();});
  const showRecords = button('플레이 기록', async () => {
    accountMenu.open=false;if(!recordsDialog.open)recordsDialog.showModal();list.textContent = '기록을 불러오는 중…';
    try {
      const response = await request('records');if (!response.ok) throw new Error('list failed');
      const data = await response.json();list.replaceChildren();
      if (!data.records.length) { list.textContent = '아직 저장된 기록이 없습니다.';return; }
      const labels = {'normal':'일반','no-guess':'추측 없음','no-guess-color':'컬러 묶음'};
      for (const record of data.records) {
        const seconds = Math.floor(record.duration_ms / 1000),row = document.createElement('div');
        const preset={'4:6':'쉬움','4:10':'쉬움','5:15':'보통','5:20':'보통','6:35':'어려움'}[`${record.board_size}:${record.mine_count}`],difficulty=preset&&['K','R','B','Q','N'].every((piece,i)=>record.weights[piece]===(i===0?7:1))?`${preset} · `:'';
        row.textContent = `${new Date(record.finished_at).toLocaleDateString('ko-KR')} · ${labels[record.mode]} · ${difficulty}${record.board_size}×${record.board_size}×${record.board_size} · 지뢰 ${record.mine_count}개 · ${record.result === 'won' ? '성공' : '실패'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · 가중치 ${['K','R','B','Q','N'].map(piece=>record.weights[piece]).join(':')}`;
        list.append(row);
      }
    } catch { list.textContent = '기록을 불러오지 못했습니다.'; }
  });
  const clearSession = () => {
    token = null;session = null;try { sessionStorage.removeItem(storageKey); } catch {}
    publishCredits(null);if(recordsDialog.open)recordsDialog.close();render();
  };
  const login = button('로그인', () => {
    if (!globalThis.crypto?.randomUUID) { status.textContent = '안전한 브라우저에서 로그인해 주세요.';return; }
    loginState = crypto.randomUUID();
    popup = window.open(`${base}auth/start?state=${encodeURIComponent(loginState)}&origin=${encodeURIComponent(location.origin)}`, 'chessmine-login', 'popup,width=520,height=700');
    status.textContent = popup ? 'Google 로그인 창에서 계속해 주세요.' : '로그인 창이 차단됐습니다. 팝업을 허용해 주세요.';
  });
  const logout = button('로그아웃', async () => {
    if (!confirm(pending.length?'저장하지 못한 기록이 있습니다. 로그아웃하면 이 기록은 사라집니다. 계속할까요?':'로그아웃하시겠습니까?')) return;
    try { const response = await request('logout', {method:'POST'});if (!response.ok) throw new Error('logout failed');pending=[];clearSession();status.textContent='로그아웃했습니다.'; }
    catch { status.textContent='로그아웃하지 못했습니다. 다시 시도해 주세요.'; }
  });
  const deleteAccount = button('계정 및 기록 삭제', async () => {
    if (!confirm('계정과 모든 플레이 기록을 삭제합니다. 삭제한 기록은 복구할 수 없습니다. 계속할까요?')) return;
    try { const response = await request('delete', {method:'POST'});if (!response.ok) throw new Error('delete failed');pending=[];clearSession();status.textContent='계정과 기록을 삭제했습니다.'; }
    catch { status.textContent='계정을 삭제하지 못했습니다. 다시 시도해 주세요.'; }
  });
  const accountMenu=document.createElement('details'), accountTitle=document.createElement('summary'), actions=document.createElement('div');
  accountTitle.textContent='계정';accountMenu.className='header-menu';actions.append(showRecords,logout,deleteAccount);accountMenu.append(accountTitle,actions);
  document.addEventListener('click', event => { if (!accountMenu.contains(event.target)) accountMenu.open=false; });
  const render = () => {
    controls.replaceChildren();retry.hidden = !session || !pending.length;
    if (session) controls.append(accountMenu);
    else { accountMenu.open=false;controls.append(login); }
  };
  const reconnect = button('계정 다시 연결', async () => { await connect(); });reconnect.hidden = true;
  const connect = async () => {
    if (!token) { session=null;reconnect.hidden=true;publishCredits(null);render();status.textContent='';return; }
    try {
      const response=await request('session');
      if (response.status===401) { clearSession();reconnect.hidden=true;status.textContent='로그인이 만료됐습니다. 다시 로그인해 주세요.';return; }
      if (!response.ok) throw new Error('session failed');
      session=await response.json();reconnect.hidden=true;
      const before=pending.length;pending=pending.filter(item=>item.owner ? item.owner===session.userId : item.token===token);
      publishCredits(null);render();status.textContent=before!==pending.length?'다른 계정에서 저장하지 못한 기록은 전송하지 않았습니다.':'';save();hintRequest('hints').catch(()=>{});
    } catch { session=null;publishCredits(null);reconnect.hidden=false;render();status.textContent='계정 서비스에 연결하지 못했습니다. 다시 연결해 주세요.'; }
  };
  window.addEventListener('message', async event => {
    if (event.origin!==server || event.source!==popup || !loginState || event.data?.type!=='chessmine-login' || event.data.state!==loginState || typeof event.data.code!=='string') return;
    loginState=null;popup=null;
    try {
      const response=await request('exchange', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:event.data.code})});
      if (!response.ok) throw new Error('exchange failed');
      const data=await response.json();token=data.token;try { sessionStorage.setItem(storageKey,token); } catch {}
      await connect();
    } catch { status.textContent='로그인에 실패했습니다. 다시 시도해 주세요.'; }
  });
  window.addEventListener('chessmine:game-finished', event => {
    if (!token) return;
    if (!globalThis.crypto?.randomUUID) { status.textContent='안전한 브라우저에서 기록을 저장해 주세요.';return; }
    pending.push({record:{...event.detail,clientId:crypto.randomUUID()},owner:session?.userId||null,token});save();
  });
  accountSlot.append(controls);panel.append(reconnect,retry,status,recordsDialog);area.prepend(panel);connect();
})();
