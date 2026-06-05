import mysql from 'mysql2/promise'
import 'dotenv/config'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'language_learning',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

/**
 * 执行 SQL 查询
 * @param {string} sql - SQL 语句
 * @param {any[]} params - 参数列表
 * @returns {Promise<[any[], any]>} [rows, fields]
 */
export async function query(sql, params) {
  const [rows, fields] = await pool.execute(sql, params)
  return [rows, fields]
}

/**
 * 获取连接池（用于事务等场景）
 */
export function getPool() {
  return pool
}

export default pool
