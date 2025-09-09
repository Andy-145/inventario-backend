// routes/usuarios.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// ===============================
// GET: listar usuarios (sin contraseña)
// ===============================
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT id_usuario, nombre, rol FROM usuarios ORDER BY id_usuario DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// ===============================
// POST: crear usuario (hash de contraseña)
// ===============================
router.post('/', async (req, res) => {
  try {
    const { nombre, contraseña, rol } = req.body || {};

    if (!nombre || !nombre.trim() || !contraseña) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    // Verifica nombre único
    const dupes = await db.query(
      'SELECT id_usuario FROM usuarios WHERE nombre=$1',
      [nombre.trim()]
    );
    if (dupes.rows.length > 0) {
      return res.status(409).json({ error: 'El nombre ya existe' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(contraseña, salt);

    const result = await db.query(
      'INSERT INTO usuarios (nombre, contraseña, rol) VALUES ($1, $2, $3) RETURNING id_usuario',
      [nombre.trim(), hash, (rol || 'Empleado').trim()]
    );

    res.status(201).json({ id_usuario: result.rows[0].id_usuario, message: 'Usuario creado' });
  } catch (err) {
    console.error('⛔ POST /usuarios:', err);
    res.status(500).json({ error: 'Error al agregar usuario' });
  }
});

// ===============================
// PUT: editar usuario (parcial); re-hash si viene nueva contraseña
// ===============================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, contraseña, rol } = req.body || {};

    const fields = [];
    const params = [];
    let idx = 1; // índice de parámetros $1, $2...

    if (typeof nombre !== 'undefined') {
      fields.push(`nombre=$${idx++}`);
      params.push(nombre?.trim() || null);
    }

    if (typeof rol !== 'undefined') {
      fields.push(`rol=$${idx++}`);
      params.push(rol?.trim() || null);
    }

    if (typeof contraseña !== 'undefined') {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(contraseña, salt);
      fields.push(`contraseña=$${idx++}`);
      params.push(hash);
    }

    if (!fields.length) {
      return res.status(400).json({ message: 'Nada que actualizar' });
    }

    params.push(id);
    const sql = `UPDATE usuarios SET ${fields.join(', ')} WHERE id_usuario=$${idx} RETURNING *`;
    const result = await db.query(sql, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    console.error('⛔ PUT /usuarios/:id:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// ===============================
// DELETE: eliminar usuario
// ===============================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM usuarios WHERE id_usuario=$1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('⛔ DELETE /usuarios/:id:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ===============================
// POST: login por nombre (usa bcrypt)
// ===============================
router.post('/login', async (req, res) => {
  try {
    const { nombre, contraseña } = req.body || {};
    if (!nombre || !contraseña) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    const result = await db.query(
      'SELECT * FROM usuarios WHERE nombre=$1',
      [nombre]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(contraseña, user.contraseña);
    if (!ok) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    res.json({
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      rol: user.rol,
    });
  } catch (err) {
    console.error('⛔ POST /usuarios/login:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

module.exports = router;


