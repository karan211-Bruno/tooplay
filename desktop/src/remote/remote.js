(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = sessionStorage.getItem('tooplay-token') || '', state = null, polling = false, busy = false, dragging = false;
  let requestGeneration = 0;
  const message = text => { $('message').textContent = text || ''; };
  const time = seconds => { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  function setToken(value) {
    token = value; state = null; ++requestGeneration;
    if (token) sessionStorage.setItem('tooplay-token', token); else sessionStorage.removeItem('tooplay-token');
    $('pair').hidden = !!token; $('player').hidden = !token; $('connection').textContent = token ? '연결됨' : '연결 전';
    if (token && !state) render({ title: '', hasMedia: false, playing: false, duration: 0, currentTime: 0, volume: 1 });
  }
  async function api(route, method = 'GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      const data = await response.json();
      if (response.status === 401 && route !== '/api/pair') setToken('');
      if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
      return data;
    } finally { clearTimeout(timer); }
  }
  function options(id, entries, selected, placeholder) {
    const select = $(id);
    const signature = JSON.stringify(entries);
    if (select.dataset.entries !== signature) {
      select.replaceChildren(new Option(placeholder, ''), ...entries.map(item => new Option(item.name, item.id)));
      select.dataset.entries = signature;
    }
    if (selected !== undefined) select.value = selected || '';
  }
  function render(value) {
    state = value;
    $('title').textContent = value.title || '컴퓨터에서 영상을 열어 주세요';
    $('target').textContent = value.casting ? `${value.castDevice?.name || 'TV'}에서 재생` : '컴퓨터에서 재생';
    $('status').textContent = value.preparing ? '영상을 준비하는 중…' : value.hasMedia ? (value.playing ? '재생 중' : '일시정지') : '영상 선택은 컴퓨터에서 해 주세요.';
    $('play').textContent = value.playing ? '일시정지' : '재생';
    if (!dragging) { $('seek').max = Math.max(1, value.duration); $('seek').value = value.currentTime; $('volume').value = value.volume; }
    $('position').textContent = time(value.currentTime); $('duration').textContent = time(value.duration);
    options('subtitle', value.subtitles || [], value.selectedSubtitleId, '자막 끄기');
    options('devices', value.devices || [], undefined, 'TV 선택');
    $('castStop').hidden = !value.casting && !value.preparing;
    for (const id of ['play', 'back', 'forward', 'seek', 'volume', 'subtitle', 'cast']) $(id).disabled = busy || !value.hasMedia || value.preparing;
    $('cast').disabled ||= value.casting;
    if (value.lastError) message(value.lastError);
  }
  async function poll() {
    if (!token || polling || document.hidden) return;
    polling = true; const generation = requestGeneration;
    try { const value = await api('/api/state'); if (generation === requestGeneration) { render(value); $('connection').textContent = '연결됨'; } }
    catch (error) { message(error.message); $('connection').textContent = '연결 확인 중'; }
    finally { polling = false; }
  }
  async function command(command, extra = {}) {
    if (busy) return; busy = true; if (state) render(state); message('');
    try { await api('/api/command', 'POST', { command, ...extra }); await poll(); }
    catch (error) { message(error.message); }
    finally { busy = false; if (state) render(state); }
  }
  $('pairForm').addEventListener('submit', async event => {
    event.preventDefault(); $('pairButton').disabled = true; message('');
    try { const result = await api('/api/pair', 'POST', { code: $('code').value, name: '모바일 브라우저' }); setToken(result.token); $('code').value = ''; await poll(); }
    catch (error) { message(error.message); }
    finally { $('pairButton').disabled = false; }
  });
  $('play').onclick = () => command(state?.playing ? 'pause' : 'play');
  $('back').onclick = () => command('seek', { value: Math.max(0, state.currentTime - 10) });
  $('forward').onclick = () => command('seek', { value: Math.min(state.duration, state.currentTime + 10) });
  for (const id of ['seek', 'volume']) {
    $(id).oninput = () => { dragging = true; };
    $(id).onchange = () => { dragging = false; command(id, { value: Number($(id).value) }); };
    $(id).addEventListener('pointercancel', () => { dragging = false; });
  }
  $('subtitle').onchange = () => command('subtitle', { trackId: $('subtitle').value || null });
  $('cast').onclick = () => { if ($('devices').value) command('cast-connect', { deviceId: $('devices').value }); else message('TV를 선택해 주세요.'); };
  $('castStop').onclick = () => command('cast-stop');
  $('disconnect').onclick = async () => { try { await api('/api/session', 'DELETE'); } catch {} setToken(''); message('연결을 해제했습니다.'); };
  document.addEventListener('visibilitychange', poll);
  setToken(token); poll(); setInterval(poll, 1000);
})();
