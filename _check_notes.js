const mysql = require('mysql2/promise');
require('dotenv').config();
(async () => {
  const p = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: +process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'language_learning',
  });
  const [rows] = await p.query(
    `SELECT id, title, paragraph_notes FROM articles WHERE paragraph_notes IS NOT NULL AND paragraph_notes != 'null' AND paragraph_notes != '{}' LIMIT 5`
  );
  console.log('有笔记的文章数:', rows.length);
  for (const a of rows) {
    console.log('---');
    console.log('文章ID:', a.id);
    console.log('标题:', (a.title || '').slice(0, 60));
    console.log('笔记类型:', typeof a.paragraph_notes);
    console.log('笔记内容:', JSON.stringify(a.paragraph_notes).slice(0, 300));
  }
  // 也检查所有文章的 paragraph_notes
  const [all] = await p.query(`SELECT id, title, paragraph_notes FROM articles LIMIT 25`);
  console.log('\n===== 所有文章 =====');
  for (const a of all) {
    console.log(`${(a.title || '').slice(0, 40).padEnd(42)} | 笔记: ${a.paragraph_notes ? '有' : '无'}`);
  }
  await p.end();
})();
