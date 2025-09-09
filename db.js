// db.js
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

// Crear el pool de conexión con Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // necesario para Neon
  },
});

module.exports = pool;

// Log de verificación al arrancar
(async () => {
  try {
    const result = await pool.query('SELECT current_database() AS db, NOW() AS ts');
    console.log('✅ Conectado a:', result.rows[0].db, '—', result.rows[0].ts);
  } catch (e) {
    console.error('❌ Error de conexión a PostgreSQL:', e.message);
  }
})();


