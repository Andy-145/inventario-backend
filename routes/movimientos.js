// routes/movimientos.js
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/movimientos
 * Lista todos los movimientos; si el producto ya no existe, usa el snapshot.
 */
router.get('/', async (_req, res) => {
  const sql = `
    SELECT
      m.id_movimiento,
      m.id_producto,
      COALESCE(m.producto_nombre, p.nombre, 'Producto') AS producto,
      COALESCE(m.producto_codigo, p.codigo)             AS producto_codigo,
      m.tipo,
      m.cantidad,
      m.fecha,
      m.id_usuario,
      u.nombre AS usuario
    FROM movimientos m
    LEFT JOIN productos p ON m.id_producto = p.id_producto
    LEFT JOIN usuarios  u ON m.id_usuario  = u.id_usuario
    ORDER BY m.fecha DESC, m.id_movimiento DESC
  `;

  try {
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /movimientos:', err);
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

/**
 * POST /api/movimientos
 */
router.post('/', async (req, res) => {
  const { id_producto, tipo, cantidad, id_usuario, fecha } = req.body || {};

  if (!tipo || typeof cantidad === 'undefined' || typeof id_usuario === 'undefined') {
    return res.status(400).json({ error: 'tipo, cantidad e id_usuario son obligatorios' });
  }

  const sql = `
    INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha)
    VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
    RETURNING id_movimiento
  `;
  const params = [id_producto ?? null, tipo, cantidad, id_usuario, fecha ?? null];

  try {
    const result = await db.query(sql, params);
    res.status(201).json({ id: result.rows[0].id_movimiento, message: 'Movimiento registrado' });
  } catch (err) {
    console.error('⛔ POST /movimientos:', err);
    res.status(500).json({ error: 'Error al registrar movimiento' });
  }
});

/**
 * PUT /api/movimientos/:id
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { id_producto, tipo, cantidad, fecha, id_usuario } = req.body || {};

  const fields = [];
  const params = [];
  let idx = 1;

  if (typeof id_producto !== 'undefined') { fields.push(`id_producto=$${idx++}`); params.push(id_producto); }
  if (typeof tipo        !== 'undefined') { fields.push(`tipo=$${idx++}`);       params.push(tipo); }
  if (typeof cantidad    !== 'undefined') { fields.push(`cantidad=$${idx++}`);   params.push(cantidad); }
  if (typeof fecha       !== 'undefined') { fields.push(`fecha=$${idx++}`);      params.push(fecha); }
  if (typeof id_usuario  !== 'undefined') { fields.push(`id_usuario=$${idx++}`); params.push(id_usuario); }

  if (!fields.length) return res.status(400).json({ message: 'Nada que actualizar' });

  params.push(id);
  const sql = `UPDATE movimientos SET ${fields.join(', ')} WHERE id_movimiento=$${idx} RETURNING *`;

  try {
    const result = await db.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Movimiento no encontrado' });
    res.json({ message: 'Movimiento actualizado correctamente' });
  } catch (err) {
    console.error('⛔ PUT /movimientos/:id:', err);
    res.status(500).json({ error: 'Error al actualizar movimiento' });
  }
});

/**
 * DELETE /api/movimientos/:id
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM movimientos WHERE id_movimiento=$1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Movimiento no encontrado' });
    res.json({ message: 'Movimiento eliminado correctamente' });
  } catch (err) {
    console.error('⛔ DELETE /movimientos/:id:', err);
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
});

module.exports = router;




