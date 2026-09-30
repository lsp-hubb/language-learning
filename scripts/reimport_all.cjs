const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 换机后改这里即可（也可用环境变量 TXT_DIR 覆盖）
const TXT_DIR = process.env.TXT_DIR || 'D:\\PythonFiles\\temp\\2021.10分散';
// 目标文件夹（可用环境变量 FOLDER_ID 覆盖，免去每次改脚本）
// 默认值：「考研英语」= 15579f79-99e7-42ae-a76e-18d4dfdf4eeb（根目录，parent_id 为 null）
// 旧值备查：2021.10 = 53e1c8c7-d6a0-480f-9ebd-02f2dc21b280
const FOLDER_ID = process.env.FOLDER_ID || '15579f79-99e7-42ae-a76e-18d4dfdf4eeb';

if (!fs.existsSync(TXT_DIR)) {
  console.error(`TXT 目录不存在: ${TXT_DIR}`);
  console.error('请修改脚本顶部的 TXT_DIR，或设置环境变量 TXT_DIR 后重试。');
  process.exit(1);
}

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'language_learning', waitForConnections: true,
  });

  // 判定目标文件夹是否位于「考研英语」目录下（祖先链任意一层命中即生效，含其子目录）。
  // 若是 → 本次导入仅保留标题、正文留空：考研英语文章的内容需分「原文 / 题目 / 答案」
  // 三块录入，直接把外刊正文塞进 content 会与试题页结构冲突，故进入文章后再粘贴原文。
  // 其他文件夹不受影响，仍按原样导入「标题 + 正文」。
  async function isKaoyanFolder(folderId) {
    try {
      const [rows] = await pool.query('SELECT id, name, parent_id FROM folders');
      const map = new Map(rows.map((r) => [r.id, r]));
      let cur = map.get(folderId);
      let guard = 0;
      while (cur && guard++ < 50) {
        if (String(cur.name || '').trim() === '考研英语') return true;
        if (!cur.parent_id) break;
        cur = map.get(cur.parent_id);
      }
    } catch (_) {}
    return false;
  }

  const titleOnly = await isKaoyanFolder(FOLDER_ID);
  console.log(`导入模式: ${titleOnly ? '考研英语目录 → 仅导入标题（正文留空）' : '普通目录 → 标题 + 正文'}`);

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
    // 考研英语目录：仅导入标题，正文留空（内容在进入文章后通过试题页录入）
    const body = titleOnly ? '' : lines.slice(1).join('\n').trim();

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
