(() => {
  const KEY = 'penguin-mainlines-v1';
  const model = window.MainlineModel;
  const escape = escapeHtml;
  let selected = null;
  let tab = 'goals';
  const urls = new Set();
  const read = (key = storageKey(KEY)) => {
    const lines = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(lines)) throw new Error('主线数据无法读取');
    return lines;
  };
  const update = (change, key = storageKey(KEY)) => {
    try {
      const lines = read(key);
      change(lines);
      localStorage.setItem(key, JSON.stringify(lines));
      $('ml-save-status').textContent = '已保存在本机';
      return true;
    } catch (error) {
      console.error(error);
      $('ml-save-status').textContent = '保存失败，请检查浏览器存储空间后重新修改。';
      toast('主线保存失败，刚才的修改尚未保存');
      return false;
    }
  };
  const updateLine = change => update(lines => {
    const line = lines.find(item => item.id === selected);
    if (!line) throw new Error('主线不存在');
    change(line);
  });
  const releasePhotos = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  window.mainlineLeave = () => {
    $('mainline-view').hidden = true;
    $('nav-mainline').classList.remove('active');
    closeSuggestions();
    releasePhotos();
  };
  // Only change navigation visibility. The timer module and its storage are untouched.
  $('nav-time').addEventListener('click', window.mainlineLeave);
  $('nav-mainline').addEventListener('click', () => {
    commitEdit(); closeNote(); closeSidebar(); closeSuggestions();
    ['day-view', 'checklist-view', 'month-view', 'account-view', 'time-view', 'back-to-month', 'history-actions', 'month-picker-wrap', 'today'].forEach(id => { $(id).hidden = true; });
    ['nav-daily', 'nav-account', 'nav-time'].forEach(id => $(id).classList.remove('active'));
    $('nav-mainline').classList.add('active');
    $('mainline-view').hidden = false;
    selected = null;
    render();
  });
  window.addEventListener('planner-sync', () => { if (!$('mainline-view').hidden && !document.activeElement?.closest('#mainline-view input, #mainline-view textarea')) render(); });
  function render() {
    releasePhotos();
    let lines;
    try { lines = read(); } catch (error) { toast('主线数据无法读取，请保留浏览器数据'); return; }
    const line = lines.find(item => item.id === selected);
    $('mainline-home').hidden = Boolean(line);
    $('mainline-detail').hidden = !line;
    if (!line) {
      selected = null;
      $('mainline-cards').innerHTML = lines.length ? lines.map((item, index) => `<button class="ml-line-card" type="button" data-line="${escape(item.id)}"><span class="eyebrow">${String(index + 1).padStart(2, '0')} / 主线</span><h2>${escape(item.name)}</h2><div class="ml-card-meta"><span>${item.goals.length} 个目标</span><span>${item.achievements.length} 个成就</span><span>查看主线 →</span></div></button>`).join('') : '<p class="ml-empty">这条线的第一站，会是什么？<br>添加一条主线，开始积累目标、成就与每天的足迹。</p>';
      $('mainline-cards').querySelectorAll('[data-line]').forEach(button => button.addEventListener('click', () => {
        selected = button.dataset.line; tab = 'goals'; render();
      }));
      return;
    }
    $('mainline-title').textContent = line.name;
    $('mainline-tag').textContent = model.tag(line.name);
    document.querySelectorAll('[data-ml-tab]').forEach(button => {
      const active = button.dataset.mlTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    ['goals', 'achievements', 'logs'].forEach(name => { $(`ml-${name}`).hidden = name !== tab; });
    if (tab === 'goals') renderGoals(line);
    if (tab === 'achievements') renderAchievements(line);
    if (tab === 'logs') renderLogs(line);
  }
  $('mainline-create').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('mainline-name').value.trim();
    try {
      if (!model.validName(name, read())) { toast('名称不能为空、重复或包含方括号，最多 60 字'); return; }
      if (update(lines => lines.push({ id: makeFileId(), name, goals: [], achievements: [] }))) {
        $('mainline-name').value = ''; render();
      }
    } catch (error) { toast('无法读取主线数据'); }
  });
  $('mainline-back').addEventListener('click', () => { selected = null; render(); });
  document.querySelectorAll('[data-ml-tab]').forEach(button => button.addEventListener('click', () => { tab = button.dataset.mlTab; render(); }));
  $('ml-add-goal').addEventListener('click', () => {
    if (updateLine(line => line.goals.push({ id: makeFileId(), name: '', expected: '', progress: 0, qa: model.questions.map(question => ({ id: makeFileId(), question, answer: '' })) }))) {
      render(); $('ml-goal-list').lastElementChild.querySelector('input').focus();
    }
  });
  function renderGoals(line) {
    const list = $('ml-goal-list');
    list.innerHTML = line.goals.map(goal => `<article class="ml-editor-card" data-goal="${escape(goal.id)}">
      <div class="ml-fields"><label class="ml-field">目标名称<input data-field="name" maxlength="120" value="${escape(goal.name)}" placeholder="想完成什么？"></label><label class="ml-field">预期时间<input type="datetime-local" data-field="expected" value="${escape(goal.expected)}"></label></div>
      <div class="ml-progress-heading"><span>目标进度</span><output>${goal.progress}%</output></div><input class="ml-range" type="range" min="0" max="100" step="1" value="${goal.progress}" aria-label="目标进度" style="--progress:${goal.progress}%">
      <div class="ml-qa"><h3>Q&A / 给自己的提问</h3>${goal.qa.map(qa => `<div class="ml-qa-row" data-qa="${escape(qa.id)}"><label class="ml-field">问题<input data-field="question" maxlength="500" value="${escape(qa.question)}" placeholder="写下一个问题"></label><label class="ml-field">回答<textarea data-field="answer" maxlength="10000" placeholder="写下你的回答……">${escape(qa.answer)}</textarea></label></div>`).join('')}<button class="ml-small-button" type="button" data-add-qa>＋ 添加问题</button></div>
    </article>`).join('') || '<p class="ml-empty">还没有目标。先写下想完成的事，再慢慢推进。</p>';
    list.querySelectorAll('[data-goal]').forEach(card => {
      const goalId = card.dataset.goal;
      card.addEventListener('input', event => {
        const input = event.target;
        const qaId = input.closest('[data-qa]')?.dataset.qa;
        if (input.matches('.ml-range')) {
          card.querySelector('output').textContent = `${input.value}%`;
          input.style.setProperty('--progress', `${input.value}%`);
        }
        updateLine(item => {
          const goal = item.goals.find(value => value.id === goalId);
          if (qaId) goal.qa.find(value => value.id === qaId)[input.dataset.field] = input.value;
          else if (input.matches('.ml-range')) goal.progress = Math.min(100, Math.max(0, Number(input.value)));
          else if (input.dataset.field) goal[input.dataset.field] = input.value;
        });
      });
      card.querySelector('[data-add-qa]').addEventListener('click', () => {
        if (updateLine(item => item.goals.find(goal => goal.id === goalId).qa.push({ id: makeFileId(), question: '', answer: '' }))) {
          render();
          [...list.querySelectorAll('[data-goal]')].find(value => value.dataset.goal === goalId).querySelector('.ml-qa-row:last-of-type input').focus();
        }
      });
    });
  }
  $('ml-add-achievement').addEventListener('click', () => {
    if (updateLine(line => line.achievements.push({ id: makeFileId(), name: '', description: '', photos: [] }))) {
      render(); $('ml-achievement-list').lastElementChild.querySelector('input').focus();
    }
  });
  // Wait for transaction completion before saving photo references.
  async function savePhotos(files) {
    const photos = files.map(file => ({ id: makeFileId(), name: file.name, type: file.type, size: file.size, blob: file }));
    if (window.CloudClient?.isLoggedIn()) {
      for (const photo of photos) {
        try { await CloudClient.upload(photo.blob, photo.id); } catch (error) { console.warn('云端照片上传失败', error); }
      }
    }
    const db = await fileDb;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(FILE_STORE, 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('照片保存失败'));
      photos.forEach(photo => transaction.objectStore(FILE_STORE).put({ ...photo, id: attachmentStorageId(photo.id) }));
    });
    return photos.map(({ blob, ...photo }) => photo);
  }
  function renderAchievements(line) {
    const list = $('ml-achievement-list');
    list.innerHTML = line.achievements.map(achievement => `<article class="ml-editor-card" data-achievement="${escape(achievement.id)}">
      <label class="ml-field">成就名称<input data-field="name" maxlength="120" value="${escape(achievement.name)}" placeholder="给这个时刻起个名字"></label>
      <div class="ml-photo-strip" tabindex="0" role="region" aria-label="成就照片，可左右滑动">${achievement.photos.map((photo, index) => `<figure class="ml-photo"><img data-photo="${escape(photo.id)}" alt="${escape(photo.name)}"><figcaption>${index + 1} / ${achievement.photos.length}</figcaption></figure>`).join('')}</div>
      <div class="ml-photo-toolbar"><label class="ml-small-button ml-photo-upload">＋ 添加照片<input type="file" accept="image/*" multiple aria-label="添加成就照片"></label>${achievement.photos.length > 1 ? '<button class="ml-small-button" type="button" data-slide="-1" aria-label="上一张照片">←</button><button class="ml-small-button" type="button" data-slide="1" aria-label="下一张照片">→</button><span class="hint">左右滑动查看照片</span>' : ''}</div>
      <label class="ml-field">成就描述<textarea data-field="description" maxlength="10000" placeholder="记录这份成就背后的故事……">${escape(achievement.description)}</textarea></label>
    </article>`).join('') || '<p class="ml-empty">每一次小小的突破，都值得被记住。</p>';
    list.querySelectorAll('[data-achievement]').forEach(card => {
      const achievementId = card.dataset.achievement;
      card.addEventListener('input', event => {
        if (!event.target.dataset.field) return;
        updateLine(item => { item.achievements.find(value => value.id === achievementId)[event.target.dataset.field] = event.target.value; });
      });
      card.querySelectorAll('[data-slide]').forEach(button => button.addEventListener('click', () => {
        const strip = card.querySelector('.ml-photo-strip');
        strip.scrollBy({ left: Number(button.dataset.slide) * (strip.clientWidth + 12), behavior: 'smooth' });
      }));
      card.querySelector('[type=file]').addEventListener('change', async event => {
        const input = event.target;
        const files = [...input.files];
        if (!files.length) return;
        if (files.some(file => !file.type.startsWith('image/'))) { toast('请选择图片文件'); input.value = ''; return; }
        const key = storageKey(KEY), lineId = selected;
        input.disabled = true;
        $('ml-save-status').textContent = '正在保存照片…';
        try {
          const photos = await savePhotos(files);
          const success = update(lines => {
            const achievement = lines.find(item => item.id === lineId)?.achievements.find(item => item.id === achievementId);
            if (!achievement) throw new Error('成就不存在');
            achievement.photos.push(...photos);
          }, key);
          if (success && storageKey(KEY) === key && selected === lineId && !$('mainline-view').hidden) render();
        } catch (error) { console.error(error); toast('照片保存失败，请检查本机存储空间'); }
        finally { input.disabled = false; input.value = ''; }
      });
    });
    list.querySelectorAll('[data-photo]').forEach(async image => {
      try {
        const file = await readAttachment(image.dataset.photo);
        if (!image.isConnected || $('mainline-view').hidden || tab !== 'achievements') return;
        if (!file?.blob && window.CloudClient?.isLoggedIn()) { try { await CloudClient.openFile({ id: image.dataset.photo, name: image.alt || '照片' }); return; } catch (_) {} }
        if (!file?.blob) { image.alt = '照片暂时无法读取'; return; }
        const url = URL.createObjectURL(file.blob);
        urls.add(url); image.src = url;
      } catch (error) { image.alt = '照片暂时无法读取'; }
    });
  }
  function renderLogs(line) {
    const logs = model.logs(savedPlans, state, line.name);
    const months = new Map();
    logs.forEach(log => {
      const month = log.date.slice(0, 7);
      if (!months.has(month)) months.set(month, new Map());
      const days = months.get(month);
      if (!days.has(log.date)) days.set(log.date, []);
      days.get(log.date).push(log);
    });
    $('ml-log-list').innerHTML = [...months].map(([month, days]) => `<section class="ml-log-month"><h3>${escape(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月</h3><div class="ml-log-days">${[...days].map(([date, tasks]) => `<div class="ml-log-day"><time class="ml-log-date" datetime="${escape(date)}">${Number(date.slice(8))} 日</time>${tasks.map(task => `<button type="button" class="ml-log-task${task.done ? ' done' : ''}" data-date="${escape(date)}" title="打开这一天的计划"><span aria-label="${task.done ? '已完成' : '未完成'}">${task.done ? '✓' : '○'}</span><span>${escape(task.text)}</span></button>`).join('')}</div>`).join('')}</div></section>`).join('') || '<p class="ml-empty">还没有关联的每日任务。<br>在每日的任务输入框中输入 []，选择「主线」和这条主线的名称。</p>';
    $('ml-log-list').querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
      const date = button.dataset.date;
      if (date === state.date) { showChecklistView(); updateSummary(); }
      else { const plan = savedPlans.find(item => item.date === date); if (plan) openSavedPlan(plan); }
    }));
  }

  const menu = document.createElement('div');
  menu.id = 'ml-suggestions'; menu.hidden = true; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', '主线标记补全');
  document.body.append(menu);
  let completion = null;
  function closeSuggestions() {
    if (completion) {
      completion.input.setAttribute('aria-expanded', 'false');
      completion.input.removeAttribute('aria-activedescendant');
    }
    menu.hidden = true; completion = null;
  }
  function positionMenu() {
    if (!completion) return;
    const rect = completion.input.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    menu.style.top = `${Math.max(12, rect.bottom + menu.offsetHeight + 8 > window.innerHeight ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6)}px`;
  }
  function showSuggestions(input) {
    if (!input.matches('.task-input')) return;
    const match = model.completion(input.value, input.selectionStart);
    if (!match) return closeSuggestions();
    let options;
    try { options = match.stage === 'kind' ? ['主线'] : read().map(line => line.name).filter(name => name.includes(match.query)); }
    catch (error) { return closeSuggestions(); }
    closeSuggestions();
    completion = { input, match, options, index: 0 };
    input.setAttribute('aria-controls', menu.id); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
    menu.innerHTML = options.length ? options.map((name, index) => `<button type="button" role="option" tabindex="-1" id="ml-option-${index}" data-index="${index}" aria-selected="${index === 0}">${escape(name)}</button>`).join('') : '<p>暂无匹配主线，请先在主线页面添加。</p>';
    if (options.length) input.setAttribute('aria-activedescendant', 'ml-option-0');
    menu.hidden = false; positionMenu();
  }
  function chooseSuggestion(index) {
    if (!completion || !completion.options[index]) return;
    const { input, match, options } = completion;
    const token = match.stage === 'kind' ? '[主线-]' : model.tag(options[index]);
    const caret = match.start + token.length - (match.stage === 'kind' ? 1 : 0);
    input.value = input.value.slice(0, match.start) + token + input.value.slice(match.end);
    input.focus(); input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (match.stage === 'name') closeSuggestions();
  }
  menu.addEventListener('pointerdown', event => {
    const option = event.target.closest('[data-index]');
    if (!option) return;
    event.preventDefault(); chooseSuggestion(Number(option.dataset.index));
  });
  document.addEventListener('input', event => { if (!event.isComposing && event.target.matches('.task-input')) showSuggestions(event.target); });
  document.addEventListener('compositionend', event => { if (event.target.matches('.task-input')) showSuggestions(event.target); });
  document.addEventListener('click', event => { if (event.target.matches('.task-input')) showSuggestions(event.target); else if (!menu.contains(event.target)) closeSuggestions(); });
  document.addEventListener('focusout', event => { if (event.target === completion?.input) closeSuggestions(); });
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || !completion || event.target !== completion.input) return;
    if (event.key === 'Escape' || event.key === 'Tab') { closeSuggestions(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') { closeSuggestions(); return; }
    if (!completion.options.length) return;
    if (event.key === 'Enter') { event.preventDefault(); chooseSuggestion(completion.index); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      completion.index = (completion.index + (event.key === 'ArrowDown' ? 1 : -1) + completion.options.length) % completion.options.length;
      menu.querySelectorAll('[data-index]').forEach((option, index) => option.setAttribute('aria-selected', String(index === completion.index)));
      const option = $(`ml-option-${completion.index}`);
      completion.input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  });
  window.addEventListener('resize', positionMenu);
  document.addEventListener('scroll', positionMenu, true);
  window.addEventListener('storage', event => {
    if (event.key === storageKey(KEY) && !$('mainline-view').hidden) render();
  });
})();
