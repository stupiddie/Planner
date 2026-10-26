(() => {
  const KEY = 'penguin-time-records-v1';
  let selected = null;
  let holdTimer = null;
  let held = false;
  const read = () => {
    const data = JSON.parse(localStorage.getItem(storageKey(KEY)) || '[]');
    if (!Array.isArray(data)) throw new Error('Invalid time records');
    return data;
  };
  const current = cards => cards.find(card => card.id === selected);
  const active = card => card?.sessions.find(session => session.endedAt === null);
  const running = session => session?.segments.find(segment => segment.end === null);
  const duration = (session, now = Date.now()) => session.segments.reduce((total, segment) => total + Math.max(0, (segment.end ?? now) - segment.start), 0);
  const clock = ms => {
    const seconds = Math.floor(ms / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  };
  const stamp = ms => {
    const date = new Date(ms);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  const mutate = fn => {
    try {
      const cards = read();
      fn(cards);
      localStorage.setItem(storageKey(KEY), JSON.stringify(cards));
      render();
    } catch (error) {
      console.error(error);
      toast('时间记录保存失败，请检查浏览器存储空间');
    }
  };
  function tick() {
    if ($('time-view').hidden || !selected) return;
    try {
      const card = current(read());
      const session = active(card);
      const last = session || card?.sessions.at(-1);
      $('time-clock').textContent = clock(last ? duration(last) : 0);
    } catch (error) { console.error(error); }
  }
  function render() {
    const cards = read();
    const card = current(cards);
    $('time-list').hidden = Boolean(card);
    $('time-detail').hidden = !card;
    if (!card) {
      selected = null;
      $('time-cards').replaceChildren();
      cards.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'time-card';
        button.textContent = item.name;
        button.addEventListener('click', () => { selected = item.id; render(); });
        $('time-cards').append(button);
      });
      if (!cards.length) $('time-cards').innerHTML = '<p class="hint">还没有事项，添加一张卡片开始记录时间。</p>';
      return;
    }
    const session = active(card);
    const isRunning = Boolean(running(session));
    $('time-title').textContent = card.name;
    $('time-status').textContent = isRunning ? '正在计时' : session ? '已暂停' : card.sessions.length ? '本次计时已结束' : '准备开始';
    $('time-start').disabled = isRunning;
    $('time-start').textContent = session && !isRunning ? '继续开始' : '开始';
    $('time-pause').disabled = !session;
    $('time-total').textContent = `共 ${card.sessions.length} 次计时`;
    $('time-records').innerHTML = card.sessions.slice().reverse().map(item => `<article class="time-record"><div class="time-record-head"><strong>${item.endedAt !== null ? '已结束' : running(item) ? '计时中' : '已暂停'}</strong><span>${clock(duration(item))}${item.endedAt === null ? '（累计）' : ''}</span></div>${item.segments.map(segment => `<div class="time-segment">${stamp(segment.start)} 至 ${segment.end === null ? '正在记录' : stamp(segment.end)}</div>`).join('')}</article>`).join('') || '<p class="hint">暂无记录，点击开始记录第一段时间。</p>';
    tick();
  }
  $('nav-time').addEventListener('click', () => {
    commitEdit(); closeNote(); closeSidebar();
    ['day-view', 'checklist-view', 'month-view', 'account-view', 'back-to-month', 'history-actions', 'month-picker-wrap', 'today'].forEach(id => { $(id).hidden = true; });
    ['nav-daily', 'nav-account'].forEach(id => $(id).classList.remove('active'));
    $('nav-time').classList.add('active');
    $('time-view').hidden = false;
    selected = null;
    try { render(); } catch (error) { toast('无法读取时间记录'); }
  });
  $('time-create').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('time-name').value.trim();
    if (!name) { $('time-name').focus(); return; }
    mutate(cards => cards.push({ id: crypto.randomUUID(), name, sessions: [] }));
    $('time-name').value = '';
  });
  $('time-back').addEventListener('click', () => { cancelHold(); selected = null; render(); });
  $('time-start').addEventListener('click', () => mutate(cards => {
    const card = current(cards);
    if (!card) return;
    let session = active(card);
    if (running(session)) return;
    if (!session) { session = { endedAt: null, segments: [] }; card.sessions.push(session); }
    session.segments.push({ start: Date.now(), end: null });
  }));
  const pause = finish => mutate(cards => {
    const session = active(current(cards));
    if (!session) return;
    const now = Date.now();
    const segment = running(session);
    if (segment) segment.end = Math.max(segment.start, now);
    if (finish) session.endedAt = now;
  });
  const button = $('time-pause');
  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; button.classList.remove('holding'); }
  function beginHold() {
    if (button.disabled || holdTimer !== null) return;
    held = false;
    button.classList.add('holding');
    holdTimer = setTimeout(() => { held = true; cancelHold(); pause(true); toast('本次计时已结束'); }, 800);
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    beginHold();
  });
  button.addEventListener('pointerup', cancelHold);
  button.addEventListener('pointercancel', () => { held = true; cancelHold(); });
  button.addEventListener('lostpointercapture', cancelHold);
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.addEventListener('click', () => { if (!held) pause(false); held = false; });
  button.addEventListener('keydown', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      if (!event.repeat) beginHold();
    }
  });
  button.addEventListener('keyup', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault(); cancelHold();
      if (!held) pause(false);
      held = false;
    }
  });
  button.addEventListener('blur', cancelHold);
  window.addEventListener('blur', cancelHold);
  document.addEventListener('visibilitychange', () => { cancelHold(); if (!document.hidden) tick(); });
  window.addEventListener('storage', event => { if (event.key === storageKey(KEY) && !$('time-view').hidden) render(); });
  window.addEventListener('planner-sync', () => { if (!$('time-view').hidden) render(); });
  setInterval(tick, 250);
})();
