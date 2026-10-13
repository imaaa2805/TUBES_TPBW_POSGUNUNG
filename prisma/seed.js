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

// Verified Accurate Peak Coordinates (Gunung Pulau Jawa)
const PEAK_COORDS = {
  'Gunung Lawu': [-7.6258, 111.1920],
  'Gunung Argopuro': [-7.9467, 113.5661],
  'Gunung Kawi': [-7.9420, 112.4510],
  'Gunung Arjuno': [-7.7692, 112.5910],
  'Gunung Penanggunan': [-7.6160, 112.6275],
  'Gunung Kelud': [-7.9275, 112.3012],
  'Gunung Panderman': [-7.9052, 112.4895],
  'Gunung Raung': [-8.1245, 114.0421],
  'Gunung Welirang': [-7.7310, 112.5760],
  'Gunung Wilis': [-7.8100, 111.7580],
  'Gunung Ciremai': [-6.8920, 108.4030],
  'Gunung Pangrango': [-6.7785, 106.9742],
  'Gunung Gede': [-6.7821, 106.9812],
  'Gunung Cikurai': [-7.3228, 107.8614],
  'Gunung Papandayan': [-7.3200, 107.7300],
  'Gunung Salak': [-6.7160, 106.7340],
  'Gunung Burangrang': [-6.7750, 107.5550],
  'Gunung Manglayang': [-6.8770, 107.7460],
  'Gunung Tampomas': [-6.7700, 107.9550],
  'Gunung Slamet': [-7.2422, 109.2081],
  'Gunung Sumbing': [-7.3842, 110.0701],
  'Gunung Merbabu': [-7.4542, 110.4392],
  'Gunung Sindoro': [-7.3012, 109.9982],
  'Gunung Merapi': [-7.5407, 110.4457],
  'Gunung Prau': [-7.1852, 109.9192],
  'Gunung Ungaran': [-7.1802, 110.3342],
  'Gunung Andong': [-7.3892, 110.3642],
  'Gunung Muria': [-6.6210, 110.9020]
};

const REAL_BC_COORDS = {
  'Basecamp Tretes': [-7.7121, 112.6285],
  'Basecamp Tambaksari': [-7.7380, 112.6710],
  'Basecamp Kare (Madiun)': [-7.7520, 111.7250],
  'Basecamp Bajulan (Nganjuk)': [-7.7650, 111.8320],
  'Basecamp Bareng (Nganjuk': [-7.7780, 111.8150],
  'Basecamp Mojo/Dolo (Kediri)': [-7.8250, 111.8620],
  'Basecamp CandiPenampihan & Jurang Senggani (Tulungagung)': [-7.8680, 111.7750],
  'Basecamp Botoputih (Trenggalek)': [-7.8720, 111.7210],
  'Basecamp Cikajang': [-7.3480, 107.8350],
  'Basecamp Kebun Teh': [-7.3320, 107.8420],
  'Basecamp Cisurupan': [-7.3190, 107.7420],
  'Basecamp Cidahu': [-6.7440, 106.7410],
  'Basecamp Pasir Reungit': [-6.6730, 106.6980],
  'Basecamp Cimelati': [-6.7620, 106.7720],
  'Basecamp Ajisaka': [-6.6850, 106.7150],
  'Basecamp Legok haji': [-6.7620, 107.5680],
  'Basecamp Komando': [-6.7580, 107.5450],
  'Basecamp Pasanggarahan': [-6.7850, 107.5420],
  'Basecamp Pangheotan': [-6.7880, 107.5650],
  'Basecamp Batu kuda': [-6.8920, 107.7450],
  'Basecamp Palintang': [-6.8620, 107.7350],
  'Basecamp Barubatu': [-6.8850, 107.7250],
  'Basecamp Narimbang': [-6.7580, 107.9650],
  'Basecamp Cibereum': [-6.7820, 107.9420],
  'Basecamp Dipajaya': [-7.2150, 109.1850],
  'Basecamp Baturraden': [-7.2950, 109.2150],
  'Basecamp Kaliwadas': [-7.2650, 109.1550],
  'Basecamp Bowongso': [-7.4080, 110.0250],
  'Basecamp Mangli': [-7.4020, 110.0980],
  'Basecamp Adipuro': [-7.4120, 110.0820],
  'Basecamp Thekelan': [-7.4050, 110.4280],
  'Basecamp Wekas': [-7.4380, 110.3980],
  'Basecamp Cuntel': [-7.3980, 110.4350],
  'Basecamp Sigedang': [-7.2820, 109.9720],
  'Basecamp Bansari': [-7.3250, 110.0450],
  'Basecamp Alang-alang sewu': [-7.3380, 110.0120],
  'Basecamp Wates': [-7.1980, 109.9520],
  'Basecamp Kalilembu': [-7.2150, 109.9120],
  'Basecamp Igirmranak': [-7.2350, 109.9320],
  'Basecamp Gedong Songo': [-7.2050, 110.3420],
  'Basecamp Promasan': [-7.1680, 110.3280],
  'Basecamp Perantunan': [-7.1980, 110.3580],
  'Basecamp Pendem': [-7.3950, 110.3720],
  'Basecamp Gogik': [-7.3820, 110.3550],
  'Basecamp Rahtawu': [-6.6580, 110.8850],
  'Basecamp Tempur': [-6.6020, 110.8920],
  'Basecamp Pemberit': [-6.6120, 110.9250]
};

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

    // Hitung titik representatif puncak (ambil data terverifikasi atau pos terakhir)
    let peakLat = null;
    let peakLng = null;
    if (PEAK_COORDS[namaGunung]) {
      peakLat = PEAK_COORDS[namaGunung][0];
      peakLng = PEAK_COORDS[namaGunung][1];
    } else {
      let allPosInGunung = [];
      for (const j of gInfo.jalurs.values()) {
        allPosInGunung.push(...j.posList);
      }
      if (allPosInGunung.length > 0) {
        const lastPos = allPosInGunung[allPosInGunung.length - 1];
        peakLat = lastPos.lat;
        peakLng = lastPos.lng;
      }
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

      const bcNama = `Basecamp ${jalurName}`;
      let bcLat, bcLng;

      if (REAL_BC_COORDS[bcNama]) {
        bcLat = REAL_BC_COORDS[bcNama][0];
        bcLng = REAL_BC_COORDS[bcNama][1];
      } else {
        const bcCandidate = posArr.find(p => p.namaPos.toLowerCase().includes('basecamp')) || posArr[0];
        bcLat = bcCandidate.lat;
        bcLng = bcCandidate.lng;
      }

      const bcElevation = Math.max(500, Math.round(gInfo.ketinggian * 0.45));

      const createdBasecamp = await prisma.basecamp.create({
        data: {
          gunungId: createdGunung.id,
          nama: bcNama,
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

        // Periksa apakah koordinat pos merupakan dummy outlier (> 12km dari basecamp)
        let posLat = p.lat;
        let posLng = p.lng;
        const R = 6371;
        const dLat = (posLat - bcLat) * Math.PI / 180;
        const dLon = (posLng - bcLng) * Math.PI / 180;
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(bcLat*Math.PI/180)*Math.cos(posLat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
        const distFromBc = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        if (distFromBc > 12 && peakLat && peakLng) {
          const ratio = (idx + 1) / (posArr.length + 1);
          posLat = Number((bcLat + (peakLat - bcLat) * ratio).toFixed(6));
          posLng = Number((bcLng + (peakLng - bcLng) * ratio).toFixed(6));
        }

        await prisma.posGunung.create({
          data: {
            basecampId: createdBasecamp.id,
            namaPos: p.namaPos,
            urutan: idx + 1,
            latitude: posLat,
            longitude: posLng,
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
