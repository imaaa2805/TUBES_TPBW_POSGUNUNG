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

// ─── 7. BATCH UPDATE KOORDINAT TITIK JALUR (BASECAMP, POS, PUNCAK) ───
const updateCoordinatesBatch = async (req, res) => {
  try {
    const { basecamp, pos = [], gunung } = req.body;
    const results = { posUpdated: 0 };

    // 1. Update Basecamp Coordinates
    if (basecamp && basecamp.id && basecamp.latitude !== undefined && basecamp.longitude !== undefined) {
      const bLat = parseFloat(basecamp.latitude);
      const bLng = parseFloat(basecamp.longitude);
      if (!isNaN(bLat) && !isNaN(bLng)) {
        results.basecamp = await prisma.basecamp.update({
          where: { id: parseInt(basecamp.id, 10) },
          data: { latitude: bLat, longitude: bLng }
        });
      }
    }

    // 2. Update Gunung (Puncak) Coordinates
    if (gunung && gunung.id && gunung.latitude !== undefined && gunung.longitude !== undefined) {
      const gLat = parseFloat(gunung.latitude);
      const gLng = parseFloat(gunung.longitude);
      if (!isNaN(gLat) && !isNaN(gLng)) {
        results.gunung = await prisma.gunung.update({
          where: { id: parseInt(gunung.id, 10) },
          data: { latitude: gLat, longitude: gLng }
        });
      }
    }

    // 3. Update Pos List Coordinates
    if (Array.isArray(pos)) {
      for (const p of pos) {
        if (p.id && p.latitude !== undefined && p.longitude !== undefined) {
          const pLat = parseFloat(p.latitude);
          const pLng = parseFloat(p.longitude);
          if (!isNaN(pLat) && !isNaN(pLng)) {
            await prisma.posGunung.update({
              where: { id: parseInt(p.id, 10) },
              data: { latitude: pLat, longitude: pLng }
            });
            results.posUpdated++;
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Koordinat titik jalur (Basecamp, Pos, Puncak) berhasil diperbarui di database!',
      data: results
    });
  } catch (error) {
    console.error('Error batch updating coordinates:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui koordinat', error: error.message });
  }
};

// ─── 8. MOUNTAIN TRIP PLANNER & ESTIMASI WAKTU PENDAKIAN ───────────
const getTripPlan = async (req, res) => {
  try {
    const { basecampId } = req.params;
    const { 
      pace = 'sedang', 
      mode = 'target_arrival', 
      targetArrivalTime = '05:15',
      targetDepartureTime = '07:00',
      calcDirection = 'arrival',
      startTime = '07:00' 
    } = req.query;

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

    const mountain = basecamp.gunung;

    // Expedition waypoints: Basecamp -> Pos 1..N -> Puncak
    const waypoints = [
      {
        id: `bc-${basecamp.id}`,
        name: basecamp.nama,
        type: 'basecamp',
        urutan: 0,
        lat: basecamp.latitude,
        lng: basecamp.longitude,
        elev: basecamp.elevasi || 1500,
        areaCamp: true,
        adaAir: true
      },
      ...basecamp.pos.map((p, idx) => ({
        id: `pos-${p.id}`,
        name: p.namaPos,
        type: 'pos',
        urutan: p.urutan || (idx + 1),
        lat: p.latitude,
        lng: p.longitude,
        elev: p.elevasi || (basecamp.elevasi || 1500) + (idx + 1) * 250,
        areaCamp: p.areaCamp,
        adaAir: p.adaAir
      }))
    ];

    if (mountain.latitude && mountain.longitude) {
      const lastWp = waypoints[waypoints.length - 1];
      const dPeak = calculateHaversineMeters(lastWp.lat, lastWp.lng, mountain.latitude, mountain.longitude);
      if (dPeak > 100 && !lastWp.name.toLowerCase().includes('puncak')) {
        waypoints.push({
          id: `summit-${mountain.id}`,
          name: `Puncak ${mountain.nama}`,
          type: 'summit',
          urutan: waypoints.length,
          lat: mountain.latitude,
          lng: mountain.longitude,
          elev: mountain.ketinggian,
          areaCamp: false,
          adaAir: false
        });
      }
    }

    // Pace configuration (Tobler's Hiking function / Naismith)
    const paceConfig = {
      santai: { flatSpeed: 2.0, climbSpeed: 250, restMinutes: 15, peakStayMinutes: 45, label: 'Santai / Pemula' },
      sedang: { flatSpeed: 2.8, climbSpeed: 380, restMinutes: 10, peakStayMinutes: 45, label: 'Sedang / Reguler' },
      cepat: { flatSpeed: 4.0, climbSpeed: 550, restMinutes: 5, peakStayMinutes: 30, label: 'Cepat / Terlatih' }
    }[pace] || { flatSpeed: 2.8, climbSpeed: 380, restMinutes: 10, peakStayMinutes: 45, label: 'Sedang / Reguler' };

    // Calculate segments
    const segments = [];
    let totalAscentMinutes = 0;
    let totalDistanceM = 0;
    let totalGainM = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];
      const distM = calculateHaversineMeters(from.lat, from.lng, to.lat, to.lng);
      const elevDiff = (to.elev || 0) - (from.elev || 0);
      const gainM = Math.max(0, elevDiff);

      const flatMins = (distM / 1000) / paceConfig.flatSpeed * 60;
      const climbMins = (gainM / paceConfig.climbSpeed) * 60;
      const walkMins = Math.round(Math.max(12, flatMins + climbMins));
      const restMins = (i < waypoints.length - 2) ? paceConfig.restMinutes : 0;
      const legDuration = walkMins + restMins;

      totalDistanceM += distM;
      totalGainM += gainM;
      totalAscentMinutes += legDuration;

      segments.push({
        stepNumber: i + 1,
        fromName: from.name,
        toName: to.name,
        fromElev: from.elev,
        toElev: to.elev,
        distanceM: Math.round(distM),
        distanceKm: Number((distM / 1000).toFixed(2)),
        gainM,
        walkMinutes: walkMins,
        restMinutes: restMins,
        legDuration,
        adaAir: to.adaAir,
        areaCamp: to.areaCamp
      });
    }

    const totalDescentMinutes = Math.round(totalAscentMinutes * 0.58);
    const totalRoundtripMinutes = totalAscentMinutes + paceConfig.peakStayMinutes + totalDescentMinutes;

    const addMinutesToTime = (baseMins, addM) => {
      const total = (baseMins + addM + 2880) % 1440;
      const h = Math.floor(total / 60);
      const m = total % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} WIB`;
    };

    const parseClockToMinutes = (clockStr) => {
      const clean = String(clockStr || '07:00').replace(' WIB', '').trim();
      const parts = clean.split(':');
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      return h * 60 + m;
    };

    // Determine start time and bidirectional recommendation
    let startMinutes = 420; // 07:00
    let recommendation = {};

    const isArrivalTarget = (calcDirection === 'arrival') || (!req.query.calcDirection && (mode === 'sunrise' || mode === 'target_arrival'));

    if (isArrivalTarget) {
      // User says: "Saya mau sampai puncak jam segini -> Harus naik jam berapa?"
      const targetStr = (mode === 'sunrise') ? '05:15' : (targetArrivalTime || '05:15');
      const targetArrivalMins = parseClockToMinutes(targetStr);
      startMinutes = (targetArrivalMins - totalAscentMinutes + 1440) % 1440;

      const targetTimeFormatted = addMinutesToTime(targetArrivalMins, 0);
      const startTimeFormatted = addMinutesToTime(startMinutes, 0);
      const ascentDurationFormatted = formatDurationMins(totalAscentMinutes);

      recommendation = {
        mode: mode === 'sunrise' ? 'sunrise' : 'target_arrival',
        calcDirection: 'arrival',
        title: `🎯 Target Tiba di Puncak Pukul ${targetTimeFormatted}`,
        targetPeakTime: targetTimeFormatted,
        recommendedStartTime: startTimeFormatted,
        totalAscentDuration: ascentDurationFormatted,
        actionLabel: 'Anda Harus Mulai Naik dari Basecamp:',
        targetLabel: 'Target Tiba di Puncak',
        reason: `Untuk tiba di Puncak tepat pukul ${targetTimeFormatted}, Anda HARUS mulai mendaki dari Basecamp paling lambat pukul ${startTimeFormatted} (estimasi waktu tempuh naik ${ascentDurationFormatted} pada ritme ${paceConfig.label}).`
      };
    } else if (calcDirection === 'departure' || mode === 'target_departure' || mode === 'custom') {
      // User says: "Saya mau mulai naik jam segini -> Sampai puncak jam berapa?"
      const departStr = targetDepartureTime || startTime || '07:00';
      startMinutes = parseClockToMinutes(departStr);
      const peakMins = (startMinutes + totalAscentMinutes) % 1440;
      const finishMins = (startMinutes + totalRoundtripMinutes) % 1440;

      const startTimeFormatted = addMinutesToTime(startMinutes, 0);
      const peakTimeFormatted = addMinutesToTime(peakMins, 0);
      const finishTimeFormatted = addMinutesToTime(finishMins, 0);
      const ascentDurationFormatted = formatDurationMins(totalAscentMinutes);

      recommendation = {
        mode: 'target_departure',
        calcDirection: 'departure',
        title: `🚀 Mulai Naik dari Basecamp Pukul ${startTimeFormatted}`,
        recommendedStartTime: startTimeFormatted,
        targetPeakTime: peakTimeFormatted,
        returnBasecampTime: finishTimeFormatted,
        totalAscentDuration: ascentDurationFormatted,
        actionLabel: 'Mulai Naik dari Basecamp:',
        targetLabel: 'Estimasi Tiba di Puncak',
        reason: `Jika Anda mulai naik dari Basecamp pukul ${startTimeFormatted}, Anda diperkirakan tiba di Puncak pukul ${peakTimeFormatted} dan kembali ke Basecamp pukul ${finishTimeFormatted} (estimasi waktu tempuh naik ${ascentDurationFormatted}).`
      };
    } else if (mode === 'dayhike') {
      startMinutes = 390; // 06:30 WIB
      const peakTime = addMinutesToTime(startMinutes, totalAscentMinutes);
      const returnTime = addMinutesToTime(startMinutes, totalRoundtripMinutes);
      recommendation = {
        mode: 'dayhike',
        calcDirection: 'departure',
        title: '☀️ Pendakian Siang (Day Hike Santai)',
        recommendedStartTime: '06:30 WIB',
        targetPeakTime: peakTime,
        returnBasecampTime: returnTime,
        totalAscentDuration: formatDurationMins(totalAscentMinutes),
        actionLabel: 'Mulai Naik Pagi Hari:',
        targetLabel: 'Estimasi Tiba di Puncak',
        reason: `Mulai pagi pukul 06:30 WIB saat udara sejuk. Tiba di Puncak sekitar ${peakTime}, dan kembali ke Basecamp pukul ${returnTime} sebelum hari gelap.`
      };
    } else if (mode === 'camp') {
      const campWps = waypoints.filter(w => w.areaCamp && w.type === 'pos');
      const campPos = campWps.length > 0 ? campWps[campWps.length - 1] : waypoints[Math.max(1, waypoints.length - 2)];
      startMinutes = 600; // 10:00 WIB Hari ke-1
      recommendation = {
        mode: 'camp',
        calcDirection: 'departure',
        title: '⛺ Ekspedisi Kemah 2 Hari 1 Malam (Camp & Summit)',
        recommendedStartTime: '10:00 WIB (Hari ke-1)',
        campLocation: campPos.name,
        summitAttackTime: '03:30 WIB (Hari ke-2)',
        targetPeakTime: '05:15 WIB',
        totalAscentDuration: formatDurationMins(totalAscentMinutes),
        actionLabel: 'Mulai Hari 1 (Menuju Camp):',
        targetLabel: 'Target Sunrise Hari 2',
        reason: `Hari 1 mulai jam 10:00 WIB santai menuju ${campPos.name} untuk mendirikan tenda sebelum sore. Hari 2 bangun jam 03:00 WIB dan summit attack menuju puncak untuk sunrise.`
      };
    }

    // Build timeline
    let currentMins = startMinutes;
    const timeline = [];

    timeline.push({
      time: addMinutesToTime(currentMins, 0),
      pointName: basecamp.nama,
      type: 'start',
      elevasi: basecamp.elevasi || 1500,
      activity: 'Mulai Keberangkatan dari Basecamp (Start Hiking)',
      note: 'Registrasi simaksi, doa bersama, cek perlengkapan & perbekalan air.'
    });

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      currentMins += seg.walkMinutes;
      const isPeak = (i === segments.length - 1);

      if (isPeak) {
        timeline.push({
          time: addMinutesToTime(currentMins, 0),
          pointName: seg.toName,
          type: 'summit',
          elevasi: seg.toElev,
          activity: '🎉 Tiba di Titik Puncak!',
          note: `Total tanjakan +${totalGainM}m berhasil ditempuh. Nikmati panorama dan istirahat selama ${paceConfig.peakStayMinutes} menit.`
        });
        currentMins += paceConfig.peakStayMinutes;
      } else {
        timeline.push({
          time: addMinutesToTime(currentMins, 0),
          pointName: seg.toName,
          type: 'pos',
          elevasi: seg.toElev,
          activity: `Tiba di ${seg.toName} · Istirahat ${seg.restMinutes} Menit`,
          note: `${seg.adaAir ? '💧 Sumber air tersedia. ' : ''}${seg.areaCamp ? '⛺ Area camp pendaki. ' : ''}Jarak segmen +${seg.distanceKm} km (+${seg.gainM}m).`
        });
        currentMins += seg.restMinutes;
      }
    }

    // Descent
    const descentStartMins = currentMins;
    currentMins += totalDescentMinutes;
    timeline.push({
      time: addMinutesToTime(descentStartMins, 0),
      pointName: 'Mulai Perjalanan Turun',
      type: 'descent',
      activity: 'Turun kembali menuju Basecamp',
      note: 'Gunakan trekking pole untuk meredam beban lutut, waspada trek berpasir/licin.'
    });

    timeline.push({
      time: addMinutesToTime(currentMins, 0),
      pointName: basecamp.nama,
      type: 'finish',
      elevasi: basecamp.elevasi || 1500,
      activity: '🏁 Tiba Kembali di Basecamp (Finish)',
      note: 'Lapor kembali ke pengelola / registrasi keluar, istirahat dan pulihkan tenaga.'
    });

    // Safety Advisories
    const safetyAdvice = [];
    const finishClock = (startMinutes + totalRoundtripMinutes) % 1440;
    if (finishClock > 1050) { // after 17:30
      safetyAdvice.push({
        level: 'warning',
        icon: 'flashlight_on',
        title: 'Batas Waktu Senja (Penerangan)',
        desc: `Diperkirakan tiba kembali di Basecamp pukul ${addMinutesToTime(finishClock, 0)} (hari sudah gelap). Wajib membawa headlamp dan baterai cadangan.`
      });
    }

    if (mountain.statusJalur !== 'Buka' || mountain.statusVulkanik !== 'Normal') {
      safetyAdvice.push({
        level: 'caution',
        icon: 'warning',
        title: `Status Gunung: ${mountain.statusVulkanik}`,
        desc: 'Patuhi batas pendakian resmi yang ditetapkan oleh PVMBG dan pihak Taman Nasional.'
      });
    }

    safetyAdvice.push({
      level: 'info',
      icon: 'water_drop',
      title: 'Kebutuhan Air Minum',
      desc: `Estimasi kebutuhan air: Minimal 2.5 - 3.5 Liter per pendaki. ${basecamp.pos.some(p => p.adaAir) ? 'Terdapat pos dengan sumber mata air di jalur ini.' : 'Jalur ini minim/tidak ada sumber air, bawa air penuh dari basecamp.'}`
    });

    res.json({
      success: true,
      data: {
        mountain: {
          id: mountain.id,
          nama: mountain.nama,
          ketinggian: mountain.ketinggian,
          kabupaten: mountain.kabupaten,
          provinsi: mountain.provinsi
        },
        basecamp: {
          id: basecamp.id,
          nama: basecamp.nama,
          jalurVia: basecamp.jalurVia,
          elevasi: basecamp.elevasi || 1500,
          totalPos: basecamp.pos.length
        },
        recommendation,
        metrics: {
          pace: paceConfig.label,
          totalDistanceKm: Number((totalDistanceM / 1000).toFixed(2)),
          totalRoundtripDistanceKm: Number(((totalDistanceM * 2) / 1000).toFixed(2)),
          totalGainM,
          totalAscentMinutes,
          totalAscentFormatted: formatDurationMins(totalAscentMinutes),
          totalDescentMinutes,
          totalDescentFormatted: formatDurationMins(totalDescentMinutes),
          totalRoundtripMinutes,
          totalRoundtripFormatted: formatDurationMins(totalRoundtripMinutes)
        },
        segments,
        timeline,
        safetyAdvice
      }
    });
  } catch (error) {
    console.error('Error generating trip plan:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat rencana perjalanan trip planner', error: error.message });
  }
};

function formatDurationMins(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} Menit`;
  if (m === 0) return `${h} Jam`;
  return `${h} Jam ${m} Menit`;
}

function calculateHaversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
  exportGpx,
  updateCoordinatesBatch,
  getTripPlan
};

