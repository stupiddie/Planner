(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const button = (text, action) => { const node = el('button', text, 'secondary'); node.type = 'button'; node.addEventListener('click', action); return node; };
  const labels = { new: '待查看', read: '已查看', resolved: '已处理' };
  const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
  const dialog = el('dialog', undefined, 'community-dialog');
  dialog.id = 'community-dialog';
  dialog.setAttribute('aria-labelledby', 'community-title');
  dialog.innerHTML = '<header class="community-head"><h2 id="community-title"></h2><button type="button" aria-label="关闭">×</button></header><div class="community-body"></div>';
  document.body.append(dialog);
  const body = dialog.querySelector('.community-body');
  dialog.querySelector('header button').addEventListener('click', () => dialog.close());
  let me = null, generation = 0;
  const previewUrls = new Set();
  function releasePreviews() { previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls.clear(); }
  dialog.addEventListener('close', () => { generation++; releasePreviews(); body.replaceChildren(); });
  function open(title) {
    if (!me) { toast('请先在账户中登录'); return false; }
    closeSidebar();
    generation++;
    releasePreviews();
    $('community-title').textContent = title;
    body.replaceChildren();
    if (!dialog.open) dialog.showModal();
    return true;
  }
  const statusNode = () => { const node = el('p', '', 'community-status'); node.setAttribute('role', 'status'); return node; };
  async function busy(node, status, work) {
    node.disabled = true; status.textContent = '';
    try { await work(); } catch (error) { status.textContent = error.message || '操作失败，请重试'; }
    finally { node.disabled = false; }
  }
  function paginate(data, target, load) {
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const nav = el('div', undefined, 'community-pagination');
    const prev = button('上一页', () => load(data.page - 1)); prev.disabled = data.page <= 1;
    const next = button('下一页', () => load(data.page + 1)); next.disabled = data.page >= pages;
    nav.append(prev, el('span', `第 ${data.page} / ${pages} 页 · 共 ${data.total} 条`, 'community-meta'), next);
    target.append(nav);
  }
  function feedbackCard(item, isAdmin, refresh) {
    const card = el('article', undefined, 'community-card');
    card.append(el('h4', isAdmin ? item.username : '我的反馈'), el('div', `${time(item.created_at)} · ${labels[item.status] || item.status}`, 'community-meta'), el('p', item.message || '图片反馈', 'community-message'));
    const pictures = el('div', undefined, 'community-images');
    for (const id of item.images || []) {
      const a = el('a'); a.href = `/api/feedback/images/${encodeURIComponent(id)}`; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', '查看反馈原图');
      const img = el('img'); img.src = a.href; img.alt = '用户提交的反馈图片'; img.loading = 'lazy'; a.append(img); pictures.append(a);
    }
    card.append(pictures);
    if (isAdmin) {
      const status = statusNode();
      for (const [value, text] of Object.entries(labels)) {
        if (item.status === value) continue;
        const action = button(`标为${text}`, () => busy(action, status, async () => {
          await CloudClient.request(`/admin/feedback/${item.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:value})});
          await refresh();
        }));
        card.append(action);
      }
      card.append(status);
    }
    return card;
  }
  async function prepareImage(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
    if (file.size > 20 * 1024 * 1024) throw new Error('原图过大，请选择小于 20 MB 的图片');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片无法读取')); image.src = url; });
      const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/jpeg', .8);
      if (data.length > 900000) data = canvas.toDataURL('image/jpeg', .55);
      if (data.length > 900000) throw new Error('压缩后图片仍过大，请缩小图片再试');
      return data;
    } finally { URL.revokeObjectURL(url); }
  }
  $('nav-feedback').addEventListener('click', () => {
    if (!open('使用反馈')) return;
    body.innerHTML = '<p class="community-help">告诉我们哪里好用、哪里需要改进。反馈只向你和管理员展示，请勿上传密码或其他敏感信息。</p><form class="community-form" id="feedback-form"><label>反馈内容<textarea name="message" maxlength="5000" placeholder="描述你的使用体验或遇到的问题…"></textarea></label><label>添加图片（最多 3 张）<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="community-help">图片会自动缩小后上传。可以只提交文字或图片。</p><div class="community-previews"></div><button class="primary" type="submit">提交反馈</button></form><h3>我的反馈</h3><div id="my-feedback-list"></div>';
    const token = generation;
    const form = $('feedback-form'), input = form.elements.images;
    const status = statusNode(); form.append(status);
    const list = $('my-feedback-list');
    async function load(page = 1) {
      list.textContent = '正在加载…';
      try {
        const data = await CloudClient.request(`/feedback?page=${page}`);
        if (token !== generation) return;
        list.replaceChildren();
        if (!data.items.length) list.append(el('p', '还没有反馈，欢迎分享你的体验。', 'community-help'));
        data.items.forEach(item => list.append(feedbackCard(item, false)));
        paginate(data, list, load);
      } catch (error) { if (token === generation) list.textContent = error.message; }
    }
    input.addEventListener('change', () => {
      releasePreviews();
      const preview = form.querySelector('.community-previews'); preview.replaceChildren();
      status.textContent = input.files.length > 3 ? '最多选择 3 张图片，请重新选择。' : '';
      for (const file of [...input.files].slice(0,3)) {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type)) continue;
        const img = el('img'); img.alt = file.name; img.src = URL.createObjectURL(file); previewUrls.add(img.src); preview.append(img);
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      busy(form.querySelector('[type=submit]'), status, async () => {
        if (input.files.length > 3) throw new Error('最多选择 3 张图片');
        const message = form.elements.message.value.trim();
        if (!message && !input.files.length) throw new Error('请填写反馈或选择图片');
        status.textContent = '正在处理并提交…';
        const images = [];
        for (const file of input.files) images.push(await prepareImage(file));
        await CloudClient.request('/feedback', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,images})});
        if (token !== generation) return;
        form.reset(); releasePreviews(); form.querySelector('.community-previews').replaceChildren();
        status.textContent = '反馈已提交，谢谢你的建议！'; await load();
      });
    });
    load();
  });

  $('nav-admin').addEventListener('click', () => {
    if (me?.role !== 'admin' || !open('管理中心')) return;
    const token = generation;
    body.append(el('p', '这里仅展示账号资料、登录后的使用活跃情况及主动提交的反馈，不展示任何人的计划、主线、计时记录或私人附件。密码经过加密存储，不能查看原密码。', 'community-help'));
    const stats = el('div', undefined, 'community-stats'); body.append(stats);
    const tabs = el('div', undefined, 'community-tabs'); tabs.setAttribute('role','tablist');
    const content = el('div'); content.setAttribute('role','tabpanel');
    let tab = 'feedback', loadId = 0;
    const feedbackTab = button('用户反馈', () => { tab='feedback'; load(); });
    const usersTab = button('用户与活跃情况', () => { tab='users'; load(); });
    for (const t of [feedbackTab, usersTab]) t.setAttribute('role','tab');
    tabs.append(feedbackTab, usersTab, button('刷新', () => load())); body.append(tabs, content);
    async function load(page = 1) {
      const requestId = ++loadId;
      feedbackTab.setAttribute('aria-selected', String(tab === 'feedback')); usersTab.setAttribute('aria-selected', String(tab === 'users'));
      content.textContent = '正在加载…';
      try {
        const [summary, data] = await Promise.all([CloudClient.request('/admin/summary'), CloudClient.request(`/admin/${tab}?page=${page}`)]);
        if (token !== generation || requestId !== loadId) return;
        stats.replaceChildren();
        for (const [key, label] of [['totalUsers','注册用户'],['active24h','近 24 小时活跃'],['active7d','近 7 天活跃'],['active30d','近 30 天活跃'],['totalFeedback','全部反馈'],['newFeedback','待查看反馈']]) {
          const item = el('div', undefined, 'community-stat'); item.append(el('strong', summary[key]), el('span',label)); stats.append(item);
        }
        content.replaceChildren();
        if (tab === 'feedback') {
          if (!data.items.length) content.append(el('p', '暂时没有用户反馈。', 'community-help'));
          data.items.forEach(item => content.append(feedbackCard(item, true, () => load(page))));
        } else {
          content.append(el('p','活跃天数按 UTC 自然日计算，近 30 天包含今天。仅从本功能上线后开始记录；打开后台页面也会计入管理员自己的活跃情况。','community-help'));
          const wrap = el('div',undefined,'community-table-wrap'), table = el('table',undefined,'community-table');
          table.append(el('caption','账号与使用活动；小屏幕可左右滑动表格。'));
          const head = el('thead'), row = el('tr');
          ['账号','角色','注册时间','最近使用','近 30 天活跃天数','账号操作'].forEach(text => {const th=el('th',text);th.scope='col';row.append(th);});
          head.append(row); table.append(head);
          const rows = el('tbody');
          for (const user of data.items) {
            const tr = el('tr');
            [user.username,user.role === 'admin' ? '管理员' : '普通用户',time(user.created_at),time(user.last_seen_at),`${user.activeDays30} 天`].forEach(text => tr.append(el('td',text)));
            const action = el('td');
            if (user.role !== 'admin') {
              const status = statusNode();
              const reset = button('重置密码', () => {
                if (!confirm(`确认重置 ${user.username} 的密码？该账号的所有登录会失效。新临时密码只显示一次，请安全交给本人。`)) return;
                busy(reset, status, async () => {
                  const result = await CloudClient.request(`/admin/users/${user.id}/reset-password`, {method:'POST'});
                  if (token === generation) alert(`账号：${user.username}\n临时密码：${result.temporaryPassword}\n请安全转交本人，并让对方登录后在账户中修改密码。`);
                });
              }); action.append(reset,status);
            } else action.textContent = '在账户中修改密码';
            tr.append(action); rows.append(tr);
          }
          table.append(rows); wrap.append(table); content.append(wrap);
        }
        paginate(data, content, load);
      } catch (error) { if (token === generation && requestId === loadId) content.textContent = error.message; }
    }
    load();
  });

  $('change-password-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form.querySelector('button'), $('password-result'), async () => {
      if (form.elements.newPassword.value !== form.elements.confirmPassword.value) throw new Error('两次新密码不一致');
      await CloudClient.request('/account/password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oldPassword:form.elements.oldPassword.value,newPassword:form.elements.newPassword.value})});
      form.reset(); alert('密码已修改，所有设备需要重新登录。'); location.reload();
    });
  });
  window.addEventListener('cloud-auth-changed', event => {
    me = event.detail;
    $('nav-admin').hidden = me?.role !== 'admin';
    $('account-change-password').hidden = !me;
    $('change-password-form').reset(); $('password-result').textContent = '';
    if (dialog.open) dialog.close();
  });
  // Record visible, authenticated interaction, not time spent in a background tab.
  let lastActivitySent = 0;
  const activity = () => {
    if (!me || document.visibilityState !== 'visible' || Date.now() - lastActivitySent < 120000) return;
    lastActivitySent = Date.now();
    CloudClient.request('/account/activity', {method:'POST'}).catch(() => {});
  };
  for (const event of ['pointerdown','keydown','scroll']) document.addEventListener(event, activity, { passive:true, capture:true });
})();
