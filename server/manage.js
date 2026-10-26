// Run on the server: node manage.js migrate | grant-admin <existing username>
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  const [command, username] = process.argv.slice(2);
  if (!['migrate', 'grant-admin'].includes(command) || (command === 'grant-admin' && !username)) {
    throw new Error('Usage: node manage.js migrate | grant-admin <existing username>');
  }
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), database: process.env.MYSQL_DATABASE || 'penguin_planner', user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  try {
    if (command === 'migrate') {
      for (const sql of fs.readFileSync(path.join(__dirname, 'management-schema.sql'), 'utf8').split(';').filter(sql => sql.trim())) await db.query(sql);
      const [[displayName]] = await db.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='display_name'");
      if (!Number(displayName.count)) await db.query("ALTER TABLE users ADD COLUMN display_name VARCHAR(60) NOT NULL DEFAULT '' AFTER username");
      console.log('Management tables ready. Existing accounts and plans preserved.');
    } else {
      const [users] = await db.execute('SELECT id FROM users WHERE BINARY username = BINARY ?', [username]);
      if (users.length !== 1) throw new Error('Existing username not found; no account was created or promoted.');
      await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin') ON DUPLICATE KEY UPDATE role='admin'", [users[0].id]);
      console.log('Administrator role granted to the existing account.');
    }
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
