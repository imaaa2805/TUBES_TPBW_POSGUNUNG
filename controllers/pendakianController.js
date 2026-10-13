const prisma = require('../config/database');

// Helper untuk format instruksi navigasi berbahasa Indonesia
function formatManeuverInstruction(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || '';
  const modifier = maneuver.modifier || '';
  const street = step.name && step.name.trim() !== '' ? step.name : 'jalan menuju pos pendakian';

  if (type === 'depart') {
    return `Mulai perjalanan ke arah ${street}`;
  }
  if (type === 'arrive') {
    return 'Tiba di lokasi Basecamp / Pos Pendakian';
  }
  if (type === 'roundabout' || type === 'rotary') {
    return `Masuk bundaran dan keluar menuju ${street}`;
  }
  if (type === 'uturn') {
    return `Putar balik di ${street}`;
  }

  const modMap = {
    'left': 'Belok kiri',
    'right': 'Belok kanan',
    'slight left': 'Sedikit serong ke kiri',
    'slight right': 'Sedikit serong ke kanan',
    'sharp left': 'Belok tajam ke kiri',
    'sharp right': 'Belok tajam ke kanan',
    'straight': 'Lurus terus mengikuti jalur'
  };

  const action = modMap[modifier] || (type === 'turn' ? 'Belok' : 'Lanjutkan');
  return `${action} ke ${street}`;
}

// ─── 1. STATISTIK SISTEM ──────────────────────────────────────────
const getStats = async (req, res) => {
  try {
    const [
      totalGunung,
      totalBasecamp,
      totalPos,
      totalMataAir,
      statusJalurGroup,
      provinsiGunungGroup,
      topGunung
    ] = await Promise.all([
      prisma.gunung.count(),
      prisma.basecamp.count(),
      prisma.posGunung.count(),
      prisma.posGunung.count({ where: { adaAir: true } }),
      prisma.gunung.groupBy({ by: ['statusJalur'], _count: { id: true } }),
      prisma.gunung.groupBy({ by: ['provinsi'], _count: { id: true } }),
      prisma.gunung.findMany({
        take: 5,
        orderBy: { ketinggian: 'desc' },
        select: { id: true, nama: true, ketinggian: true, provinsi: true, statusJalur: true }
      })
    ]);

    const statusMap = Object.fromEntries(statusJalurGroup.map(s => [s.statusJalur, s._count.id]));
    const provMap = Object.fromEntries(provinsiGunungGroup.map(p => [p.provinsi, p._count.id]));

    res.json({
      success: true,
      data: {
        totalGunung,
        totalBasecamp,
        totalPos,
        totalMataAir,
        jalurAman: statusMap['Buka'] || 0,
        jalurWaspada: statusMap['Waspada'] || 0,
        jalurTutup: statusMap['Tutup'] || 0,
        byProvinsi: {
          all: totalGunung,
          jabar: provMap['Jawa Barat'] || 0,
          jateng: provMap['Jawa Tengah'] || 0,
          diy: provMap['DIY'] || 0,
          jatim: provMap['Jawa Timur'] || 0,
        },
        topGunung
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data statistik', error: error.message });
  }
};

// ─── 2. KATALOG GUNUNG (LIST & DETAIL) ─────────────────────────────
const getAllGunung = async (req, res) => {
  try {
    const { search, provinsi, status, hasWater, beginner } = req.query;
    const where = {};

    // Filter Provinsi
    if (provinsi && provinsi !== 'all') {
      const p = provinsi.toLowerCase();
      if (p === 'jabar') where.provinsi = { contains: 'Jawa Barat' };
      else if (p === 'jateng') where.provinsi = { contains: 'Jawa Tengah' };
      else if (p === 'diy') where.provinsi = { contains: 'DIY' };
      else if (p === 'jatim') where.provinsi = { contains: 'Jawa Timur' };
      else where.provinsi = { contains: provinsi };
    }

    // Filter Status Jalur
    if (status && status !== 'all') {
      where.statusJalur = status;
    }

    // Filter Pencarian
    if (search && search.trim() !== '') {
      const term = search.trim();
      where.OR = [
        { nama: { contains: term } },
        { kabupaten: { contains: term } },
        { provinsi: { contains: term } },
        { basecamps: { some: { jalurVia: { contains: term } } } }
      ];
    }

    // Filter Pemula (ketinggian <= 2600 atau nama populer)
    if (beginner === 'true') {
      where.ketinggian = { lte: 2600 };
    }

    let mountains = await prisma.gunung.findMany({
      where,
      include: {
        basecamps: {
          include: {
            pos: {
              orderBy: { urutan: 'asc' }
            }
          }
        }
      },
      orderBy: { ketinggian: 'desc' }
    });

    // Filter Mata Air jika diminta
    if (hasWater === 'true') {
      mountains = mountains.filter(m => 
        m.basecamps.some(b => b.pos.some(p => p.adaAir))
      );
    }

    // Format output ringkas dan kaya data
    const formatted = mountains.map(m => {
      const allPos = m.basecamps.flatMap(b => b.pos);
      const totalAir = allPos.filter(p => p.adaAir).length;
      return {
        id: m.id,
        nama: m.nama,
        slug: m.slug,
        provinsi: m.provinsi,
        kabupaten: m.kabupaten,
        ketinggian: m.ketinggian,
        statusVulkanik: m.statusVulkanik,
        statusJalur: m.statusJalur,
        tipeGunung: m.tipeGunung,
        kuotaHarian: m.kuotaHarian,
        kuotaTersisa: m.kuotaTersisa,
        cuacaSuhu: m.cuacaSuhu,
        cuacaKondisi: m.cuacaKondisi,
        latitude: m.latitude,
        longitude: m.longitude,
        deskripsi: m.deskripsi,
        totalJalur: m.basecamps.length,
        totalPos: allPos.length,
        totalAir,
        basecamps: m.basecamps.map(b => ({
          id: b.id,
          nama: b.nama,
          jalurVia: b.jalurVia,
          totalPos: b.pos.length,
          status: b.status,
          latitude: b.latitude,
          longitude: b.longitude,
          elevasi: b.elevasi,
          kontak: b.kontak,
          simaksiInfo: b.simaksiInfo,
          pos: b.pos
        }))
      };
    });

    res.json({
      success: true,
      total: formatted.length,
      data: formatted
    });
  } catch (error) {
    console.error('Error fetching gunung list:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data gunung', error: error.message });
  }
};

const getGunungById = async (req, res) => {
  try {
    const { id } = req.params;
    let gunung;

    if (!isNaN(parseInt(id, 10))) {
      gunung = await prisma.gunung.findUnique({
        where: { id: parseInt(id, 10) },
        include: {
          basecamps: {
            include: {
              pos: { orderBy: { urutan: 'asc' } }
            }
          }
        }
      });
    }

    if (!gunung) {
      gunung = await prisma.gunung.findUnique({
        where: { slug: id },
        include: {
          basecamps: {
            include: {
              pos: { orderBy: { urutan: 'asc' } }
            }
          }
        }
      });
    }

    if (!gunung) {
      return res.status(404).json({ success: false, message: 'Gunung tidak ditemukan' });
    }

    const allPos = gunung.basecamps.flatMap(b => b.pos);
    const totalAir = allPos.filter(p => p.adaAir).length;

    res.json({
      success: true,
      data: {
        ...gunung,
        totalJalur: gunung.basecamps.length,
        totalPos: allPos.length,
        totalAir
      }
    });
  } catch (error) {
    console.error('Error fetching gunung detail:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil detail gunung', error: error.message });
  }
};

const createGunung = async (req, res) => {
  try {
    const { nama, ketinggian, provinsi, kabupaten, tipeGunung, statusJalur, deskripsi, latitude, longitude } = req.body;
    if (!nama || !ketinggian || !provinsi || !kabupaten) {
      return res.status(400).json({ success: false, message: 'nama, ketinggian, provinsi, dan kabupaten wajib diisi' });
    }
    const slug = slugify(nama);
    const newGunung = await prisma.gunung.create({
      data: {
        nama: nama.trim(),
        slug,
        ketinggian: parseInt(ketinggian, 10),
        provinsi: provinsi.trim(),
        kabupaten: kabupaten.trim(),
        tipeGunung: tipeGunung?.trim() || 'Stratovolcano Aktif (Tipe-A)',
        statusJalur: statusJalur || 'Buka',
        deskripsi: deskripsi?.trim() || `Kawasan pendakian Gunung ${nama.trim()} di ${kabupaten.trim()}, ${provinsi.trim()}.`,
        latitude: latitude ? parseFloat(latitude) : -7.5,
        longitude: longitude ? parseFloat(longitude) : 110.5
      }
    });
    res.status(201).json({ success: true, message: 'Data gunung berhasil ditambahkan', data: newGunung });
  } catch (error) {
    console.error('Error creating gunung:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan data gunung', error: error.message });
  }
};

const updateGunung = async (req, res) => {
  try {
    const { id } = req.params;
    const gunungId = parseInt(id, 10);
    const existing = await prisma.gunung.findUnique({ where: { id: gunungId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Gunung tidak ditemukan' });

    const { nama, ketinggian, provinsi, kabupaten, tipeGunung, statusJalur, deskripsi, latitude, longitude } = req.body;
    const updateData = {};

    if (nama !== undefined && nama.trim() !== '') {
      updateData.nama = nama.trim();
      updateData.slug = slugify(nama.trim());
    }
    if (ketinggian !== undefined) {
      const alt = parseInt(ketinggian, 10);
      if (!isNaN(alt)) updateData.ketinggian = alt;
    }
    if (provinsi !== undefined) updateData.provinsi = provinsi.trim();
    if (kabupaten !== undefined) updateData.kabupaten = kabupaten.trim();
    if (tipeGunung !== undefined) updateData.tipeGunung = tipeGunung.trim();
    if (statusJalur !== undefined) updateData.statusJalur = statusJalur.trim();
    if (deskripsi !== undefined) updateData.deskripsi = deskripsi.trim();
    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (!isNaN(lat)) updateData.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (!isNaN(lng)) updateData.longitude = lng;
    }

    const updated = await prisma.gunung.update({
      where: { id: gunungId },
      data: updateData,
      include: {
        basecamps: {
          include: { pos: { orderBy: { urutan: 'asc' } } }
        }
      }
    });

    res.json({
      success: true,
      message: `Data Gunung ${updated.nama} berhasil diperbarui (rename/update)`,
      data: updated
    });
  } catch (error) {
    console.error('Error updating gunung:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data gunung', error: error.message });
  }
};

const deleteGunung = async (req, res) => {
  try {
    const { id } = req.params;
    const gunungId = parseInt(id, 10);
    const existing = await prisma.gunung.findUnique({ where: { id: gunungId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Gunung tidak ditemukan' });

    await prisma.gunung.delete({ where: { id: gunungId } });
    res.json({ success: true, message: `Gunung ${existing.nama} berhasil dihapus` });
  } catch (error) {
    console.error('Error deleting gunung:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus gunung', error: error.message });
  }
};

// ─── 3. DIREKTORI & CRUD BASECAMP ─────────────────────────────────
const getAllBasecamp = async (req, res) => {
  try {
    const { search, gunungId, provinsi, status } = req.query;
    const where = {};

    if (gunungId) where.gunungId = parseInt(gunungId, 10);
    if (status && status !== 'all') where.status = status;
    if (provinsi && provinsi !== 'all') {
      const p = provinsi.toLowerCase();
      if (p === 'jabar') where.gunung = { provinsi: { contains: 'Jawa Barat' } };
      else if (p === 'jateng') where.gunung = { provinsi: { contains: 'Jawa Tengah' } };
      else if (p === 'diy') where.gunung = { provinsi: { contains: 'DIY' } };
      else if (p === 'jatim') where.gunung = { provinsi: { contains: 'Jawa Timur' } };
      else where.gunung = { provinsi: { contains: provinsi } };
    }

    if (search && search.trim() !== '') {
      const term = search.trim();
      where.OR = [
        { nama: { contains: term } },
        { jalurVia: { contains: term } },
        { gunung: { nama: { contains: term } } }
      ];
    }

    const data = await prisma.basecamp.findMany({
      where,
      include: {
        gunung: true,
        pos: { orderBy: { urutan: 'asc' } }
      },
      orderBy: { id: 'asc' }
    });

    res.json({
      success: true,
      total: data.length,
      data: data.map(b => ({
        id: b.id,
        gunungId: b.gunungId,
        gunungNama: b.gunung.nama,
        ketinggianGunung: b.gunung.ketinggian,
        provinsi: b.gunung.provinsi,
        kabupaten: b.gunung.kabupaten,
        nama: b.nama,
        jalurVia: b.jalurVia,
        totalPos: b.pos.length,
        status: b.status,
        latitude: b.latitude,
        longitude: b.longitude,
        elevasi: b.elevasi,
        kontak: b.kontak,
        simaksiInfo: b.simaksiInfo,
        pos: b.pos
      }))
    });
  } catch (error) {
    console.error('Error fetching basecamp list:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data basecamp', error: error.message });
  }
};

const getBasecampById = async (req, res) => {
  try {
    const { id } = req.params;
    const basecamp = await prisma.basecamp.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        gunung: true,
        pos: { orderBy: { urutan: 'asc' } },
        logPembaruan: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });

    if (!basecamp) {
      return res.status(404).json({ success: false, message: 'Basecamp tidak ditemukan' });
    }

    res.json({
      success: true,
      data: {
        ...basecamp,
        gunungNama: basecamp.gunung.nama,
        ketinggianGunung: basecamp.gunung.ketinggian,
        provinsi: basecamp.gunung.provinsi,
        kabupaten: basecamp.gunung.kabupaten
      }
    });
  } catch (error) {
    console.error('Error fetching basecamp detail:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil detail basecamp', error: error.message });
  }
};

const createBasecamp = async (req, res) => {
  try {
    const { gunungId, nama, jalurVia, latitude, longitude, elevasi, status, kontak, simaksiInfo } = req.body;

    if (!gunungId || !nama || !jalurVia || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'gunungId, nama, jalurVia, latitude, dan longitude wajib diisi'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Koordinat latitude dan longitude harus berupa angka valid' });
    }

    const newBasecamp = await prisma.basecamp.create({
      data: {
        gunungId: parseInt(gunungId, 10),
        nama: nama.trim(),
        jalurVia: jalurVia.trim(),
        latitude: lat,
        longitude: lng,
        elevasi: elevasi ? parseInt(elevasi, 10) : 1800,
        status: status || 'Buka',
        kontak: kontak?.trim() || null,
        simaksiInfo: simaksiInfo?.trim() || 'Registrasi Online & On-the-spot di pos registrasi resmi.'
      },
      include: { gunung: true, pos: true }
    });

    res.status(201).json({
      success: true,
      message: 'Basecamp baru berhasil ditambahkan',
      data: newBasecamp
    });
  } catch (error) {
    console.error('Error creating basecamp:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan basecamp', error: error.message });
  }
};

const updateBasecamp = async (req, res) => {
  try {
    const { id } = req.params;
    const basecampId = parseInt(id, 10);

    const existing = await prisma.basecamp.findUnique({ where: { id: basecampId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Data basecamp tidak ditemukan' });

    const { nama, jalurVia, status, latitude, longitude, elevasi, kontak, simaksiInfo } = req.body;
    const updateData = {};

    if (nama !== undefined) updateData.nama = nama.trim();
    if (jalurVia !== undefined) updateData.jalurVia = jalurVia.trim();
    if (status !== undefined) updateData.status = status.trim();
    if (kontak !== undefined) updateData.kontak = kontak?.trim() || null;
    if (simaksiInfo !== undefined) updateData.simaksiInfo = simaksiInfo?.trim() || null;
    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (!isNaN(lat)) updateData.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (!isNaN(lng)) updateData.longitude = lng;
    }
    if (elevasi !== undefined) {
      const el = parseInt(elevasi, 10);
      if (!isNaN(el)) updateData.elevasi = el;
    }

    // Catat log audit pembaruan
    for (const [field, newVal] of Object.entries(updateData)) {
      const oldVal = String(existing[field] ?? '');
      if (String(newVal) !== oldVal) {
        await prisma.logPembaruan.create({
          data: {
            basecampId,
            fieldDiubah: field,
            nilaiLama: oldVal,
            nilaiBaru: String(newVal),
            diubahOleh: req.headers['x-user'] || 'Petugas Ranger Basecamp',
            keterangan: `Pembaruan data ${field} oleh petugas`
          }
        });
      }
    }

    const updated = await prisma.basecamp.update({
      where: { id: basecampId },
      data: updateData,
      include: { gunung: true, pos: true }
    });

    res.json({
      success: true,
      message: 'Data basecamp berhasil diperbarui',
      data: updated
    });
  } catch (error) {
    console.error('Error updating basecamp:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data basecamp', error: error.message });
  }
};

const deleteBasecamp = async (req, res) => {
  try {
    const { id } = req.params;
    const basecampId = parseInt(id, 10);

    const existing = await prisma.basecamp.findUnique({ where: { id: basecampId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Basecamp tidak ditemukan' });

    await prisma.basecamp.delete({ where: { id: basecampId } });

    res.json({
      success: true,
      message: `Basecamp ${existing.nama} berhasil dihapus`
    });
  } catch (error) {
    console.error('Error deleting basecamp:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus data basecamp', error: error.message });
  }
};

// ─── 4. CRUD POS GUNUNG / WAYPOINTS ───────────────────────────────
const getAllPos = async (req, res) => {
  try {
    const { basecampId, gunungId, adaAir, search } = req.query;
    const where = {};

    if (basecampId) where.basecampId = parseInt(basecampId, 10);
    if (gunungId) where.basecamp = { gunungId: parseInt(gunungId, 10) };
    if (adaAir === 'true') where.adaAir = true;

    if (search && search.trim() !== '') {
      where.namaPos = { contains: search.trim() };
    }

    const data = await prisma.posGunung.findMany({
      where,
      include: { basecamp: { include: { gunung: true } } },
      orderBy: [{ basecampId: 'asc' }, { urutan: 'asc' }]
    });

    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('Error fetching pos list:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data pos', error: error.message });
  }
};

const createPos = async (req, res) => {
  try {
    const { basecampId, namaPos, urutan, latitude, longitude, elevasi, adaAir, areaCamp, keterangan } = req.body;

    if (!basecampId || !namaPos || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'basecampId, namaPos, latitude, dan longitude wajib diisi'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Koordinat latitude dan longitude tidak valid' });
    }

    const nextUrutan = urutan ? parseInt(urutan, 10) : (await prisma.posGunung.count({ where: { basecampId: parseInt(basecampId, 10) } })) + 1;

    const newPos = await prisma.posGunung.create({
      data: {
        basecampId: parseInt(basecampId, 10),
        namaPos: namaPos.trim(),
        urutan: nextUrutan,
        latitude: lat,
        longitude: lng,
        elevasi: elevasi ? parseInt(elevasi, 10) : null,
        adaAir: !!adaAir,
        areaCamp: areaCamp !== undefined ? !!areaCamp : true,
        keterangan: keterangan?.trim() || null
      }
    });

    // Update total pos di basecamp
    await prisma.basecamp.update({
      where: { id: parseInt(basecampId, 10) },
      data: { totalPos: { increment: 1 } }
    });

    res.status(201).json({ success: true, message: 'Pos pendakian berhasil ditambahkan', data: newPos });
  } catch (error) {
    console.error('Error creating pos:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan pos pendakian', error: error.message });
  }
};

const updatePos = async (req, res) => {
  try {
    const { id } = req.params;
    const posId = parseInt(id, 10);

    const existing = await prisma.posGunung.findUnique({ where: { id: posId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pos tidak ditemukan' });

    const { namaPos, urutan, latitude, longitude, elevasi, adaAir, areaCamp, keterangan } = req.body;
    const updateData = {};

    if (namaPos !== undefined) updateData.namaPos = namaPos.trim();
    if (urutan !== undefined) updateData.urutan = parseInt(urutan, 10);
    if (adaAir !== undefined) updateData.adaAir = !!adaAir;
    if (areaCamp !== undefined) updateData.areaCamp = !!areaCamp;
    if (keterangan !== undefined) updateData.keterangan = keterangan?.trim() || null;
    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (!isNaN(lat)) updateData.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (!isNaN(lng)) updateData.longitude = lng;
    }
    if (elevasi !== undefined) {
      const el = parseInt(elevasi, 10);
      if (!isNaN(el)) updateData.elevasi = el;
    }

    const updated = await prisma.posGunung.update({
      where: { id: posId },
      data: updateData
    });

    res.json({ success: true, message: 'Data pos berhasil diperbarui', data: updated });
  } catch (error) {
    console.error('Error updating pos:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data pos', error: error.message });
  }
};

const deletePos = async (req, res) => {
  try {
    const { id } = req.params;
    const posId = parseInt(id, 10);

    const existing = await prisma.posGunung.findUnique({ where: { id: posId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pos tidak ditemukan' });

    await prisma.posGunung.delete({ where: { id: posId } });

    // Decrement totalPos di basecamp
    await prisma.basecamp.update({
      where: { id: existing.basecampId },
      data: { totalPos: { decrement: 1 } }
    });

    res.json({ success: true, message: `Pos ${existing.namaPos} berhasil dihapus` });
  } catch (error) {
    console.error('Error deleting pos:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus pos', error: error.message });
  }
};

// ─── 5. OSRM NAVIGASI & ROUTING KE BASECAMP ───────────────────────
const getRouteNavigation = async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng, mode = 'driving' } = req.query;

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    if (isNaN(sLat) || isNaN(sLng) || isNaN(eLat) || isNaN(eLng)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter koordinat startLat, startLng, endLat, endLng harus angka valid'
      });
    }

    // Call Public OSRM routing service
    const osrmUrl = `https://router.project-osrm.org/route/v1/${mode}/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let osrmData = null;
    try {
      const response = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        osrmData = await response.json();
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.warn('OSRM public fetch failed or timed out, generating geodesic fallback route:', fetchErr.message);
    }

    if (osrmData && osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
      const primaryRoute = osrmData.routes[0];
      const distanceMeters = primaryRoute.distance;
      const durationSeconds = primaryRoute.duration;

      // GeoJSON [lng, lat] -> Leaflet [lat, lng]
      const coordinates = primaryRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

      const steps = [];
      if (primaryRoute.legs && primaryRoute.legs[0] && primaryRoute.legs[0].steps) {
        primaryRoute.legs[0].steps.forEach((st, idx) => {
          const stepDist = st.distance;
          const distText = stepDist >= 1000 
            ? `${(stepDist / 1000).toFixed(1)} km` 
            : `${Math.round(stepDist)} m`;

          steps.push({
            stepNumber: idx + 1,
            instruction: formatManeuverInstruction(st),
            streetName: st.name || 'Jalur Penghubung',
            distance: stepDist,
            distanceText: distText,
            duration: Math.round(st.duration),
            modifier: st.maneuver?.modifier || '',
            type: st.maneuver?.type || '',
            location: st.maneuver?.location ? [st.maneuver.location[1], st.maneuver.location[0]] : null
          });
        });
      }

      const distanceKm = (distanceMeters / 1000).toFixed(1);
      const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

      return res.json({
        success: true,
        source: 'OSRM-Routing-Engine',
        data: {
          distance: distanceMeters,
          distanceFormatted: distanceMeters >= 1000 ? `${distanceKm} km` : `${Math.round(distanceMeters)} m`,
          duration: durationSeconds,
          durationFormatted: durationMinutes >= 60 
            ? `${Math.floor(durationMinutes / 60)} jam ${durationMinutes % 60} menit`
            : `${durationMinutes} Menit`,
          coordinates,
          steps,
          origin: [sLat, sLng],
          destination: [eLat, eLng]
        }
      });
    }

    // Geodesic fallback
    const dLat = (eLat - sLat) * Math.PI / 180;
    const dLng = (eLng - sLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(sLat * Math.PI / 180) * Math.cos(eLat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightDistance = Math.round(6371000 * c * 1.3);
    const estDuration = Math.round((straightDistance / 35000) * 3600);

    const straightDistKm = (straightDistance / 1000).toFixed(1);
    const estMinutes = Math.max(1, Math.round(estDuration / 60));

    const waypoints = [];
    const segments = 10;
    for (let i = 0; i <= segments; i++) {
      const frac = i / segments;
      waypoints.push([
        sLat + (eLat - sLat) * frac,
        sLng + (eLng - sLng) * frac
      ]);
    }

    return res.json({
      success: true,
      source: 'Direct-Interpolation-Fallback',
      data: {
        distance: straightDistance,
        distanceFormatted: `${straightDistKm} km`,
        duration: estDuration,
        durationFormatted: `${estMinutes} Menit`,
        coordinates: waypoints,
        steps: [
          {
            stepNumber: 1,
            instruction: 'Mulai rute langsung menuju lokasi basecamp pendakian',
            streetName: 'Rute Akses Basecamp',
            distance: straightDistance,
            distanceText: `${straightDistKm} km`,
            duration: estDuration,
            modifier: 'straight',
            type: 'depart'
          },
          {
            stepNumber: 2,
            instruction: 'Tiba di lokasi basecamp pendakian',
            streetName: 'Titik Basecamp',
            distance: 0,
            distanceText: '0 m',
            duration: 0,
            modifier: '',
            type: 'arrive'
          }
        ],
        origin: [sLat, sLng],
        destination: [eLat, eLng]
      }
    });
  } catch (error) {
    console.error('Error generating route navigation:', error);
    res.status(500).json({ success: false, message: 'Gagal memproses rute navigasi', error: error.message });
  }
};

// ─── 6. EXPORT GPX FILE GENERATOR ─────────────────────────────────
const exportGpx = async (req, res) => {
  try {
    const { basecampId } = req.params;
    const basecamp = await prisma.basecamp.findUnique({
      where: { id: parseInt(basecampId, 10) },
      include: {
        gunung: true,
        pos: { orderBy: { urutan: 'asc' } }
      }
    });

    if (!basecamp) {
      return res.status(404).json({ success: false, message: 'Basecamp tidak ditemukan' });
    }

    const gpxPoints = [];
    // Titik awal basecamp
    gpxPoints.push(`    <trkpt lat="${basecamp.latitude}" lon="${basecamp.longitude}"><ele>${basecamp.elevasi || 1800}</ele><name>${basecamp.nama}</name></trkpt>`);

    // Titik pos pendakian
    for (const p of basecamp.pos) {
      gpxPoints.push(`    <trkpt lat="${p.latitude}" lon="${p.longitude}"><ele>${p.elevasi || 2000}</ele><name>${p.namaPos}</name><desc>${p.adaAir ? 'Sumber Mata Air' : 'Pos Jalur'}</desc></trkpt>`);
    }

    const gpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KANIMAP Geospatial System" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Jalur Pendakian ${basecamp.gunung.nama} via ${basecamp.jalurVia}</name>
    <desc>Data jalur resmi Pulau Jawa diekspor dari KANIMAP GIS</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${basecamp.gunung.nama} - ${basecamp.jalurVia}</name>
    <trkseg>
${gpxPoints.join('\n')}
    </trkseg>
  </trk>
</gpx>`;

    res.setHeader('Content-Type', 'application/gpx+xml');
    res.setHeader('Content-Disposition', `attachment; filename="trail-${basecamp.gunung.slug}-${slugify(basecamp.jalurVia)}.gpx"`);
    res.send(gpxXml);
  } catch (error) {
    console.error('Error generating GPX:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat file GPX', error: error.message });
  }
};

function slugify(text) {
  return text.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');
}

module.exports = {
  getStats,
  getAllGunung,
  getGunungById,
  createGunung,
  updateGunung,
  deleteGunung,
  getAllBasecamp,
  getBasecampById,
  createBasecamp,
  updateBasecamp,
  deleteBasecamp,
  getAllPos,
  createPos,
  updatePos,
  deletePos,
  getRouteNavigation,
  exportGpx
};
