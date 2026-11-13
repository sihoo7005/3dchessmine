(() => {
  'use strict';
  if (!(location.origin === 'https://3dchessmine.pages.dev' || (location.origin === 'https://sihoo7005.github.io' && location.pathname.startsWith('/3dchessmine/')))) return;
  const server = location.origin === 'https://3dchessmine.pages.dev' ? location.origin : 'https://jsaur.duckdns.org';
  const base = `${server}/chessmine/`;
  const storageKey = 'chessmine:session';
  let token = null, session = null, pending = [], sending = false, popup = null, loginState = null;
  try { token = sessionStorage.getItem(storageKey); } catch {}
  const area = document.getElementById('gameArea'), accountSlot = document.getElementById('accountSlot'), panel = document.createElement('section');
  panel.className = 'camera-controls'; panel.setAttribute('aria-label', 'Account and game history');
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
        if (response.status === 401) { clearSession();status.textContent = 'Your session expired. Please sign in again.';return; }
        if (!response.ok) throw new Error('save failed');
        pending.shift();
      }
      status.textContent = 'Game history saved.';
    } catch { status.textContent = 'Could not save game history. Select Retry to try again.'; }
    finally { sending = false;retry.hidden = !pending.length || !session; }
  };
  const retry = button('Retry saving', save);retry.hidden = true;
  const recordsHeader=document.createElement('div'), recordsTitle=document.createElement('h2');recordsHeader.className='helpHeader';recordsTitle.id='recordsTitle';recordsTitle.textContent='Game History';recordsHeader.append(recordsTitle,button('Close',()=>recordsDialog.close()));recordsDialog.append(recordsHeader,list);
  recordsDialog.addEventListener('click',event=>{const r=recordsDialog.getBoundingClientRect();if(event.target===recordsDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))recordsDialog.close();});
  const showRecords = button('Game History', async () => {
    accountMenu.open=false;if(!recordsDialog.open)recordsDialog.showModal();list.textContent = 'Loading game history…';
    try {
      const response = await request('records');if (!response.ok) throw new Error('list failed');
      const data = await response.json();list.replaceChildren();
      if (!data.records.length) { list.textContent = 'No saved games yet.';return; }
      const labels = {'normal':'Standard','no-guess':'No-Guess','no-guess-color':'Color Groups'};
      for (const record of data.records) {
        const seconds = Math.floor(record.duration_ms / 1000),row = document.createElement('div');
        const preset={'4:6':'Easy','4:10':'Easy','5:15':'Normal','5:20':'Normal','6:35':'Hard'}[`${record.board_size}:${record.mine_count}`],difficulty=preset&&['K','R','B','Q','N'].every((piece,i)=>record.weights[piece]===(i===0?7:1))?`${preset} · `:'';
        row.textContent = `${new Date(record.finished_at).toLocaleDateString(window.chessmineLanguage === 'ko' ? 'ko-KR' : 'en-US')} · ${labels[record.mode]} · ${difficulty}${record.board_size}×${record.board_size}×${record.board_size} · ${record.mine_count} mines · ${record.result === 'won' ? 'Won' : 'Lost'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · Weights ${['K','R','B','Q','N'].map(piece=>record.weights[piece]).join(':')}`;
        list.append(row);
      }
    } catch { list.textContent = 'Could not load game history.'; }
  });
  const clearSession = () => {
    token = null;session = null;try { sessionStorage.removeItem(storageKey); } catch {}
    publishCredits(null);if(recordsDialog.open)recordsDialog.close();render();
  };
  const login = button('Sign in', () => {
    if (!globalThis.crypto?.randomUUID) { status.textContent = 'Please sign in using a secure browser.';return; }
    loginState = crypto.randomUUID();
    popup = window.open(`${base}auth/start?state=${encodeURIComponent(loginState)}&origin=${encodeURIComponent(location.origin)}`, 'chessmine-login', 'popup,width=520,height=700');
    status.textContent = popup ? 'Continue in the Google sign-in window.' : 'The sign-in window was blocked. Allow pop-ups and try again.';
  });
  const logout = button('Sign out', async () => {
    if (!confirm(pending.length?'Some game history could not be saved. It will be lost if you sign out. Continue?':'Sign out?')) return;
    try { const response = await request('logout', {method:'POST'});if (!response.ok) throw new Error('logout failed');pending=[];clearSession();status.textContent='Signed out.'; }
    catch { status.textContent='Could not sign out. Please try again.'; }
  });
  const deleteAccount = button('Delete account and history', async () => {
    if (!confirm('Delete your account and all game history? This cannot be undone.')) return;
    try { const response = await request('delete', {method:'POST'});if (!response.ok) throw new Error('delete failed');pending=[];clearSession();status.textContent='Account and history deleted.'; }
    catch { status.textContent='Could not delete the account. Please try again.'; }
  });
  const accountMenu=document.createElement('details'), accountTitle=document.createElement('summary'), actions=document.createElement('div');
  accountTitle.textContent='Account';accountMenu.className='header-menu';actions.append(showRecords,logout,deleteAccount);accountMenu.append(accountTitle,actions);
  document.addEventListener('click', event => { if (!accountMenu.contains(event.target)) accountMenu.open=false; });
  const render = () => {
    controls.replaceChildren();retry.hidden = !session || !pending.length;
    if (session) controls.append(accountMenu);
    else { accountMenu.open=false;controls.append(login); }
  };
  const reconnect = button('Reconnect account', async () => { await connect(); });reconnect.hidden = true;
  const connect = async () => {
    if (!token) { session=null;reconnect.hidden=true;publishCredits(null);render();status.textContent='';return; }
    try {
      const response=await request('session');
      if (response.status===401) { clearSession();reconnect.hidden=true;status.textContent='Your session expired. Please sign in again.';return; }
      if (!response.ok) throw new Error('session failed');
      session=await response.json();reconnect.hidden=true;
      const before=pending.length;pending=pending.filter(item=>item.owner ? item.owner===session.userId : item.token===token);
      publishCredits(null);render();status.textContent=before!==pending.length?'Unsent history from another account was not uploaded.':'';save();hintRequest('hints').catch(()=>{});
    } catch { session=null;publishCredits(null);reconnect.hidden=false;render();status.textContent='Could not connect to the account service. Please reconnect.'; }
  };
  window.addEventListener('message', async event => {
    if (event.origin!==server || event.source!==popup || !loginState || event.data?.type!=='chessmine-login' || event.data.state!==loginState || typeof event.data.code!=='string') return;
    loginState=null;popup=null;
    try {
      const response=await request('exchange', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:event.data.code})});
      if (!response.ok) throw new Error('exchange failed');
      const data=await response.json();token=data.token;try { sessionStorage.setItem(storageKey,token); } catch {}
      await connect();
    } catch { status.textContent='Sign-in failed. Please try again.'; }
  });
  window.addEventListener('chessmine:game-finished', event => {
    if (!token) return;
    if (!globalThis.crypto?.randomUUID) { status.textContent='Please save game history using a secure browser.';return; }
    pending.push({record:{...event.detail,clientId:crypto.randomUUID()},owner:session?.userId||null,token});save();
  });
  accountSlot.append(controls);panel.append(reconnect,retry,status,recordsDialog);area.prepend(panel);connect();
})();
