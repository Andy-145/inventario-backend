// routes/categorias.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// ===============================
// GET: todas las categorías
// ===============================
router.get('/', async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM categorias');
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /categorias:', err);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// ===============================
// POST: agregar categoría
// ===============================
router.post('/', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  }

  try {
    const result = await db.query(
      'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id_categoria',
      [nombre.trim()]
    );
    res.status(201).json({
      id: result.rows[0].id_categoria,
      message: 'Categoría agregada correctamente'
    });
  } catch (err) {
    console.error('⛔ POST /categorias:', err);
    res.status(500).json({ error: 'Error al agregar categoría' });
  }
});

// ===============================
// PUT: editar categoría
// ===============================
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  }

  try {
    const result = await db.query(
      'UPDATE categorias SET nombre=$1 WHERE id_categoria=$2 RETURNING *',
      [nombre.trim(), id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }
    res.json({ message: 'Categoría actualizada correctamente' });
  } catch (err) {
    console.error('⛔ PUT /categorias/:id:', err);
    res.status(500).json({ error: 'Error al editar categoría' });
  }
});

// ===============================
// DELETE: eliminar categoría
// Maneja FK: si hay productos que usan la categoría
// ===============================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM categorias WHERE id_categoria=$1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }
    res.json({ message: 'Categoría eliminada correctamente' });
  } catch (err) {
    // En PostgreSQL, si hay restricción FK, da error "violates foreign key constraint"
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar: hay productos usando esta categoría',
      });
    }
    console.error('⛔ DELETE /categorias/:id:', err);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

module.exports = router;

