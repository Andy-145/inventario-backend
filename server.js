// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const productosRoutes   = require('./routes/productos');
const categoriasRoutes  = require('./routes/categorias');
const proveedoresRoutes = require('./routes/proveedores');
const usuariosRoutes    = require('./routes/usuarios');
const movimientosRoutes = require('./routes/movimientos');
const reportesRoutes    = require('./routes/reportes');
// const uploadsRoutes  = require('./routes/uploads'); // ❌ ya no es necesario con Cloudinary

const app = express();

// CORS (si quieres restringir dominios, usa CORS_ORIGIN=dominio1,dominio2)
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
}));

// Body parsers con límites altos para base64
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/', (req, res) => res.send('API de Inventario funcionando ✅'));

// Monta routers (sin /api/uploads si migraste a Cloudinary)
app.use('/api/productos',   productosRoutes);
app.use('/api/categorias',  categoriasRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/usuarios',    usuariosRoutes);
app.use('/api/movimientos', movimientosRoutes);
app.use('/api/reportes',    reportesRoutes);

// Manejador de errores (evita que un throw mate el servicio)
app.use((err, req, res, next) => {
  console.error('❌ Error no controlado:', err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log('Backend listo (DB conectada en módulo ./db)');
});

