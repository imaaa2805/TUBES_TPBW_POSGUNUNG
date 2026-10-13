require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const prisma = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', apiRoutes);

// Fallback route for SPA navigation
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🏔️ KANIMAP - Sistem Geospasial Pemetaan Jalur Basecamp & Pos Gunung`);
  console.log(`🚀 Server aktif di: http://localhost:${PORT}`);
  console.log(`📡 API Gunung:    http://localhost:${PORT}/api/gunung`);
  console.log(`⛺ API Basecamp:  http://localhost:${PORT}/api/basecamp`);
  console.log(`📍 API Pos:       http://localhost:${PORT}/api/pos`);
  console.log(`📊 API Statistik: http://localhost:${PORT}/api/stats`);
  console.log(`=======================================================`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nMematikan server...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Server ditutup dengan aman.');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
});
