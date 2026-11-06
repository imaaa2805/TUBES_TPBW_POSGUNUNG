/**
 * Script untuk Merapikan & Menyelaraskan Koordinat Titik Jalur Pendakian
 * (Basecamp -> Pos 1 -> Pos 2 -> ... -> Puncak)
 * 
 * Memperbaiki:
 * 1. Overlap Pos 1 dengan Basecamp (jarak 0 meter)
 * 2. Pos yang melompat mundur (backtracking) atau dummy outlier
 * 3. Menghasilkan garis rute yang mulus, logis, dan enak dilihat di peta Leaflet
 * 4. Elevasi bertingkat proporsional dari Basecamp hingga Puncak
 */

const prisma = require('../config/database');

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateSmoothCurve(bcLat, bcLng, peakLat, peakLng, posCount, seed = 1) {
  const deltaLat = peakLat - bcLat;
  const deltaLng = peakLng - bcLng;
  const len = Math.sqrt(deltaLat * deltaLat + deltaLng * deltaLng);
  if (len === 0) return [];

  // Vektor normal tegak lurus
  const normLat = -deltaLng / len;
  const normLng = deltaLat / len;

  // Sedikit lengkungan alami (ridge contour)
  const dir = (seed % 2 === 0) ? 1 : -1;
  const curveAmp = 0.07 * len * dir;

  const points = [];
  for (let i = 1; i <= posCount; i++) {
    const t = i / (posCount + 1);
    const offset = Math.sin(Math.PI * t) * curveAmp + Math.sin(2 * Math.PI * t) * (curveAmp * 0.3);
    const lat = Number((bcLat + t * deltaLat + offset * normLat).toFixed(6));
    const lng = Number((bcLng + t * deltaLng + offset * normLng).toFixed(6));
    points.push({ urutan: i, lat, lng });
  }
  return points;
}

async function alignAllTrails() {
  console.log('🏔️ Memulai Penyelarasan & Perapihan Koordinat Jalur Pendakian...');

  const mountains = await prisma.gunung.findMany({
    include: { basecamps: { include: { pos: { orderBy: { urutan: 'asc' } } } } }
  });

  let updatedTrails = 0;
  let updatedPosCount = 0;

  for (const m of mountains) {
    if (!m.latitude || !m.longitude) continue;
    const peakLat = m.latitude;
    const peakLng = m.longitude;
    const peakElev = m.ketinggian;

    for (const b of m.basecamps) {
      if (!b.pos || b.pos.length === 0) continue;
      const bcLat = b.latitude;
      const bcLng = b.longitude;
      const bcElev = b.elevasi || Math.round(peakElev * 0.45);
      const posArr = b.pos;

      // Evaluasi apakah jalur ini bermasalah:
      // - Overlap Pos 1 dengan Basecamp (< 60m)
      // - Overlap antar pos berurutan (< 60m)
      // - Outlier > 18km dari basecamp atau puncak
      // - Backtrack (jarak ke puncak naik > 250m dibanding pos sebelumnya)
      let needsFullSmooth = false;
      let pos1Overlap = false;

      const dPos1ToBc = haversineMeters(bcLat, bcLng, posArr[0].latitude, posArr[0].longitude);
      if (dPos1ToBc < 60) {
        pos1Overlap = true;
      }

      for (let i = 0; i < posArr.length; i++) {
        const p = posArr[i];
        const distFromBc = haversineMeters(bcLat, bcLng, p.latitude, p.longitude);
        const distFromPeak = haversineMeters(p.latitude, p.longitude, peakLat, peakLng);

        if (distFromBc > 20000 || distFromPeak > 20000) {
          needsFullSmooth = true;
          break;
        }

        if (i > 0) {
          const dConsecutive = haversineMeters(posArr[i - 1].latitude, posArr[i - 1].longitude, p.latitude, p.longitude);
          if (dConsecutive < 60) {
            needsFullSmooth = true;
            break;
          }

          const prevDistToPeak = haversineMeters(posArr[i - 1].latitude, posArr[i - 1].longitude, peakLat, peakLng);
          const curDistToPeak = distFromPeak;
          if (curDistToPeak > prevDistToPeak + 200) {
            needsFullSmooth = true;
            break;
          }
        }
      }

      // Hitung step elevasi
      const elevDiff = Math.max(200, peakElev - bcElev);
      const elevStep = Math.round(elevDiff / (posArr.length + 1));

      if (needsFullSmooth) {
        // Terapkan perapihan kurva mulus penuh untuk semua pos
        const lastPosIsPeak = posArr[posArr.length - 1].namaPos.toLowerCase().includes('puncak') ||
                              haversineMeters(posArr[posArr.length - 1].latitude, posArr[posArr.length - 1].longitude, peakLat, peakLng) < 60;
        
        const countToGenerate = lastPosIsPeak ? posArr.length - 1 : posArr.length;
        const smoothWaypoints = generateSmoothCurve(bcLat, bcLng, peakLat, peakLng, countToGenerate, b.id);

        for (let i = 0; i < countToGenerate; i++) {
          const p = posArr[i];
          const sm = smoothWaypoints[i];
          const newElev = Math.min(peakElev - 50, bcElev + (i + 1) * elevStep);

          await prisma.posGunung.update({
            where: { id: p.id },
            data: {
              latitude: sm.lat,
              longitude: sm.lng,
              elevasi: newElev
            }
          });
          updatedPosCount++;
        }

        if (lastPosIsPeak && posArr.length > 0) {
          const lastPos = posArr[posArr.length - 1];
          await prisma.posGunung.update({
            where: { id: lastPos.id },
            data: {
              latitude: peakLat,
              longitude: peakLng,
              elevasi: peakElev
            }
          });
          updatedPosCount++;
        }

        updatedTrails++;
      } else if (pos1Overlap) {
        // Pos 1 menumpuk dengan Basecamp, tapi pos lainnya bagus
        // Geser Pos 1 ke titik tengah antara Basecamp dan Pos 2
        let nextLat, nextLng;
        if (posArr.length > 1) {
          nextLat = posArr[1].latitude;
          nextLng = posArr[1].longitude;
        } else {
          nextLat = peakLat;
          nextLng = peakLng;
        }

        const newPos1Lat = Number(((bcLat + nextLat) / 2).toFixed(6));
        const newPos1Lng = Number(((bcLng + nextLng) / 2).toFixed(6));
        const newElev = Math.min(peakElev - 50, bcElev + elevStep);

        await prisma.posGunung.update({
          where: { id: posArr[0].id },
          data: {
            latitude: newPos1Lat,
            longitude: newPos1Lng,
            elevasi: newElev
          }
        });
        updatedPosCount++;

        // Pastikan elevasi pos berikutnya juga teratur
        for (let i = 1; i < posArr.length; i++) {
          const p = posArr[i];
          const expectedElev = Math.min(peakElev - 30, bcElev + (i + 1) * elevStep);
          if (!p.elevasi || p.elevasi <= bcElev) {
            await prisma.posGunung.update({
              where: { id: p.id },
              data: { elevasi: expectedElev }
            });
          }
        }
        updatedTrails++;
      }
    }
  }

  console.log(`\n✅ Penyelarasan Selesai!`);
  console.log(`🛣️ Total Jalur yang diselaraskan: ${updatedTrails}`);
  console.log(`📍 Total Pos yang diperbarui koordinatnya: ${updatedPosCount}`);
  await prisma.$disconnect();
}

alignAllTrails().catch(err => {
  console.error('❌ Gagal menyelaraskan koordinat:', err);
  process.exit(1);
});
