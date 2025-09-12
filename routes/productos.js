// routes/productos.js
'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const cloudinary = require('../config/cloudinary');

const multer = require('multer');
const streamifier = require('streamifier');

// --- Multer: recibimos archivo en memoria (campo 'imagen') ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 7 * 1024 * 1024 }, // 7 MB
});

// ===============================
// Helpers Cloudinary
// ===============================
function uploadBufferToCloudinary(buffer, folder = 'productos') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

/**
 * Sube nueva imagen desde file o base64; si había una anterior, la borra.
 * @returns {Promise<{url: string|null, publicId: string|null}>}
 */
async function handleImageUpload({ file, base64, currentPublicId }) {
  let url = null;
  let publicId = currentPublicId || null;

  if (file?.buffer) {
    const up = await uploadBufferToCloudinary(file.buffer, 'productos');
    url = up.secure_url;
    // si reemplaza, borra la anterior
    if (currentPublicId) {
      try { await cloudinary.uploader.destroy(currentPublicId); } catch (_) {}
    }
    publicId = up.public_id;
  } else if (base64 && base64.startsWith('data:')) {
    const up = await cloudinary.uploader.upload(base64, { folder: 'productos' });
    url = up.secure_url;
    if (currentPublicId) {
      try { await cloudinary.uploader.destroy(currentPublicId); } catch (_) {}
    }
    publicId = up.public_id;
  } else if (base64 && /^https?:\/\//i.test(base64)) {
    // URL externa
    url = base64;
  }

  return { url, publicId };
}

function normUnidad(tipo_unidad) {
  const ALLOWED = ['Kilogramo', 'Litro', 'Pieza'];
  return ALLOWED.includes(tipo_unidad) ? tipo_unidad : 'Pieza';
}

// ===============================
// GET: listar productos
// ===============================
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM productos ORDER BY id_producto DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('⛔ GET /productos:', err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// ===============================
// POST: agregar producto
// Acepta:
//  - multipart/form-data con archivo "imagen"
//  - JSON con imagen_url en base64 (data URI) o una URL http(s)
// ===============================
// POST /api/productos
router.post('/', (req, res) => {
  // ejecuta multer y captura sus errores
  upload.single('imagen')(req, res, async (multerErr) => {
    if (multerErr) {
      const code = multerErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      console.error('⛔ Multer error:', multerErr);
      return res.status(code).json({
        error: 'UPLOAD_ERROR',
        detail: multerErr.message || String(multerErr),
      });
    }

    const {
      codigo, nombre, descripcion, cantidad, precio_unitario,
      stock_min, stock_max, fecha_ingreso, imagen_url,
      id_categoria, id_proveedor, tipo_unidad, id_usuario
    } = req.body;

    // Normaliza tipos
    const unidad       = normUnidad(tipo_unidad);
    const cantNum      = Number(cantidad) || 0;
    const precioNum    = Number(precio_unitario) || 0;
    const stockMinNum  = Number(stock_min) || 0;
    const stockMaxNum  = Number(stock_max) || 0;
    const idCatNum     = id_categoria ? Number(id_categoria) : null;
    const idProvNum    = id_proveedor ? Number(id_proveedor) : null;
    const fechaSql     = (fecha_ingreso && String(fecha_ingreso).trim() !== '')
                          ? String(fecha_ingreso).trim()
                          : null;

    let uploadedPublicId = null;
    let finalUrl = null;
    let finalPublicId = null;

    const client = await db.connect();
    try {
      // 1) Subir imagen (si viene)
      if (req.file) {
        const up = await uploadBufferToCloudinary(req.file.buffer, 'productos');
        finalUrl      = up.secure_url;
        finalPublicId = uploadedPublicId = up.public_id;
      } else if (imagen_url && imagen_url.startsWith('data:')) {
        const up = await cloudinary.uploader.upload(imagen_url, { folder: 'productos' });
        finalUrl      = up.secure_url;
        finalPublicId = uploadedPublicId = up.public_id;
      } else if (imagen_url && imagen_url.startsWith('http')) {
        finalUrl = imagen_url; // URL externa
      }

      // 2) Transacción
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO productos
         (codigo, nombre, descripcion, cantidad, tipo_unidad, precio_unitario,
          stock_min, stock_max, fecha_ingreso, imagen_url, imagen_public_id,
          id_categoria, id_proveedor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          codigo, nombre, descripcion, cantNum, unidad, precioNum,
          stockMinNum, stockMaxNum, fechaSql, finalUrl, finalPublicId,
          idCatNum, idProvNum
        ]
      );

      const producto = ins.rows[0];
      const newId = producto.id_producto ?? producto.id;

      // 3) Movimiento 'entrada' si la cantidad inicial > 0
      if (cantNum > 0) {
        await client.query(
          `INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha)
           VALUES ($1, 'entrada', $2, $3, NOW())`,
          [newId, cantNum, id_usuario ? Number(id_usuario) : null]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({
        message: cantNum > 0
          ? 'Producto agregado y movimiento registrado'
          : 'Producto agregado',
        producto
      });
    } catch (err) {
      await client.query('ROLLBACK');

      if (uploadedPublicId) {
        try { await cloudinary.uploader.destroy(uploadedPublicId); } catch (_) {}
      }

      if (err.code === '23505') {
        return res.status(409).json({
          error: 'CODIGO_DUPLICADO',
          message: 'El código ya existe. Usa PUT /api/productos/:id o /api/productos/:id/ingresar.'
        });
      }

      console.error('⛔ POST /productos:', { code: err.code, detail: err.detail, message: err.message });
      return res.status(500).json({ error: 'Error al agregar producto', code: err.code, detail: err.detail || err.message });
    } finally {
      client.release();
    }
  });
});

// ===============================
// PUT: editar producto (puede reemplazar imagen)
// Registra movimiento 'editado'
// ===============================
router.put('/:id', upload.single('imagen'), async (req, res) => {
  const { id } = req.params;
  const {
    codigo, nombre, descripcion, cantidad, precio_unitario,
    stock_min, stock_max, fecha_ingreso, imagen_url,
    id_categoria, id_proveedor, id_usuario, tipo_unidad,
  } = req.body;

  try {
    // Tomar public_id/url actuales para decidir acciones
    const prevQ = await db.query(
      'SELECT imagen_public_id, imagen_url FROM productos WHERE id_producto=$1',
      [id]
    );
    if (prevQ.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    const prev = prevQ.rows[0];

    const unidad = normUnidad(tipo_unidad);

    const { url: newUrl, publicId } = await handleImageUpload({
      file: req.file,
      base64: imagen_url, // si mandan base64 en JSON
      currentPublicId: prev.imagen_public_id || null,
    });

    const finalUrl =
      newUrl ??
      (imagen_url && /^https?:\/\//i.test(imagen_url) ? imagen_url : prev.imagen_url);

    const finalPublicId = publicId ?? prev.imagen_public_id ?? null;

    await db.query(
      `UPDATE productos SET
         codigo=$1, nombre=$2, descripcion=$3, cantidad=$4, tipo_unidad=$5, precio_unitario=$6,
         stock_min=$7, stock_max=$8, fecha_ingreso=$9,
         imagen_url=$10, imagen_public_id=$11,
         id_categoria=$12, id_proveedor=$13
       WHERE id_producto=$14`,
      [
        codigo,
        nombre,
        descripcion ?? '',
        Number(cantidad ?? 0),
        unidad,
        Number(precio_unitario ?? 0),
        Number(stock_min ?? 0),
        Number(stock_max ?? 0),
        fecha_ingreso,
        finalUrl,
        finalPublicId,
        id_categoria,
        id_proveedor,
        id,
      ]
    );

    await db.query(
      `INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha)
       VALUES ($1, 'editado', $2, $3, NOW())`,
      [id, Number(cantidad) || 0, id_usuario ?? null]
    );

    res.json({ message: 'Producto editado y movimiento registrado' });
  } catch (err) {
    console.error('⛔ PUT /productos/:id:', err);
    res.status(500).json({ error: 'Error al editar producto', detail: err.message });
  }
});

// ===============================
// DELETE: eliminar producto
// - guarda snapshot de nombre/codigo
// - borra imagen en Cloudinary si existe
// ===============================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { id_usuario } = req.body || {};

  try {
    const snap = await db.query(
      'SELECT nombre, codigo, imagen_public_id FROM productos WHERE id_producto=$1',
      [id]
    );
    if (snap.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    const prod = snap.rows[0];

    await db.query(
      `INSERT INTO movimientos
         (id_producto, id_usuario, tipo, cantidad, fecha, producto_nombre, producto_codigo)
       VALUES ($1,$2,'eliminado',0,NOW(),$3,$4)`,
      [id, id_usuario ?? null, prod.nombre, prod.codigo]
    );

    if (prod.imagen_public_id) {
      try { await cloudinary.uploader.destroy(prod.imagen_public_id); } catch (_) {}
    }

    await db.query('DELETE FROM productos WHERE id_producto=$1', [id]);

    res.json({ message: 'Producto eliminado (imagen Cloudinary borrada si existía)' });
  } catch (err) {
    console.error('⛔ DELETE /productos/:id:', err);
    res.status(500).json({ error: 'Error al eliminar producto', detail: err.message });
  }
});

// ===============================
// POST: consumir producto (salida)
// ===============================
router.post('/:id/consumir', async (req, res) => {
  const { id } = req.params;
  const { cantidad, id_usuario } = req.body || {};
  const cant = Number(cantidad);

  if (!id || isNaN(Number(id))) return res.status(400).json({ error: 'ID inválido' });
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
      `INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha)
       VALUES ($1, 'salida', $2, $3, NOW()) RETURNING id_movimiento`,
      [id, cant, id_usuario ?? null]
    );

    await client.query('COMMIT');
    res.json({
      message: 'Consumo registrado',
      nuevo_stock: nuevo,
      id_movimiento: mov.rows[0].id_movimiento,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('⛔ POST /productos/:id/consumir:', err);
    res.status(500).json({ error: 'Error al registrar consumo', detail: err.message });
  } finally {
    client.release();
  }
});

// ===============================
// POST: ingresar producto (entrada)
// ===============================
router.post('/:id/ingresar', async (req, res) => {
  const { id } = req.params;
  const { cantidad, id_usuario } = req.body || {};
  const cant = Number(cantidad);

  if (!id || isNaN(Number(id))) return res.status(400).json({ error: 'ID inválido' });
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
      `INSERT INTO movimientos (id_producto, tipo, cantidad, id_usuario, fecha)
       VALUES ($1, 'entrada', $2, $3, NOW()) RETURNING id_movimiento`,
      [id, cant, id_usuario ?? null]
    );

    await client.query('COMMIT');
    res.json({
      message: 'Ingreso registrado',
      nuevo_stock: nuevo,
      id_movimiento: mov.rows[0].id_movimiento,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('⛔ POST /productos/:id/ingresar:', err);
    res.status(500).json({ error: 'Error al registrar ingreso', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
