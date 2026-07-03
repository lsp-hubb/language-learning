const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TXT_DIR = 'F:\\PythonProject\\temp\\2021.10分散';
const FOLDER_ID = '53e1c8c7-d6a0-480f-9ebd-02f2dc21b280';

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'language_learning', waitForConnections: true,
  });

  // 1. 删除旧文章
  const [del] = await pool.query('DELETE FROM articles WHERE folder_id = ?', [FOLDER_ID]);
  console.log(`已删除 ${del.affectedRows} 篇旧文章`);

  // 2. 读取TXT文件
  const files = fs.readdirSync(TXT_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    });

  console.log(`找到 ${files.length} 个 TXT 文件`);

  // 3. 导入并编号
  let success = 0;
  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(TXT_DIR, files[i]);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const rawTitle = (lines[0] || '').replace(/\r$/, '').trim();
    const body = lines.slice(1).join('\n').trim();

    if (!rawTitle) {
      console.warn(`⚠ ${files[i]}: 跳过，首行为空`);
      continue;
    }

    const title = `${i + 1}. ${rawTitle}`;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO articles (id, title, content, folder_id) VALUES (?, ?, ?, ?)',
      [id, title, body, FOLDER_ID]
    );
    console.log(`✅ ${title.slice(0, 50)}...`);
    success++;
  }

  console.log(`\n完成！成功导入 ${success}/${files.length} 篇文章`);
  await pool.end();
})();
