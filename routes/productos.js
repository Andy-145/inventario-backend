const express = require('express');
const router = express.Router();
const db = require('../db');

// ===============================
// GET: listar productos
// ===============================
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM productos');
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /productos:', err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// ===============================
// POST: agregar producto
// ===============================
router.post('/', async (req, res) => {
  const {
    codigo,
    nombre,
    descripcion,
    cantidad,
    precio_unitario,
    stock_min,
    stock_max,
    fecha_ingreso,
    imagen_url,
    id_categoria,
    id_proveedor,
    tipo_unidad,
  } = req.body;

  const ALLOWED = ['Kilogramo', 'Litro', 'Pieza'];
  const unidad = ALLOWED.includes(tipo_unidad) ? tipo_unidad : 'Pieza';

  const sql = `
    INSERT INTO productos
      (codigo, nombre, descripcion, cantidad, tipo_unidad, precio_unitario,
       stock_min, stock_max, fecha_ingreso, imagen_url, id_categoria, id_proveedor)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`;
  const values = [
    codigo, nombre, descripcion, cantidad, unidad,
    precio_unitario, stock_min, stock_max, fecha_ingreso,
    imagen_url, id_categoria, id_proveedor,
  ];

  try {
    const result = await db.query(sql, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('⛔ POST /productos:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// PUT: editar producto + registrar movimiento "editado"
// ===============================
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    codigo, nombre, descripcion, cantidad, precio_unitario,
    stock_min, stock_max, fecha_ingreso, imagen_url,
    id_categoria, id_proveedor, id_usuario, tipo_unidad,
  } = req.body;

  const ALLOWED = ['Kilogramo', 'Litro', 'Pieza'];
  const unidad = ALLOWED.includes(tipo_unidad) ? tipo_unidad : 'Pieza';

  try {
    await db.query(`
      UPDATE productos SET
        codigo=$1, nombre=$2, descripcion=$3, cantidad=$4, tipo_unidad=$5, precio_unitario=$6,
        stock_min=$7, stock_max=$8, fecha_ingreso=$9, imagen_url=$10,
        id_categoria=$11, id_proveedor=$12
      WHERE id_producto=$13
    `, [codigo, nombre, descripcion, cantidad, unidad, precio_unitario,
        stock_min, stock_max, fecha_ingreso, imagen_url, id_categoria, id_proveedor, id]);

    await db.query(`
      INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha)
      VALUES ($1, 'editado', $2, $3, NOW())
    `, [id, cantidad ?? 0, id_usuario ?? null]);

    res.json({ message: 'Producto editado y movimiento registrado' });
  } catch (err) {
    console.error('⛔ PUT /productos/:id:', err);
    res.status(500).json({ error: 'Error al editar producto' });
  }
});

// ===============================
// DELETE: eliminar producto con snapshot + movimiento
// ===============================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { id_usuario } = req.body || {};

  try {
    const snapshot = await db.query(
      'SELECT nombre, codigo FROM productos WHERE id_producto=$1',
      [id]
    );

    if (snapshot.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    const prod = snapshot.rows[0];

    await db.query(`
      INSERT INTO movimientos
        (id_producto, id_usuario, tipo, cantidad, fecha, producto_nombre, producto_codigo)
      VALUES ($1,$2,'eliminado',0,NOW(),$3,$4)
    `, [id, id_usuario ?? null, prod.nombre, prod.codigo]);

    await db.query('DELETE FROM productos WHERE id_producto=$1', [id]);

    res.json({ message: 'Producto eliminado (con snapshot)' });
  } catch (err) {
    console.error('⛔ DELETE /productos/:id:', err);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ===============================
// POST: consumir producto (salida de stock)
// ===============================
router.post('/:id/consumir', async (req, res) => {
  const { id } = req.params;
  const { cantidad, id_usuario } = req.body || {};
  const cant = Number(cantidad);

  if (!id || isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const prod = await client.query(
      'SELECT cantidad FROM productos WHERE id_producto=$1 FOR UPDATE',
      [id]
    );

    if (prod.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    const nuevo = Number(prod.rows[0].cantidad) - cant;
    if (nuevo < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }

    await client.query('UPDATE productos SET cantidad=$1 WHERE id_producto=$2', [nuevo, id]);
    const mov = await client.query(
      'INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha) VALUES ($1, $2, $3, $4, NOW()) RETURNING id_movimiento',
      [id, 'salida', cant, id_usuario ?? null]
    );

    await client.query('COMMIT');
    res.json({ message: 'Consumo registrado', nuevo_stock: nuevo, id_movimiento: mov.rows[0].id_movimiento });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('⛔ POST /productos/:id/consumir:', err);
    res.status(500).json({ error: 'Error al registrar consumo' });
  } finally {
    client.release();
  }
});

// ===============================
// POST: ingresar producto (entrada de stock)
// ===============================
router.post('/:id/ingresar', async (req, res) => {
  const { id } = req.params;
  const { cantidad, id_usuario } = req.body || {};
  const cant = Number(cantidad);

  if (!id || isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const prod = await client.query(
      'SELECT cantidad FROM productos WHERE id_producto=$1 FOR UPDATE',
      [id]
    );

    if (prod.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    const nuevo = Number(prod.rows[0].cantidad) + cant;

    await client.query('UPDATE productos SET cantidad=$1 WHERE id_producto=$2', [nuevo, id]);
    const mov = await client.query(
      'INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha) VALUES ($1, $2, $3, $4, NOW()) RETURNING id_movimiento',
      [id, 'entrada', cant, id_usuario ?? null]
    );

    await client.query('COMMIT');
    res.json({ message: 'Ingreso registrado', nuevo_stock: nuevo, id_movimiento: mov.rows[0].id_movimiento });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('⛔ POST /productos/:id/ingresar:', err);
    res.status(500).json({ error: 'Error al registrar ingreso' });
  } finally {
    client.release();
  }
});

module.exports = router;

