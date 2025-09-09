// routes/reportes.js
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// -----------------------
// Helpers de parámetros
// -----------------------
function rangoFechas(q) {
  const now = new Date();
  const hoy = now.toISOString().slice(0, 10);
  const hace30 = new Date(now); hace30.setDate(now.getDate() - 30);

  const from = (q.from || q.desde || hace30.toISOString().slice(0, 10));
  const to   = (q.to   || q.hasta || hoy);

  return {
    from, to,
    fromDT: `${from} 00:00:00`,
    toDT:   `${to} 23:59:59`
  };
}
function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function tipoValido(t) {
  if (!t) return null;
  const x = String(t).toLowerCase();
  return (x === 'entrada' || x === 'salida') ? x : null;
}
function sanitizeLimit(v, def = 5, max = 100) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 1), max);
}

// ===============================
// GET /api/reportes/total-productos
// ===============================
router.get('/total-productos', async (_req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*)::int AS total_productos FROM productos');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('⛔ GET /reportes/total-productos:', err);
    res.status(500).json({ error: 'Error al obtener total de productos' });
  }
});

// ===============================
// GET /api/reportes/total-unidades
// ===============================
router.get('/total-unidades', async (_req, res) => {
  try {
    const result = await db.query('SELECT COALESCE(SUM(cantidad),0)::int AS total_unidades FROM productos');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('⛔ GET /reportes/total-unidades:', err);
    res.status(500).json({ error: 'Error al obtener total de unidades' });
  }
});

// ===============================
// GET /api/reportes/valor-total
// ===============================
router.get('/valor-total', async (_req, res) => {
  try {
    const result = await db.query('SELECT COALESCE(SUM(cantidad * precio_unitario),0) AS valor_total FROM productos');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('⛔ GET /reportes/valor-total:', err);
    res.status(500).json({ error: 'Error al obtener valor total' });
  }
});

// ===============================
// GET /api/reportes/mayor-stock?limit=5
// ===============================
router.get('/mayor-stock', async (req, res) => {
  const limit = sanitizeLimit(req.query.limit, 5, 100);
  try {
    const result = await db.query(
      'SELECT id_producto, nombre, cantidad FROM productos ORDER BY cantidad DESC LIMIT $1',
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /reportes/mayor-stock:', err);
    res.status(500).json({ error: 'Error al obtener productos con mayor stock' });
  }
});

// ===============================
// GET /api/reportes/menor-stock?limit=5
// ===============================
router.get('/menor-stock', async (req, res) => {
  const limit = sanitizeLimit(req.query.limit, 5, 100);
  try {
    const result = await db.query(
      'SELECT id_producto, nombre, cantidad FROM productos ORDER BY cantidad ASC LIMIT $1',
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /reportes/menor-stock:', err);
    res.status(500).json({ error: 'Error al obtener productos con menor stock' });
  }
});

// ===============================
// GET /api/reportes/stock-bajo
// ===============================
router.get('/stock-bajo', async (_req, res) => {
  const sql = `
    SELECT id_producto, nombre, cantidad, stock_min
    FROM productos
    WHERE cantidad <= stock_min
    ORDER BY (stock_min - cantidad) DESC, nombre ASC
  `;
  try {
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /reportes/stock-bajo:', err);
    res.status(500).json({ error: 'Error al obtener productos con stock bajo' });
  }
});

// ===============================
// GET /api/reportes/kpis
// ===============================
router.get('/kpis', async (req, res) => {
  const { from, to, fromDT, toDT } = rangoFechas(req.query);
  try {
    const v     = await db.query('SELECT COALESCE(SUM(cantidad * precio_unitario),0) AS valor_total FROM productos');
    const a     = await db.query('SELECT COUNT(*)::int AS en_alerta FROM productos WHERE cantidad < stock_min');
    const ent   = await db.query("SELECT COALESCE(SUM(cantidad),0)::int AS entradas FROM movimientos WHERE tipo='entrada' AND fecha BETWEEN $1 AND $2", [fromDT, toDT]);
    const sal   = await db.query("SELECT COALESCE(SUM(cantidad),0)::int AS salidas  FROM movimientos WHERE tipo='salida'  AND fecha BETWEEN $1 AND $2", [fromDT, toDT]);
    const costo = await db.query(`
      SELECT COALESCE(SUM(m.cantidad * p.precio_unitario),0) AS costo_salidas
      FROM movimientos m
      JOIN productos p ON p.id_producto = m.id_producto
      WHERE m.tipo='salida' AND m.fecha BETWEEN $1 AND $2
    `, [fromDT, toDT]);

    res.json({
      rango: { from, to },
      valorInventario: Number(v.rows[0].valor_total || 0),
      enAlerta:        Number(a.rows[0].en_alerta || 0),
      entradasPeriodo: Number(ent.rows[0].entradas || 0),
      salidasPeriodo:  Number(sal.rows[0].salidas  || 0),
      costoSalidas:    Number(costo.rows[0].costo_salidas || 0),
    });
  } catch (err) {
    console.error('⛔ GET /reportes/kpis:', err);
    res.status(500).json({ error: 'Error al obtener KPIs' });
  }
});

// ===============================
// GET /api/reportes/series-entradas-salidas
// ===============================
router.get('/series-entradas-salidas', async (req, res) => {
  const { from, to, fromDT, toDT } = rangoFechas(req.query);
  const usuarioId = intOrNull(req.query.usuarioId);
  const tipo      = tipoValido(req.query.tipo);

  let where = 'm.fecha BETWEEN $1 AND $2';
  const params = [fromDT, toDT];
  if (usuarioId) { where += ` AND m.id_usuario = $${params.length+1}`; params.push(usuarioId); }
  if (tipo)      { where += ` AND m.tipo = $${params.length+1}`;       params.push(tipo); }

  const sql = `
    SELECT DATE(m.fecha) AS dia,
           SUM(CASE WHEN m.tipo='entrada' THEN m.cantidad ELSE 0 END) AS entradas,
           SUM(CASE WHEN m.tipo='salida'  THEN m.cantidad ELSE 0 END) AS salidas
    FROM movimientos m
    WHERE ${where}
    GROUP BY DATE(m.fecha)
    ORDER BY dia
  `;
  try {
    const result = await db.query(sql, params);
    res.json({ rango: { from, to }, series: result.rows });
  } catch (err) {
    console.error('⛔ GET /reportes/series-entradas-salidas:', err);
    res.status(500).json({ error: 'Error al obtener series' });
  }
});

// ===============================
// GET /api/reportes/top-consumo
// ===============================
router.get('/top-consumo', async (req, res) => {
  const { from, to, fromDT, toDT } = rangoFechas(req.query);
  const limit = sanitizeLimit(req.query.limit, 5, 50);

  const sql = `
    SELECT p.id_producto, p.nombre, SUM(m.cantidad)::int AS total_salidas
    FROM movimientos m
    JOIN productos p ON p.id_producto = m.id_producto
    WHERE m.tipo='salida' AND m.fecha BETWEEN $1 AND $2
    GROUP BY p.id_producto, p.nombre
    ORDER BY total_salidas DESC
    LIMIT $3
  `;
  try {
    const result = await db.query(sql, [fromDT, toDT, limit]);
    res.json({ rango: { from, to }, items: result.rows });
  } catch (err) {
    console.error('⛔ GET /reportes/top-consumo:', err);
    res.status(500).json({ error: 'Error al obtener top de consumo' });
  }
});

// ===============================
// GET /api/reportes/consumo-por-categoria
// ===============================
router.get('/consumo-por-categoria', async (req, res) => {
  const { from, to, fromDT, toDT } = rangoFechas(req.query);

  const sql = `
    SELECT c.id_categoria,
           c.nombre AS categoria,
           COALESCE(SUM(m.cantidad),0)::int AS total
    FROM movimientos m
    JOIN productos  p ON p.id_producto  = m.id_producto
    LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
    WHERE m.tipo='salida' AND m.fecha BETWEEN $1 AND $2
    GROUP BY c.id_categoria, c.nombre
    ORDER BY total DESC
  `;
  try {
    const result = await db.query(sql, [fromDT, toDT]);
    res.json({ rango: { from, to }, items: result.rows });
  } catch (err) {
    console.error('⛔ GET /reportes/consumo-por-categoria:', err);
    res.status(500).json({ error: 'Error al obtener consumo por categoría' });
  }
});

// ===============================
// GET /api/reportes/movimientos-por-usuario
// ===============================
router.get('/movimientos-por-usuario', async (req, res) => {
  const { from, to, fromDT, toDT } = rangoFechas(req.query);

  const sql = `
    SELECT u.id_usuario, u.nombre,
           SUM(CASE WHEN m.tipo='entrada' THEN m.cantidad ELSE 0 END) AS entradas,
           SUM(CASE WHEN m.tipo='salida'  THEN m.cantidad ELSE 0 END) AS salidas
    FROM movimientos m
    LEFT JOIN usuarios u ON u.id_usuario = m.id_usuario
    WHERE m.fecha BETWEEN $1 AND $2
    GROUP BY u.id_usuario, u.nombre
    ORDER BY salidas DESC, entradas DESC
  `;
  try {
    const result = await db.query(sql, [fromDT, toDT]);
    res.json({ rango: { from, to }, items: result.rows });
  } catch (err) {
    console.error('⛔ GET /reportes/movimientos-por-usuario:', err);
    res.status(500).json({ error: 'Error al obtener movimientos por usuario' });
  }
});

// ===============================
// GET /api/reportes/export.csv
// ===============================
router.get('/export.csv', async (req, res) => {
  const { from, to, fromDT, toDT } = rangoFechas(req.query);
  const usuarioId = intOrNull(req.query.usuarioId);
  const tipo      = tipoValido(req.query.tipo);

  let where = 'm.fecha BETWEEN $1 AND $2';
  const params = [fromDT, toDT];
  if (usuarioId) { where += ` AND m.id_usuario=$${params.length+1}`; params.push(usuarioId); }
  if (tipo)      { where += ` AND m.tipo=$${params.length+1}`;       params.push(tipo); }

  const sql = `
    SELECT to_char(m.fecha, 'YYYY-MM-DD HH24:MI:SS') AS fecha,
           m.tipo,
           p.codigo,
           p.nombre AS producto,
           m.cantidad,
           p.precio_unitario,
           (m.cantidad * p.precio_unitario) AS total,
           c.nombre AS categoria,
           u.nombre AS usuario
    FROM movimientos m
    JOIN productos  p ON p.id_producto  = m.id_producto
    LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
    LEFT JOIN usuarios  u ON u.id_usuario   = m.id_usuario
    WHERE ${where}
    ORDER BY m.fecha DESC
  `;
  try {
    const result = await db.query(sql, params);

    const headers = ['fecha','tipo','codigo','producto','cantidad','precio_unitario','total','categoria','usuario'];
    let csv = headers.join(',') + '\n';
    for (const r of result.rows) {
      const line = headers.map(h => {
        const val = (r[h] ?? '');
        const s = String(val).replace(/"/g, '""');
        return `"${s}"`;
      }).join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="movimientos.csv"');
    res.send(csv);
  } catch (err) {
    console.error('⛔ GET /reportes/export.csv:', err);
    res.status(500).json({ error: 'Error al exportar CSV' });
  }
});

module.exports = router;


