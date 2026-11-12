(() => {
  'use strict';
  // The Oracle-hosted copy exposes the account API under this path.
  if (!location.pathname.startsWith('/chessmine/')) return;
  const area = document.getElementById('gameArea');
  const panel = document.createElement('section');
  panel.className = 'camera-controls';
  panel.hidden = true;
  panel.setAttribute('aria-label', '계정 및 플레이 기록');
  const status = document.createElement('span');
  status.setAttribute('aria-live', 'polite');
  const button = (label, action) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  };
  const list = document.createElement('div');
  list.hidden = true;
  list.style.cssText = 'flex-basis:100%;max-height:180px;overflow:auto';
  let session = null;
  let pending = [];
  let sending = false;
  const send = async () => {
    if (sending || !session?.authenticated || !pending.length) return;
    sending = true;
    try {
      while (pending.length) {
        const response = await fetch('api/records', {method: 'POST', credentials: 'same-origin',
          headers: {'Content-Type': 'application/json', 'X-CSRFToken': session.csrfToken}, body: JSON.stringify(pending[0])});
        if (!response.ok) throw new Error('record save failed');
        pending.shift();
      }
      status.textContent = '플레이 기록을 저장했습니다.';
    } catch {
      status.textContent = '기록을 저장하지 못했습니다. 다시 시도를 눌러 주세요.';
    } finally {
      sending = false;
      retry.hidden = !pending.length;
    }
  };
  const retry = button('기록 저장 다시 시도', send);
  retry.hidden = true;
  const showRecords = button('플레이 기록', async () => {
    if (!list.hidden) { list.hidden = true; return; }
    list.hidden = false;
    list.textContent = '기록을 불러오는 중…';
    try {
      const response = await fetch('api/records', {credentials: 'same-origin'});
      if (!response.ok) throw new Error('record list failed');
      const data = await response.json();
      list.replaceChildren();
      if (!data.records.length) { list.textContent = '아직 저장된 기록이 없습니다.'; return; }
      const labels = {'normal': '일반', 'no-guess': '추측 없음', 'no-guess-color': '컬러 묶음'};
      for (const record of data.records) {
        const seconds = Math.floor(record.duration_ms / 1000);
        const row = document.createElement('div');
        row.textContent = `${new Date(record.finished_at).toLocaleString('ko-KR')} · ${labels[record.mode]} · ${record.board_size}×${record.board_size}×${record.board_size} · 지뢰 ${record.mine_count}개 · ${record.result === 'won' ? '성공' : '실패'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · 가중치 ${['K','R','B','Q','N'].map(piece => record.weights[piece]).join(':')}`;
        list.append(row);
      }
    } catch { list.textContent = '기록을 불러오지 못했습니다.'; }
  });
  const deleteAccount = button('계정 및 기록 삭제', async () => {
    if (!confirm('계정과 모든 플레이 기록을 삭제합니다. 삭제한 기록은 복구할 수 없습니다. 계속할까요?')) return;
    try {
      const response = await fetch('api/account/delete', {method: 'POST', credentials: 'same-origin', headers: {'X-CSRFToken': session.csrfToken}});
      if (!response.ok) throw new Error('account deletion failed');
      location.reload();
    } catch { status.textContent = '계정을 삭제하지 못했습니다. 다시 시도해 주세요.'; }
  });
  const form = (label, action) => {
    const element = document.createElement('form');
    element.method = 'post'; element.action = action;
    const csrf = document.createElement('input'); csrf.type = 'hidden'; csrf.name = 'csrfmiddlewaretoken'; csrf.value = session.csrfToken;
    const next = document.createElement('input'); next.type = 'hidden'; next.name = 'next'; next.value = location.pathname + location.search;
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = label;
    element.append(csrf, next, submit); return element;
  };
  window.addEventListener('chessmine:game-finished', event => {
    if (session && !session.authenticated) return;
    if (!globalThis.crypto?.randomUUID) { status.textContent = '안전한 연결에서만 기록을 저장할 수 있습니다.'; return; }
    pending.push({...event.detail, clientId: crypto.randomUUID()});
    send();
  });
  const connect = async () => {
    try {
      const response = await fetch('api/session', {credentials: 'same-origin'});
      if (!response.ok) throw new Error('account service unavailable');
      const data = await response.json();session = data;panel.hidden = false;reconnect.hidden = true;
      if (data.authenticated) {
        const name = document.createElement('span'); name.textContent = `${data.name}님`;
        panel.prepend(name, form('로그아웃', 'accounts/logout/'), showRecords, deleteAccount);
        send();
      } else {
        pending = [];
        panel.prepend(form('Google로 로그인', 'accounts/google/login/'));
        status.textContent = '로그인하면 완료한 게임을 저장합니다.';
      }
    } catch {
      panel.hidden = false;reconnect.hidden = false;
      status.textContent = '계정 서비스에 연결하지 못했습니다. 기록을 저장하려면 다시 연결해 주세요.';
    }
  };
  const reconnect = button('계정 다시 연결', connect);reconnect.hidden = true;
  panel.append(reconnect, retry, status, list);
  area.prepend(panel);connect();
})();
