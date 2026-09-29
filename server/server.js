const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'penguin_planner',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const normalizePlan = (source, fallbackDate) => {
  const raw = source && typeof source === 'object' ? source : {};
  const timeline = (Array.isArray(raw.timeline) ? raw.timeline : []).map((event, index) => ({
    id: typeof event?.id === 'string' && event.id ? event.id : `timeline-${index}`,
    start: Number.isInteger(event?.start) ? event.start : -1,
    end: Number.isInteger(event?.end) ? event.end : -1,
    text: typeof event?.text === 'string' ? event.text : '',
    folded: Boolean(event?.folded)
  })).filter(event => event.start >= 0 && event.end <= 1440 && event.end > event.start);
  return {
    date: raw.date || fallbackDate,
    story: typeof raw.story === 'string' ? raw.story : '',
    timeline,
    savedAt: raw.savedAt || new Date().toISOString(),
    groups: Array.isArray(raw.groups) ? raw.groups.map(group => ({
      name: typeof group?.name === 'string' ? group.name : '',
      tasks: Array.isArray(group?.tasks) ? group.tasks.map(task => ({
        text: typeof task?.text === 'string' ? task.text : '',
        done: Boolean(task?.done),
        note: typeof task?.note === 'string' ? task.note : '',
        files: Array.isArray(task?.files) ? task.files : []
      })) : []
    })) : []
  };
};

const dateKeyFromDatabase = value => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
const isoFromDatabase = value => typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();

const toPlan = (rows) => {
  if (!rows.length) return null;
  const plan = {
    date: dateKeyFromDatabase(rows[0].plan_date),
    story: rows[0].story,
    timeline: typeof rows[0].timeline === 'string' ? JSON.parse(rows[0].timeline || '[]') : (rows[0].timeline || []),
    savedAt: isoFromDatabase(rows[0].saved_at),
    groups: []
  };
  const groups = new Map();
  rows.forEach(row => {
    if (row.group_id !== null && !groups.has(row.group_id)) {
      const group = { name: row.group_name, tasks: [] };
      groups.set(row.group_id, group);
      plan.groups.push(group);
    }
    if (row.group_id !== null && row.task_id !== null) {
      groups.get(row.group_id).tasks.push({
        text: row.task_text,
        done: Boolean(row.task_done),
        note: row.task_note,
        files: typeof row.task_files === 'string' ? JSON.parse(row.task_files) : (row.task_files || [])
      });
    }
  });
  return plan;
};

const planQuery = `
  SELECT p.plan_date, p.story, p.timeline, p.saved_at,
         g.id AS group_id, g.name AS group_name,
         t.id AS task_id, t.text AS task_text, t.done AS task_done,
         t.note AS task_note, t.files AS task_files
  FROM plans p
  LEFT JOIN plan_groups g ON g.plan_id = p.id
  LEFT JOIN tasks t ON t.group_id = g.id
`;

const readPlans = async (date) => {
  const params = [];
  let sql = `${planQuery} `;
  if (date) {
    sql += 'WHERE p.plan_date = ? ';
    params.push(date);
  }
  sql += 'ORDER BY p.plan_date DESC, g.sort_order ASC, t.sort_order ASC';
  const [rows] = await pool.execute(sql, params);
  const grouped = new Map();
  rows.forEach(row => {
    const key = dateKeyFromDatabase(row.plan_date);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return [...grouped.values()].map(toPlan).filter(Boolean);
};

const savePlan = async (source, date) => {
  const plan = normalizePlan(source, date);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO plans (plan_date, story, timeline, saved_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE story = VALUES(story), timeline = VALUES(timeline), saved_at = VALUES(saved_at)`,
      [plan.date, plan.story, JSON.stringify(plan.timeline), new Date(plan.savedAt)]
    );
    const [planRows] = await connection.execute('SELECT id FROM plans WHERE plan_date = ?', [plan.date]);
    const planId = planRows[0].id;
    await connection.execute('DELETE FROM plan_groups WHERE plan_id = ?', [planId]);
    for (let gi = 0; gi < plan.groups.length; gi += 1) {
      const group = plan.groups[gi];
      const [groupResult] = await connection.execute(
        'INSERT INTO plan_groups (plan_id, name, sort_order) VALUES (?, ?, ?)',
        [planId, group.name, gi]
      );
      for (let ti = 0; ti < group.tasks.length; ti += 1) {
        const task = group.tasks[ti];
        await connection.execute(
          'INSERT INTO tasks (group_id, text, done, note, files, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [groupResult.insertId, task.text, task.done, task.note, JSON.stringify(task.files || []), ti]
        );
      }
    }
    await connection.commit();
    return (await readPlans(plan.date))[0] || plan;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: true, message: '企鹅计划后端已经启动' });
  } catch (error) {
    res.status(503).json({ ok: false, database: false, message: '后端已启动，但数据库连接失败' });
  }
});

app.get('/api/plans', async (req, res, next) => {
  try { res.json(await readPlans()); } catch (error) { next(error); }
});

app.get('/api/plans/:date', async (req, res, next) => {
  try {
    const plan = (await readPlans(req.params.date))[0];
    if (!plan) return res.status(404).json({ error: '计划不存在' });
    res.json(plan);
  } catch (error) { next(error); }
});

app.put('/api/plans/:date', async (req, res, next) => {
  try { res.json(await savePlan(req.body, req.params.date)); } catch (error) { next(error); }
});

app.delete('/api/plans/:date', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM plans WHERE plan_date = ?', [req.params.date]);
    if (!result.affectedRows) return res.status(404).json({ error: '计划不存在' });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: '服务器内部错误' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
