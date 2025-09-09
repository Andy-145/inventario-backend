// routes/proveedores.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// ===============================
// GET: listar todos los proveedores
// ===============================
router.get('/', async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM proveedores');
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /proveedores:', err);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// ===============================
// POST: agregar proveedor
// ===============================
router.post('/', async (req, res) => {
  const { nombre, rfc, telefono, email, direccion, contacto } = req.body || {};

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  }

  const sql = `
    INSERT INTO proveedores (nombre, rfc, telefono, email, direccion, contacto)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id_proveedor
  `;
  const params = [
    nombre.trim(),
    rfc ?? null,
    telefono ?? null,
    email ?? null,
    direccion ?? null,
    contacto ?? null,
  ];

  try {
    const result = await db.query(sql, params);
    res.status(201).json({
      id: result.rows[0].id_proveedor,
      message: 'Proveedor agregado correctamente'
    });
  } catch (err) {
    console.error('⛔ POST /proveedores:', err);
    res.status(500).json({ error: 'Error al agregar proveedor' });
  }
});

// ===============================
// PUT: editar proveedor
// ===============================
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, rfc, telefono, email, direccion, contacto } = req.body || {};

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  }

  const sql = `
    UPDATE proveedores SET
      nombre=$1, rfc=$2, telefono=$3, email=$4, direccion=$5, contacto=$6
    WHERE id_proveedor=$7
    RETURNING *
  `;
  const params = [
    nombre.trim(),
    rfc ?? null,
    telefono ?? null,
    email ?? null,
    direccion ?? null,
    contacto ?? null,
    id,
  ];

  try {
    const result = await db.query(sql, params);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Proveedor no encontrado' });
    }
    res.json({ message: 'Proveedor actualizado correctamente' });
  } catch (err) {
    console.error('⛔ PUT /proveedores/:id:', err);
    res.status(500).json({ error: 'Error al editar proveedor' });
  }
});

// ===============================
// DELETE: eliminar proveedor
// Maneja FK: si hay productos ligados, responde 409
// ===============================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM proveedores WHERE id_proveedor=$1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Proveedor no encontrado' });
    }
    res.json({ message: 'Proveedor eliminado correctamente' });
  } catch (err) {
    // En PostgreSQL, si hay restricción FK, el error es 23503
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar: hay productos usando este proveedor',
      });
    }
    console.error('⛔ DELETE /proveedores/:id:', err);
    res.status(500).json({ error: 'Error al eliminar proveedor' });
  }
});

module.exports = router;


