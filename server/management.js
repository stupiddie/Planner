const crypto = require('node:crypto');

module.exports = function management(app, { pool, requireUser, passwordHash, passwordMatches }) {
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: '需要管理员权限' });
  const page = req => Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const size = 30;
  const idValid = id => /^[1-9]\d{0,19}$/.test(id);
  const fail = (res, message) => res.status(400).json({ error: message });

  app.post('/api/account/activity', requireUser, (req, res) => res.status(204).end());
  app.post('/api/account/password', requireUser, wrap(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (typeof oldPassword !== 'string' || oldPassword.length > 200 || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200) return fail(res, '请输入原密码，新密码需要 8–200 个字符');
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!rows[0] || !(await passwordMatches(oldPassword, rows[0].password_hash))) return fail(res, '原密码不正确');
    const hash = await passwordHash(newPassword);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await db.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
      await db.execute('DELETE FROM sessions WHERE user_id=?', [req.user.id]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
    res.status(204).end();
  }));

  app.post('/api/feedback', requireUser, wrap(async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const images = req.body?.images ?? [];
    if (message.length > 5000 || !Array.isArray(images) || images.length > 3 || (!message && !images.length)) return fail(res, '请填写反馈或选择图片，文字最多 5000 字，图片最多 3 张');
    const decoded = [];
    let bytes = 0;
    for (const image of images) {
      const match = typeof image === 'string' && image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) return fail(res, '仅支持 PNG、JPEG、WebP 图片');
      const content = Buffer.from(match[2], 'base64');
      const mime = match[1];
      const valid = mime === 'image/png' ? content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? content.subarray(0, 3).equals(Buffer.from([255,216,255])) : content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP';
      bytes += content.length;
      if (!valid || content.length > 1024 * 1024 || bytes > 2 * 1024 * 1024) return fail(res, '图片格式无效，或单张超过 1 MB、合计超过 2 MB');
      decoded.push({ id: crypto.randomUUID(), mime, content });
    }
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      // Serialize per-user submissions so the daily limit also holds under concurrency.
      await db.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id]);
      const [[{ count }]] = await db.execute('SELECT COUNT(*) AS count FROM feedback WHERE user_id=? AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY', [req.user.id]);
      if (count >= 20) { await db.rollback(); return res.status(429).json({ error: '今天提交较多，请明天再试' }); }
      const [result] = await db.execute('INSERT INTO feedback (user_id,message) VALUES (?,?)', [req.user.id, message]);
      for (const image of decoded) await db.execute('INSERT INTO feedback_images (id,feedback_id,mime,content) VALUES (?,?,?,?)', [image.id, result.insertId, image.mime, image.content]);
      await db.commit();
      res.status(201).json({ id: result.insertId });
    } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
  }));

  async function feedbackList(req, res, all) {
    const current = page(req);
    const where = all ? '' : 'WHERE f.user_id=?';
    const params = all ? [] : [req.user.id];
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM feedback f ${where}`, params);
    const [items] = await pool.query(`SELECT f.id, f.user_id, u.username, f.message, f.status, f.created_at FROM feedback f JOIN users u ON u.id=f.user_id ${where} ORDER BY f.id DESC LIMIT ? OFFSET ?`, [...params, size, (current - 1) * size]);
    if (items.length) {
      const [images] = await pool.query('SELECT id,feedback_id FROM feedback_images WHERE feedback_id IN (?)', [items.map(item => item.id)]);
      for (const item of items) item.images = images.filter(image => String(image.feedback_id) === String(item.id)).map(image => image.id);
    }
    res.json({ items, total, page: current, pageSize: size });
  }
  app.get('/api/feedback', requireUser, wrap((req, res) => feedbackList(req, res, false)));
  app.get('/api/feedback/images/:id', requireUser, wrap(async (req, res) => {
    const [rows] = await pool.execute('SELECT i.mime,i.content FROM feedback_images i JOIN feedback f ON f.id=i.feedback_id WHERE i.id=? AND (f.user_id=? OR ?=\'admin\')', [req.params.id, req.user.id, req.user.role]);
    if (!rows[0]) return res.status(404).json({ error: '图片不存在' });
    res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(rows[0].content);
  }));

  app.get('/api/admin/summary', requireUser, admin, wrap(async (req, res) => {
    const [[users]] = await pool.query('SELECT COUNT(*) AS totalUsers FROM users');
    const [[activity]] = await pool.query('SELECT COALESCE(SUM(last_seen_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY),0) AS active24h, COALESCE(SUM(last_seen_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY),0) AS active7d, COALESCE(SUM(last_seen_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY),0) AS active30d FROM user_activity');
    const [[feedback]] = await pool.query("SELECT COUNT(*) AS totalFeedback, COALESCE(SUM(status='new'),0) AS newFeedback FROM feedback");
    res.json(Object.fromEntries(Object.entries({ ...users, ...activity, ...feedback }).map(([key, value]) => [key, Number(value)])));
  }));
  app.get('/api/admin/users', requireUser, admin, wrap(async (req, res) => {
    const current = page(req);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
    const [items] = await pool.query("SELECT u.id,u.username,u.created_at,COALESCE(r.role,'user') AS role,a.last_seen_at,(SELECT COUNT(*) FROM user_activity_days d WHERE d.user_id=u.id AND d.active_date >= UTC_DATE() - INTERVAL 29 DAY) AS activeDays30 FROM users u LEFT JOIN user_roles r ON r.user_id=u.id LEFT JOIN user_activity a ON a.user_id=u.id ORDER BY u.id DESC LIMIT ? OFFSET ?", [size, (current - 1) * size]);
    res.json({ items, total, page: current, pageSize: size });
  }));
  app.get('/api/admin/feedback', requireUser, admin, wrap((req, res) => feedbackList(req, res, true)));
  app.patch('/api/admin/feedback/:id', requireUser, admin, wrap(async (req, res) => {
    if (!idValid(req.params.id) || !['new', 'read', 'resolved'].includes(req.body?.status)) return fail(res, '反馈状态无效');
    const [result] = await pool.execute('UPDATE feedback SET status=? WHERE id=?', [req.body.status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: '反馈不存在' });
    res.status(204).end();
  }));
  app.post('/api/admin/users/:id/reset-password', requireUser, admin, wrap(async (req, res) => {
    if (!idValid(req.params.id)) return fail(res, '用户无效');
    const password = crypto.randomBytes(18).toString('base64url');
    const hash = await passwordHash(password);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const [users] = await db.execute("SELECT u.id,COALESCE(r.role,'user') AS role FROM users u LEFT JOIN user_roles r ON r.user_id=u.id WHERE u.id=? FOR UPDATE", [req.params.id]);
      if (!users[0]) { await db.rollback(); return res.status(404).json({ error: '用户不存在' }); }
      if (users[0].role === 'admin') { await db.rollback(); return fail(res, '管理员请在账户中修改自己的密码'); }
      await db.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.id]);
      await db.execute('DELETE FROM sessions WHERE user_id=?', [req.params.id]);
      await db.commit();
      res.set('Cache-Control', 'no-store').json({ temporaryPassword: password });
    } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
  }));
};
