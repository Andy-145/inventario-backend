// db.js
require('dotenv').config();
const { Pool } = require('pg');

// Ajustes recomendados para entornos como Render + Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon suele requerir SSL
  // Hints: evita fugas de conexiones y timeouts raros
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30_000),      // 30s
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 10_000) // 10s
});

// Exporta igual que antes (pool tiene .query y .connect)
module.exports = pool;

// Log rápido al arrancar para confirmar conexión
(async () => {
  try {
    const r = await pool.query('SELECT current_database() AS db, NOW() AS ts');
    console.log('✅ Conectado a:', r.rows[0].db, '—', r.rows[0].ts);
  } catch (e) {
    console.error('❌ Error de conexión a PostgreSQL:', e.message);
  }
})();



