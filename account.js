(() => {
  'use strict';
  if (location.origin !== 'https://sihoo7005.github.io' || !location.pathname.startsWith('/3dchessmine/')) return;
  const server = 'https://jsaur.duckdns.org';
  const base = `${server}/chessmine/`;
  const storageKey = 'chessmine:session';
  let token = null, session = null, pending = [], sending = false, popup = null, loginState = null;
  try { token = sessionStorage.getItem(storageKey); } catch {}
  const area = document.getElementById('gameArea'), panel = document.createElement('section');
  panel.className = 'camera-controls'; panel.setAttribute('aria-label', '계정 및 플레이 기록');
  const controls = document.createElement('div'), status = document.createElement('span'), list = document.createElement('div');
  controls.className = 'buttons'; status.setAttribute('aria-live', 'polite');
  list.hidden = true; list.style.cssText = 'flex-basis:100%;max-height:180px;overflow:auto';
  const button = (label, action) => {
    const element = document.createElement('button');element.type = 'button';element.textContent = label;
    element.addEventListener('click', action);return element;
  };
  const request = async (action, options = {}) => {
    const headers = {...options.headers};if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${base}api/cross/${action}`, {...options, headers, credentials: 'omit'});
  };
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
  const showRecords = button('플레이 기록', async () => {
    if (!list.hidden) { list.hidden = true;return; }
    list.hidden = false;list.textContent = '기록을 불러오는 중…';
    try {
      const response = await request('records');if (!response.ok) throw new Error('list failed');
      const data = await response.json();list.replaceChildren();
      if (!data.records.length) { list.textContent = '아직 저장된 기록이 없습니다.';return; }
      const labels = {'normal':'일반','no-guess':'추측 없음','no-guess-color':'컬러 묶음'};
      for (const record of data.records) {
        const seconds = Math.floor(record.duration_ms / 1000),row = document.createElement('div');
        row.textContent = `${new Date(record.finished_at).toLocaleString('ko-KR')} · ${labels[record.mode]} · ${record.board_size}×${record.board_size}×${record.board_size} · 지뢰 ${record.mine_count}개 · ${record.result === 'won' ? '성공' : '실패'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · 가중치 ${['K','R','B','Q','N'].map(piece=>record.weights[piece]).join(':')}`;
        list.append(row);
      }
    } catch { list.textContent = '기록을 불러오지 못했습니다.'; }
  });
  const clearSession = () => {
    token = null;session = null;try { sessionStorage.removeItem(storageKey); } catch {}
    list.hidden = true;render();
  };
  const login = button('Google로 로그인', () => {
    if (!globalThis.crypto?.randomUUID) { status.textContent = '안전한 브라우저에서 로그인해 주세요.';return; }
    loginState = crypto.randomUUID();
    popup = window.open(`${base}auth/start?state=${encodeURIComponent(loginState)}`, 'chessmine-login', 'popup,width=520,height=700');
    status.textContent = popup ? 'Google 로그인 창에서 계속해 주세요.' : '로그인 창이 차단됐습니다. 팝업을 허용해 주세요.';
  });
  const logout = button('로그아웃', async () => {
    if (pending.length && !confirm('저장하지 못한 기록이 있습니다. 로그아웃하면 이 기록은 사라집니다. 계속할까요?')) return;
    try { const response = await request('logout', {method:'POST'});if (!response.ok) throw new Error('logout failed');pending=[];clearSession();status.textContent='로그아웃했습니다.'; }
    catch { status.textContent='로그아웃하지 못했습니다. 다시 시도해 주세요.'; }
  });
  const deleteAccount = button('계정 및 기록 삭제', async () => {
    if (!confirm('계정과 모든 플레이 기록을 삭제합니다. 삭제한 기록은 복구할 수 없습니다. 계속할까요?')) return;
    try { const response = await request('delete', {method:'POST'});if (!response.ok) throw new Error('delete failed');pending=[];clearSession();status.textContent='계정과 기록을 삭제했습니다.'; }
    catch { status.textContent='계정을 삭제하지 못했습니다. 다시 시도해 주세요.'; }
  });
  const render = () => {
    controls.replaceChildren();retry.hidden = !session || !pending.length;
    if (session) { const name=document.createElement('span');name.textContent=`${session.name}님`;controls.append(name,showRecords,logout,deleteAccount); }
    else controls.append(login);
  };
  const reconnect = button('계정 다시 연결', async () => { await connect(); });reconnect.hidden = true;
  const connect = async () => {
    if (!token) { session=null;reconnect.hidden=true;render();status.textContent='로그인하면 완료한 게임을 저장합니다.';return; }
    try {
      const response=await request('session');
      if (response.status===401) { clearSession();reconnect.hidden=true;status.textContent='로그인이 만료됐습니다. 다시 로그인해 주세요.';return; }
      if (!response.ok) throw new Error('session failed');
      session=await response.json();reconnect.hidden=true;
      const before=pending.length;pending=pending.filter(item=>item.owner ? item.owner===session.userId : item.token===token);
      render();status.textContent=before!==pending.length?'다른 계정에서 저장하지 못한 기록은 전송하지 않았습니다.':'로그인됨';save();
    } catch { session=null;reconnect.hidden=false;render();status.textContent='계정 서비스에 연결하지 못했습니다. 다시 연결해 주세요.'; }
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
  panel.append(controls,reconnect,retry,status,list);area.prepend(panel);connect();
})();
