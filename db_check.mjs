import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: +process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'language_learning',
});

const [rows] = await pool.query(
  "SELECT id, paragraph_notes FROM articles WHERE id = '5b973745-4b87-45f6-816d-be0a86c8055a'"
);
if (rows.length) {
  console.log('数据库查到文章:', { id: rows[0].id });
  console.log('paragraph_notes 原始类型:', typeof rows[0].paragraph_notes);
  console.log('paragraph_notes 原始值:', rows[0].paragraph_notes);
} else {
  console.log('未找到该文章');
}
await pool.end();
