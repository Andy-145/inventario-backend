// backend/config/cloudinary.js
require('dotenv').config(); // si ya lo haces en server.js, puedes quitar esta línea
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// Aviso útil si faltan variables (opcional)
['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'].forEach(k => {
  if (!process.env[k]) console.warn(`[cloudinary] Falta la variable ${k}`);
});

module.exports = cloudinary;

