const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { promisify } = require('util');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const sessionDays = Number(process.env.SESSION_DAYS || 30);
const cookieName = 'penguin_session';
const scrypt = promisify(crypto.scrypt);
const pool = mysql.createPool({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), database: process.env.MYSQL_DATABASE || 'penguin_planner', user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '', connectionLimit: 10, charset: 'utf8mb4' });

app.use(express.json({ limit: '4mb' }));
app.use(express.raw({ type: '*/*', limit: '16mb' }));
app.use(cookieParser());
app.use(express.static(require('path').join(__dirname, '..')));

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const passwordHash = async password => { const salt = crypto.randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64); return `scrypt$${salt}$${derived.toString('hex')}`; };
const passwordMatches = async (password, stored) => { const [, salt, hex] = String(stored).split('$'); if (!salt || !hex) return false; const derived = await scrypt(password, salt, 64); const expected = Buffer.from(hex, 'hex'); return expected.length === derived.length && crypto.timingSafeEqual(expected, derived); };
const validCredential = value => typeof value === 'string' && value.trim().length >= 3 && value.trim().length <= 120;
const sessionCookie = { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: sessionDays * 86400000, path: '/' };

async function currentUser(req) {
  const token = req.cookies[cookieName]; if (!token) return null;
  const [rows] = await pool.execute('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > UTC_TIMESTAMP()', [hashToken(token)]);
  return rows[0] || null;
}
async function requireUser(req, res, next) { try { req.user = await currentUser(req); if (!req.user) return res.status(401).json({ error: '请先登录' }); next(); } catch (error) { next(error); } }

app.post('/api/account/register', async (req, res, next) => {
  try { const username = String(req.body?.username || '').trim(); const password = String(req.body?.password || ''); if (!validCredential(username) || password.length < 8 || password.length > 200) return res.status(400).json({ error: '用户名至少 3 个字符，密码至少 8 个字符' }); const hash = await passwordHash(password); const [result] = await pool.execute('INSERT INTO users (username,password_hash) VALUES (?,?)', [username, hash]); await createSession(result.insertId, res); res.status(201).json({ id: result.insertId, username }); }
  catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名已存在' }); next(error); }
});
app.post('/api/account/login', async (req, res, next) => {
  try { const username = String(req.body?.username || '').trim(); const password = String(req.body?.password || ''); const [rows] = await pool.execute('SELECT id,username,password_hash FROM users WHERE username=?', [username]); if (!rows[0] || !(await passwordMatches(password, rows[0].password_hash))) return res.status(401).json({ error: '用户名或密码错误' }); await createSession(rows[0].id, res); res.json({ id: rows[0].id, username: rows[0].username }); } catch (error) { next(error); }
});
async function createSession(userId, res) { const token = crypto.randomBytes(32).toString('base64url'); const expires = new Date(Date.now() + sessionDays * 86400000); await pool.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)', [hashToken(token), userId, expires]); res.cookie(cookieName, token, sessionCookie); }
app.post('/api/account/logout', async (req, res, next) => { try { const token = req.cookies[cookieName]; if (token) await pool.execute('DELETE FROM sessions WHERE token_hash=?', [hashToken(token)]); res.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', secure: sessionCookie.secure, path: '/' }); res.status(204).end(); } catch (error) { next(error); } });
app.get('/api/account/me', async (req, res, next) => { try { const user = await currentUser(req); if (!user) return res.status(401).json({ error: '未登录' }); res.json(user); } catch (error) { next(error); } });

app.get('/api/data', requireUser, async (req, res, next) => { try { const [rows] = await pool.execute('SELECT data_json FROM user_data WHERE user_id=?', [req.user.id]); res.json(rows[0] ? (typeof rows[0].data_json === 'string' ? JSON.parse(rows[0].data_json) : rows[0].data_json) : {}); } catch (error) { next(error); } });
app.put('/api/data', requireUser, async (req, res, next) => { try { const data = req.body; if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: '数据必须是 JSON 对象' }); await pool.execute('INSERT INTO user_data (user_id,data_json) VALUES (?,?) ON DUPLICATE KEY UPDATE data_json=VALUES(data_json)', [req.user.id, JSON.stringify(data)]); res.status(204).end(); } catch (error) { next(error); } });

app.put('/api/files/:id', requireUser, async (req, res, next) => { try { if (!/^[0-9a-f-]{20,50}$/i.test(req.params.id) || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: '文件无效' }); let name = String(req.get('x-file-name') || '未命名文件'); try { name = decodeURIComponent(name); } catch (_) {} name = name.slice(0, 255); const mime = String(req.get('content-type') || 'application/octet-stream').slice(0, 255); await pool.execute('INSERT INTO user_files (id,user_id,name,mime,content) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),mime=VALUES(mime),content=VALUES(content)', [req.params.id, req.user.id, name, mime, req.body]); res.status(204).end(); } catch (error) { next(error); } });
app.get('/api/files/:id', requireUser, async (req, res, next) => { try { const [rows] = await pool.execute('SELECT name,mime,content FROM user_files WHERE id=? AND user_id=?', [req.params.id, req.user.id]); if (!rows[0]) return res.status(404).json({ error: '文件不存在' }); res.set({ 'Content-Type': rows[0].mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}` }); res.send(rows[0].content); } catch (error) { next(error); } });
app.delete('/api/files/:id', requireUser, async (req, res, next) => { try { await pool.execute('DELETE FROM user_files WHERE id=? AND user_id=?', [req.params.id, req.user.id]); res.status(204).end(); } catch (error) { next(error); } });
app.use((error, req, res, next) => { console.error(error); if (!res.headersSent) res.status(500).json({ error: '服务器暂时无法处理请求' }); });
if (require.main === module) app.listen(port, () => console.log(`Planner server listening on ${port}`));
module.exports = app;
