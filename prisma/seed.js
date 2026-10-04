const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const prisma = require('../config/database');

// Helper to create URL-safe slug
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

// Helper to parse numbers safely
function parseElevation(str) {
  if (!str) return 2000;
  const num = parseInt(str.toString().replace(/[^0-9]/g, ''), 10);
  return isNaN(num) || num === 0 ? 2000 : num;
}

// Special status for active volcanic / restricted peaks
function getMountainStatus(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('semeru')) {
    return { statusVulkanik: 'Siaga Level 3', statusJalur: 'Tutup', kuotaHarian: 0, kuotaTersisa: 0 };
  }
  if (n.includes('merapi') && !n.includes('merbabu')) {
    return { statusVulkanik: 'Siaga Level 3', statusJalur: 'Tutup', kuotaHarian: 0, kuotaTersisa: 0 };
  }
  if (n.includes('slamet')) {
    return { statusVulkanik: 'Waspada Level 2', statusJalur: 'Waspada', kuotaHarian: 200, kuotaTersisa: 85 };
  }
  if (n.includes('raung')) {
    return { statusVulkanik: 'Waspada Level 2', statusJalur: 'Waspada', kuotaHarian: 150, kuotaTersisa: 40 };
  }
  if (n.includes('bromo')) {
    return { statusVulkanik: 'Waspada Level 2', statusJalur: 'Waspada', kuotaHarian: 300, kuotaTersisa: 120 };
  }
  return { statusVulkanik: 'Normal', statusJalur: 'Buka', kuotaHarian: 250, kuotaTersisa: Math.floor(Math.random() * 120 + 80) };
}

// Water source detection
const WATER_KEYWORDS = ['air', 'mata air', 'sendang', 'sumber', 'ranu', 'banyu', 'sungai', 'curug', 'danau', 'sumur', 'pancuran'];
function checkWaterAvailability(posName) {
  const lower = (posName || '').toLowerCase();
  return WATER_KEYWORDS.some(k => lower.includes(k));
}

async function seed() {
  console.log('🏔️ Memulai seeding database Jalur Pendakian & Pos Gunung Pulau Jawa...\n');

  const csvPath = path.join(__dirname, '..', 'database', 'jalur_pendakian.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File CSV tidak ditemukan di: ${csvPath}`);
    process.exit(1);
  }

  // 1. Bersihkan data lama
  console.log('🧹 Menghapus data lama...');
  await prisma.logPembaruan.deleteMany({});
  await prisma.posGunung.deleteMany({});
  await prisma.basecamp.deleteMany({});
  await prisma.gunung.deleteMany({});
  console.log('✅ Data lama berhasil dibersihkan.\n');

  // 2. Baca file CSV
  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => rows.push(data))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📄 Total baris terbaca dari CSV: ${rows.length}`);

  // 3. Kelompokkan data berdasarkan Gunung -> Jalur Via -> Pos
  const mountainMap = new Map();

  for (const row of rows) {
    const rawGunung = (row.nama_gunung || '').trim();
    if (!rawGunung) continue;

    const provinsi = (row.provinsi || 'Jawa Tengah').trim();
    const kabupaten = (row.kabupaten || '').trim();
    const ketinggian = parseElevation(row.ketinggian);
    const jalurVia = (row.jalur_via || 'Jalur Utama').trim();
    const namaPos = (row.nama_pos || 'Pos Pendakian').trim();
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);

    if (isNaN(lat) || isNaN(lng)) continue;

    if (!mountainMap.has(rawGunung)) {
      mountainMap.set(rawGunung, {
        nama: rawGunung,
        provinsi,
        kabupaten,
        ketinggian,
        jalurs: new Map()
      });
    }

    const gData = mountainMap.get(rawGunung);
    // Update regency/height if missing
    if (!gData.kabupaten && kabupaten) gData.kabupaten = kabupaten;
    if (ketinggian > gData.ketinggian) gData.ketinggian = ketinggian;

    if (!gData.jalurs.has(jalurVia)) {
      gData.jalurs.set(jalurVia, {
        jalurVia,
        provinsi,
        kabupaten,
        posList: []
      });
    }

    gData.jalurs.get(jalurVia).posList.push({
      namaPos,
      lat,
      lng,
      adaAir: checkWaterAvailability(namaPos)
    });
  }

  console.log(`🏔️ Total gunung unik: ${mountainMap.size}`);

  let totalBasecampsCreated = 0;
  let totalPosCreated = 0;
  const existingSlugs = new Set();

  for (const [namaGunung, gInfo] of mountainMap.entries()) {
    let baseSlug = slugify(namaGunung);
    if (!baseSlug) baseSlug = 'gunung-' + Math.floor(Math.random() * 10000);
    let finalSlug = baseSlug;
    let counter = 1;
    while (existingSlugs.has(finalSlug)) {
      finalSlug = `${baseSlug}-${counter++}`;
    }
    existingSlugs.add(finalSlug);

    const statusObj = getMountainStatus(namaGunung);

    // Hitung titik representatif puncak (ambil pos terakhir / tertinggi)
    let peakLat = null;
    let peakLng = null;
    let allPosInGunung = [];
    for (const j of gInfo.jalurs.values()) {
      allPosInGunung.push(...j.posList);
    }
    if (allPosInGunung.length > 0) {
      const lastPos = allPosInGunung[allPosInGunung.length - 1];
      peakLat = lastPos.lat;
      peakLng = lastPos.lng;
    }

    const createdGunung = await prisma.gunung.create({
      data: {
        nama: namaGunung,
        slug: finalSlug,
        provinsi: gInfo.provinsi,
        kabupaten: gInfo.kabupaten || 'Pulau Jawa',
        ketinggian: gInfo.ketinggian,
        statusVulkanik: statusObj.statusVulkanik,
        statusJalur: statusObj.statusJalur,
        kuotaHarian: statusObj.kuotaHarian,
        kuotaTersisa: statusObj.kuotaTersisa,
        cuacaSuhu: Math.floor(Math.random() * 8 + 8), // 8 - 16 °C di dataran tinggi
        cuacaKondisi: 'Cerah Berawan',
        latitude: peakLat,
        longitude: peakLng,
        deskripsi: `Jalur pendakian resmi ${namaGunung} dengan ketinggian ${gInfo.ketinggian} MDPL di wilayah ${gInfo.kabupaten}, ${gInfo.provinsi}.`,
      }
    });

    // Buat Basecamp dan Pos
    for (const [jalurName, jInfo] of gInfo.jalurs.entries()) {
      const posArr = jInfo.posList;
      if (posArr.length === 0) continue;

      // Cari pos yang memiliki nama Basecamp atau gunakan pos pertama
      const bcCandidate = posArr.find(p => p.namaPos.toLowerCase().includes('basecamp')) || posArr[0];
      const bcLat = bcCandidate.lat;
      const bcLng = bcCandidate.lng;
      const bcElevation = Math.max(500, Math.round(gInfo.ketinggian * 0.45));

      const createdBasecamp = await prisma.basecamp.create({
        data: {
          gunungId: createdGunung.id,
          nama: `Basecamp ${jalurName}`,
          jalurVia: jalurName,
          totalPos: posArr.length,
          status: statusObj.statusJalur,
          latitude: bcLat,
          longitude: bcLng,
          elevasi: bcElevation,
          kontak: '0812-3456-' + Math.floor(1000 + Math.random() * 9000),
          simaksiInfo: 'Registrasi Online & On-the-spot di pos registrasi resmi.',
          sumber: 'Direktori Jalur Pendakian Jawa Timur, Jateng, Jabar & DIY'
        }
      });
      totalBasecampsCreated++;

      // Masukkan PosGunung
      const elevStep = Math.round((gInfo.ketinggian - bcElevation) / (posArr.length || 1));
      for (let idx = 0; idx < posArr.length; idx++) {
        const p = posArr[idx];
        const estElev = Math.min(gInfo.ketinggian, bcElevation + (idx + 1) * elevStep);

        await prisma.posGunung.create({
          data: {
            basecampId: createdBasecamp.id,
            namaPos: p.namaPos,
            urutan: idx + 1,
            latitude: p.lat,
            longitude: p.lng,
            elevasi: estElev,
            adaAir: p.adaAir,
            areaCamp: idx < posArr.length - 1, // semua pos kecuali puncak punya area camp
            keterangan: p.adaAir ? 'Tersedia sumber mata air untuk pendaki' : 'Tempat istirahat & shelter darurat'
          }
        });
        totalPosCreated++;
      }
    }
  }

  console.log(`\n🎉 SEEDING SELESAI DENGAN SUKSES!`);
  console.log(`⛰️  Total Gunung:    ${mountainMap.size}`);
  console.log(`🏕️  Total Basecamp:  ${totalBasecampsCreated}`);
  console.log(`📍 Total Pos Gunung: ${totalPosCreated}`);
}

seed()
  .catch((err) => {
    console.error('❌ Error saat seeding:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
