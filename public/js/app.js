/**
 * KANIMAP - Sistem Ekspedisi Geospasial Pulau Jawa
 * Pemetaan Jalur Basecamp & Pos Gunung
 * Frontend Application Logic (Leaflet Map, Telemetry, Waypoints, OSRM Routing, and CRUD)
 */

// Application State
let map;
let baseLayers = [];
let currentTileIndex = 0;
let mountainMarkersGroup;
let trailMarkersGroup;
let userLocationMarker = null;

let allMountains = [];
let allBasecamps = [];
let selectedMountain = null;
let selectedBasecamp = null;
let selectedJalurByMountain = {}; // mountainId -> basecampId (Pencet via/jalur baru disesuaikan jumlah posnya)

let activeRegion = 'all'; // 'all', 'jabar', 'jateng', 'diy', 'jatim'
let filterOpen = true;
let filterBeginner = false;
let searchQuery = '';

let currentUserCoords = null;
let isPickingCoordinates = false;
let activeCoordTarget = null;
let isDragMarkerMode = false;
let editingWaypoints = [];
let markerInstances = {};
let activeTrailPolyline = null;
let activeTrailCasing = null;

// Paired Pos Table State
let showAllPosMode = false;
let posTableSearchQuery = '';

// Live Tracking State
let isLiveTracking = false;
let trackingMode = 'idle'; // 'real', 'sim', 'idle'
let trackingWatchId = null;
let trackingTimerInterval = null;
let trackingSeconds = 0;
let trackingBreadcrumbs = []; // [[lat, lng], ...]
let trackingBreadcrumbPolyline = null;
let liveTrackerMarker = null;
let liveTrackerAccuracyCircle = null;
let trackingTotalDistance = 0; // meters
let isTrackingLocked = true;
let isTrackingPaused = false;
let simWaypointIndex = 0;
let simInterval = null;

// Center of Java Island & Initial Zoom
const JAVA_CENTER = [-7.55, 110.35];
const JAVA_ZOOM = 8;

// Regional Bounding Boxes
const REGION_BOUNDS = {
  all: [[-8.85, 105.80], [-5.85, 114.70]],
  jabar: [[-7.85, 106.35], [-5.90, 108.85]],
  jateng: [[-8.25, 108.65], [-6.40, 111.70]],
  diy: [[-8.15, 110.05], [-7.55, 110.85]],
  jatim: [[-8.80, 111.00], [-6.85, 114.65]]
};

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadStatistics();
  await loadMountains();
  await loadBasecamps();
  setupEventListeners();
});

/**
 * 1. Initialize Leaflet Map with 100% Free Open-Source Tiles
 */
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(JAVA_CENTER, JAVA_ZOOM);

  // 1. OpenTopoMap (Free Topographic contours)
  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    subdomains: 'abc'
  });

  // 2. OpenStreetMap Standard (Free Road & Trail map)
  const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  });

  // 3. ESRI World Imagery (Free Public Satellite HD)
  const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });

  baseLayers = [topoLayer, osmStandard, satLayer];
  baseLayers[0].addTo(map);

  mountainMarkersGroup = L.layerGroup().addTo(map);
  trailMarkersGroup = L.layerGroup().addTo(map);

  // Map Click Listener
  map.on('click', (e) => {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);

    const coordEl = document.getElementById('telemetry-coord');
    if (coordEl) {
      coordEl.innerText = `${Math.abs(lng)}° E · ${Math.abs(lat)}° S`;
    }

    if (isPickingCoordinates) {
      if (activeCoordTarget === 'basecamp_modal') {
        const latInput = document.getElementById('form-bc-lat');
        const lngInput = document.getElementById('form-bc-lng');
        if (latInput && lngInput) {
          latInput.value = lat;
          lngInput.value = lng;
          openBasecampModal();
          showToast(`Koordinat Basecamp dipilih: ${lat}, ${lng}`, 'success');
        }
      } else if (activeCoordTarget === 'pos_modal') {
        const latInput = document.getElementById('form-pos-lat');
        const lngInput = document.getElementById('form-pos-lng');
        if (latInput && lngInput) {
          latInput.value = lat;
          lngInput.value = lng;
          document.getElementById('pos-modal')?.classList.remove('hidden');
          showToast(`Koordinat Pos dipilih: ${lat}, ${lng}`, 'success');
        }
      } else if (activeCoordTarget === 'gunung_modal') {
        const latInput = document.getElementById('form-gunung-lat');
        const lngInput = document.getElementById('form-gunung-lng');
        if (latInput && lngInput) {
          latInput.value = lat;
          lngInput.value = lng;
          document.getElementById('gunung-modal')?.classList.remove('hidden');
          showToast(`Koordinat Puncak dipilih: ${lat}, ${lng}`, 'success');
        }
      } else if (activeCoordTarget && activeCoordTarget.type && activeCoordTarget.id) {
        const rowLat = document.getElementById(`coord-lat-${activeCoordTarget.type}-${activeCoordTarget.id}`);
        const rowLng = document.getElementById(`coord-lng-${activeCoordTarget.type}-${activeCoordTarget.id}`);
        if (rowLat && rowLng) {
          rowLat.value = lat;
          rowLng.value = lng;
          onCoordInputChange(activeCoordTarget.type, activeCoordTarget.id);
          document.getElementById('coord-editor-modal')?.classList.remove('hidden');
          showToast(`Koordinat ${activeCoordTarget.name} diperbarui: ${lat}, ${lng}`, 'success');
        }
      } else {
        // Fallback default basecamp modal
        const latInput = document.getElementById('form-bc-lat');
        const lngInput = document.getElementById('form-bc-lng');
        if (latInput && lngInput) {
          latInput.value = lat;
          lngInput.value = lng;
          openBasecampModal();
          showToast(`Koordinat dipilih: ${lat}, ${lng}`, 'success');
        }
      }
      activeCoordTarget = null;
      isPickingCoordinates = false;
    }
  });

  setTimeout(() => map.invalidateSize(), 300);
}

/**
 * Switch Base Map Tiles (Topografi / OSM / Satelit) - 100% Free
 */
function switchTileLayer(index) {
  if (currentTileIndex === index) return;
  map.removeLayer(baseLayers[currentTileIndex]);
  currentTileIndex = index;
  baseLayers[currentTileIndex].addTo(map);

  const pills = document.querySelectorAll('.layer-pill');
  pills.forEach((p, idx) => {
    if (idx === index) {
      p.classList.add('bg-primary', 'text-on-primary', 'active');
      p.classList.remove('text-on-surface-variant');
    } else {
      p.classList.remove('bg-primary', 'text-on-primary', 'active');
      p.classList.add('text-on-surface-variant');
    }
  });

  const names = ['Topografi OpenTopoMap (Gratis)', 'Peta Jalan OpenStreetMap (Gratis)', 'Satelit HD ESRI (Gratis)'];
  showToast(`Tampilan Peta: ${names[index]}`, 'info');
}

/**
 * 2. Load Aggregated Statistics from API
 */
async function loadStatistics() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;
    
    const badgeEl = document.getElementById('badge-total-peaks');
    if (badgeEl) badgeEl.innerText = `${data.totalGunung} Jalur Pendakian`;

    const pillAman = document.getElementById('pill-jalur-aman');
    if (pillAman) pillAman.innerText = `Jalur Aman (${data.jalurAman})`;

    const pillWaspada = document.getElementById('pill-jalur-waspada');
    if (pillWaspada) pillWaspada.innerText = `Waspada (${data.jalurWaspada})`;

    const pillTutup = document.getElementById('pill-jalur-tutup');
    if (pillTutup) pillTutup.innerText = `Ditutup (${data.jalurTutup})`;

    // Province badge counters
    document.getElementById('count-prov-all')?.replaceChildren(document.createTextNode(data.totalGunung));
    document.getElementById('count-prov-jabar')?.replaceChildren(document.createTextNode(data.byProvinsi.jabar));
    document.getElementById('count-prov-jateng')?.replaceChildren(document.createTextNode(data.byProvinsi.jateng));
    document.getElementById('count-prov-diy')?.replaceChildren(document.createTextNode(data.byProvinsi.diy));
    document.getElementById('count-prov-jatim')?.replaceChildren(document.createTextNode(data.byProvinsi.jatim));
  } catch (err) {
    console.error('Gagal memuat statistik:', err);
  }
}

/**
 * 3. Load Mountains and Render List & Pins
 */
async function loadMountains() {
  try {
    const res = await fetch('/api/gunung');
    const json = await res.json();
    if (!json.success) return;

    allMountains = json.data;
    renderMountainCards();
    renderMountainPins();

    // Default select Merbabu or first mountain
    const defaultMtn = allMountains.find(m => m.nama.toLowerCase().includes('merbabu')) || allMountains[0];
    if (defaultMtn) {
      selectMountain(defaultMtn.id, false);
    }
  } catch (err) {
    console.error('Gagal memuat data gunung:', err);
  }
}

/**
 * Apply Explorer Filters (Buka & Pemula)
 */
function applyFilters() {
  const openEl = document.getElementById('toggle-open');
  if (openEl) filterOpen = openEl.checked;
  const begEl = document.getElementById('toggle-beginner');
  if (begEl) filterBeginner = begEl.checked;

  renderMountainCards();
  renderMountainPins();
}

function resetFilters() {
  filterOpen = false;
  filterBeginner = false;
  searchQuery = '';
  const searchInput = document.getElementById('mountain-search');
  if (searchInput) searchInput.value = '';
  const openEl = document.getElementById('toggle-open');
  if (openEl) openEl.checked = false;
  const begEl = document.getElementById('toggle-beginner');
  if (begEl) begEl.checked = false;
  applyFilters();
}

/**
 * Filter Mountains based on province, open status, beginner, and search
 */
function getFilteredMountains() {
  return allMountains.filter(m => {
    // Filter Region
    if (activeRegion === 'jabar' && !m.provinsi.toLowerCase().includes('barat')) return false;
    if (activeRegion === 'jateng' && !m.provinsi.toLowerCase().includes('tengah')) return false;
    if (activeRegion === 'diy' && !m.provinsi.toLowerCase().includes('diy')) return false;
    if (activeRegion === 'jatim' && !m.provinsi.toLowerCase().includes('timur')) return false;

    // Filter Open
    if (filterOpen && m.statusJalur !== 'Buka') return false;

    // Filter Beginner (<= 2600 mdpl)
    if (filterBeginner && m.ketinggian > 2600) return false;

    // Filter Single Search Input
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchName = m.nama.toLowerCase().includes(q);
      const matchKab = m.kabupaten.toLowerCase().includes(q);
      const matchedBc = m.basecamps.find(b => b.jalurVia.toLowerCase().includes(q) || b.nama.toLowerCase().includes(q));
      if (!matchName && !matchKab && !matchedBc) return false;
      // Jika pencarian cocok dengan nama jalur/via tertentu, sesuaikan via aktif
      if (matchedBc && !selectedJalurByMountain[m.id]) {
        selectedJalurByMountain[m.id] = matchedBc.id;
      }
    }

    return true;
  });
}

/**
 * Render Mountain Cards in Explorer Sidebar
 */
function renderMountainCards() {
  const container = document.getElementById('mountain-list');
  if (!container) return;

  const filtered = getFilteredMountains();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-on-surface-variant flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-outline text-[32px]">filter_alt_off</span>
        <span class="text-xs font-headline font-bold">Tidak ada gunung yang sesuai filter</span>
        <button onclick="resetFilters()" class="text-xs text-primary font-bold hover:underline mt-1">Reset Semua Filter</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const isSelected = selectedMountain && selectedMountain.id === m.id;
    const bgClass = isSelected ? 'bg-surface-container-low ring-1 ring-primary/40 shadow-sm' : 'bg-surface-container-lowest hover:bg-surface-container-low';
    
    // Status Badge
    let statusBadge = '';
    if (m.statusJalur === 'Buka') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-headline text-[10px] font-bold">
          <span class="w-1.5 h-1.5 rounded-full bg-tertiary-container animate-pulse"></span> BUKA
        </span>`;
    } else if (m.statusJalur === 'Waspada') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-headline text-[10px] font-bold">
          <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> WASPADA
        </span>`;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-headline text-[10px] font-bold">
          <span class="material-symbols-outlined text-[12px]">lock</span> TUTUP
        </span>`;
    }

    // Ambil via/jalur aktif yang dipencet untuk gunung ini (Requirement: Pencet via/jalur baru muncul jumlah posnya)
    const activeBcId = selectedJalurByMountain[m.id];
    const activeBc = activeBcId 
      ? m.basecamps.find(b => b.id === activeBcId) 
      : (isSelected && selectedBasecamp && selectedBasecamp.gunungId === m.id ? selectedBasecamp : null);

    // Pos badge: Muncul jumlah pos HANYA jika via/jalur diklik, bukan seluruh pos dari semua jalur
    let posBadgeHtml = '';
    if (activeBc) {
      posBadgeHtml = `
        <span class="flex items-center gap-1 font-headline font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20" title="${activeBc.pos.length} Pos pada jalur Via ${activeBc.jalurVia}">
          <span class="material-symbols-outlined text-[15px] text-primary">format_list_numbered</span>
          ${activeBc.pos.length} Pos (Via ${activeBc.jalurVia})
        </span>
      `;
    } else {
      posBadgeHtml = `
        <span class="flex items-center gap-1 font-headline font-medium text-on-surface-variant text-[11px] bg-surface-container-high/60 px-2 py-0.5 rounded-lg" title="Pencet via/jalur di bawah untuk melihat jumlah pos">
          <span class="material-symbols-outlined text-[14px] text-outline">touch_app</span>
          Pilih via untuk lihat pos
        </span>
      `;
    }

    // Jalur / Via chips inside card dengan Jarak KM & Jumlah Pos
    const jalurChipsHtml = m.basecamps.map(b => {
      const isBcActive = activeBc && activeBc.id === b.id;
      const bWaypoints = getExpeditionWaypoints(m, b);
      const bSummary = calculateTrailSegments(bWaypoints);
      const chipClass = isBcActive 
        ? 'bg-primary text-on-primary font-bold shadow-xs ring-1 ring-primary-container' 
        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface font-medium';
      return `
        <span onclick="event.stopPropagation(); switchJalur(${m.id}, ${b.id});" class="px-2 py-0.5 rounded-lg text-[10px] font-headline cursor-pointer transition-all flex items-center gap-1 ${chipClass}" title="Pencet untuk melihat visualisasi ${bSummary.totalDistanceFormatted} & ${b.pos.length} pos via ${b.jalurVia}">
          <span>Via ${b.jalurVia}</span>
          <span class="text-[9px] font-mono font-bold ${isBcActive ? 'bg-black/20 text-white' : 'bg-surface-container-highest text-on-surface-variant'} px-1 py-0.2 rounded">${bSummary.totalDistanceFormatted}</span>
          <span class="text-[9px] font-bold ${isBcActive ? 'bg-black/20 text-white' : 'bg-surface-container-highest text-on-surface-variant'} px-1 py-0.2 rounded">${b.pos.length} Pos</span>
        </span>
      `;
    }).join('');

    // Active trail preview badge if active basecamp exists
    let activeTrailBadgeHtml = '';
    if (activeBc) {
      const activeWps = getExpeditionWaypoints(m, activeBc);
      const activeSummary = calculateTrailSegments(activeWps);
      activeTrailBadgeHtml = `
        <div class="mt-2 px-2.5 py-1 rounded-xl bg-primary/5 border border-primary/15 flex items-center justify-between text-[10px] font-headline">
          <span class="text-primary font-bold flex items-center gap-1 truncate">
            <span class="material-symbols-outlined text-[13px] text-secondary">alt_route</span>
            Via ${activeBc.jalurVia} (BC ➔ Puncak)
          </span>
          <div class="flex items-center gap-1.5 shrink-0 font-mono">
            <strong class="text-primary font-bold">${activeSummary.totalDistanceFormatted}</strong>
            <span class="text-outline-variant">•</span>
            <strong class="text-secondary font-bold">${activeBc.pos.length} Pos</strong>
          </div>
        </div>
      `;
    }

    return `
      <div onclick="selectMountain(${m.id}, true)" class="mountain-item group cursor-pointer p-3.5 rounded-2xl ${bgClass} transition-all shadow-xs border border-surface-container/60" data-id="${m.id}">
        <div class="flex items-start justify-between gap-1 mb-1">
          <div>
            <span class="font-headline text-[10px] uppercase font-bold tracking-wider text-on-surface-variant block truncate max-w-[190px]">${m.provinsi} · ${m.kabupaten}</span>
            <h4 class="font-headline font-bold text-base text-primary group-hover:text-primary-container leading-tight mt-0.5">${m.nama}</h4>
          </div>
          <div class="flex items-center gap-1">
            ${statusBadge}
            <button onclick="event.stopPropagation(); openGunungModal(${m.id});" class="p-1 rounded-md hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors" title="Rename / Edit Gunung">
              <span class="material-symbols-outlined text-[14px]">edit</span>
            </button>
          </div>
        </div>
        
        <div class="flex items-center gap-2.5 text-on-surface-variant mt-2 text-xs flex-wrap">
          <span class="flex items-center gap-1 font-headline font-bold text-on-surface">
            <span class="material-symbols-outlined text-[15px] text-primary">filter_hdr</span>
            ${m.ketinggian.toLocaleString('id-ID')} mdpl
          </span>
          ${posBadgeHtml}
          <span class="flex items-center gap-1 font-headline font-medium text-on-surface-variant">
            <span class="material-symbols-outlined text-[15px] text-secondary">alt_route</span>
            ${m.totalJalur} Jalur
          </span>
        </div>

        ${activeTrailBadgeHtml}

        <!-- Jalur / Via badges inside card -->
        <div class="mt-2.5 pt-2 border-t border-surface-container">
          <div class="text-[10px] font-headline font-bold text-on-surface-variant uppercase mb-1">Pilihan Jalur / Via:</div>
          <div class="flex flex-wrap gap-1">
            ${jalurChipsHtml}
          </div>
        </div>

        <div class="mt-2 pt-1.5 flex items-center justify-between text-on-surface-variant font-headline text-[11px]">
          <span><strong class="text-primary font-bold">${m.basecamps.length}</strong> Jalur Resmi</span>
          <span class="text-primary font-bold flex items-center gap-0.5 group-hover:translate-x-1 transition-transform">
            Pilih <span class="material-symbols-outlined text-[14px]">chevron_right</span>
          </span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 4. Render Mountain Pins on Leaflet Map
 * Requirement 1: Jika yang dipilih Jawa Barat, maka peta HANYA menunjukkan Jawa Barat saja, begitu pula yang lain!
 */
function renderMountainPins() {
  mountainMarkersGroup.clearLayers();

  // Filter mountains ONLY belonging to the active selected province
  const provinceMountains = allMountains.filter(m => {
    if (activeRegion === 'jabar') return m.provinsi.toLowerCase().includes('barat');
    if (activeRegion === 'jateng') return m.provinsi.toLowerCase().includes('tengah');
    if (activeRegion === 'diy') return m.provinsi.toLowerCase().includes('diy');
    if (activeRegion === 'jatim') return m.provinsi.toLowerCase().includes('timur');
    return true; // 'all'
  });

  provinceMountains.forEach(m => {
    if (!m.latitude || !m.longitude) return;

    const isSelected = selectedMountain && selectedMountain.id === m.id;
    
    let bubbleColor = '#004724';
    let icon = 'terrain';
    if (m.statusJalur === 'Waspada') {
      bubbleColor = '#954a00';
      icon = 'warning';
    } else if (m.statusJalur === 'Tutup') {
      bubbleColor = '#ba1a1a';
      icon = 'block';
    }

    const pinHtml = `
      <div class="custom-mountain-pin ${isSelected ? 'selected' : ''}" id="map-pin-${m.id}">
        <span class="pin-label ${isSelected ? 'bg-primary text-on-primary ring-2 ring-primary-container' : 'text-on-surface'}">
          ${m.nama} · ${m.ketinggian.toLocaleString('id-ID')} m
        </span>
        <div class="pin-bubble" style="background-color: ${bubbleColor}; width: ${isSelected ? '36px' : '28px'}; height: ${isSelected ? '36px' : '28px'};">
          ${isSelected ? '<div class="pin-pulse" style="background-color: ' + bubbleColor + '"></div>' : ''}
          <span class="material-symbols-outlined text-white text-[${isSelected ? '20px' : '15px'}]">${icon}</span>
        </div>
      </div>
    `;

    const iconObj = L.divIcon({
      html: pinHtml,
      className: 'empty-icon',
      iconSize: [120, 60],
      iconAnchor: [60, 50]
    });

    const marker = L.marker([m.latitude, m.longitude], { icon: iconObj })
      .addTo(mountainMarkersGroup);

    marker.on('click', () => {
      selectMountain(m.id, true);
    });
  });
}

/**
 * 5. Province Filter Switcher
 * Requirement 1: Jika dipilih Jawa Barat, peta fokus ke Jawa Barat saja dan hanya tampilkan titik Jawa Barat
 */
function setProvinceFilter(region) {
  activeRegion = region;
  
  // Update Tab Button Styles
  document.querySelectorAll('.prov-tab').forEach(tab => {
    if (tab.dataset.region === region) {
      tab.classList.add('bg-primary', 'text-on-primary', 'active');
      tab.classList.remove('bg-surface-container', 'text-on-surface-variant');
    } else {
      tab.classList.remove('bg-primary', 'text-on-primary', 'active');
      tab.classList.add('bg-surface-container', 'text-on-surface-variant');
    }
  });

  // Update Region Callout Label on Map
  const regionNames = {
    all: 'PULAU JAWA (SEMUA WILAYAH)',
    jabar: 'PROVINSI JAWA BARAT',
    jateng: 'PROVINSI JAWA TENGAH',
    diy: 'D.I. YOGYAKARTA',
    jatim: 'PROVINSI JAWA TIMUR'
  };
  const regLabel = document.getElementById('map-region-label');
  if (regLabel) regLabel.innerText = `WILAYAH: ${regionNames[region] || 'PULAU JAWA'}`;

  // Re-render Cards and Pins (Only pins in that province will be shown!)
  renderMountainCards();
  renderMountainPins();

  // Fit Map Bounds exclusively to selected province!
  const targetBounds = REGION_BOUNDS[region] || REGION_BOUNDS.all;
  map.flyToBounds(targetBounds, {
    padding: [40, 40],
    duration: 1.2,
    easeLinearity: 0.25
  });

  // Automatically select the first mountain in that province
  const provinceMountains = allMountains.filter(m => {
    if (region === 'jabar') return m.provinsi.toLowerCase().includes('barat');
    if (region === 'jateng') return m.provinsi.toLowerCase().includes('tengah');
    if (region === 'diy') return m.provinsi.toLowerCase().includes('diy');
    if (region === 'jatim') return m.provinsi.toLowerCase().includes('timur');
    return true;
  });

  if (provinceMountains.length > 0) {
    selectMountain(provinceMountains[0].id, false);
  }

  showToast(`Wilayah: ${regionNames[region]}`, 'info');
}

/**
 * 6. Select a Mountain and Show Trail + Waypoints + Jalurs + Inspector
 */
function selectMountain(id, flyTo = true) {
  const m = allMountains.find(item => item.id === id);
  if (!m) return;

  selectedMountain = m;

  // Jika belum ada jalur yang dipilih untuk gunung ini, gunakan jalur pertama sebagai default
  if (!selectedJalurByMountain[m.id] && m.basecamps && m.basecamps.length > 0) {
    selectedJalurByMountain[m.id] = m.basecamps[0].id;
  }
  const bcId = selectedJalurByMountain[m.id];
  selectedBasecamp = m.basecamps.find(b => b.id === bcId) || m.basecamps[0] || null;

  renderMountainCards();
  renderMountainPins();

  // Scroll card into view in sidebar
  const cardEl = document.querySelector(`.mountain-item[data-id="${id}"]`);
  if (cardEl) {
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Draw Trail Polyline & Waypoint Markers dari Basecamp ke Puncak
  if (selectedBasecamp) {
    drawMountainTrail(m, selectedBasecamp);
    updateInspectorPanel(m, selectedBasecamp);
    updateMapTrailSummary(m, selectedBasecamp);

    const waypoints = getExpeditionWaypoints(m, selectedBasecamp);
    const summary = calculateTrailSegments(waypoints);
    showToast(`🏔️ ${m.nama} via ${selectedBasecamp.jalurVia}: Jarak ${summary.totalDistanceFormatted} (BC ➔ Puncak) · ${selectedBasecamp.pos.length} Pos`, 'info');
  } else {
    updateInspectorPanel(m, null);
    closeMapTrailSummary();
    if (flyTo && m.latitude && m.longitude) {
      map.flyTo([m.latitude, m.longitude], 12.5, { duration: 1.0 });
    }
  }

  // Update Telemetry Bar
  const targetLat = selectedBasecamp ? selectedBasecamp.latitude : m.latitude;
  const targetLng = selectedBasecamp ? selectedBasecamp.longitude : m.longitude;
  if (targetLat && targetLng) {
    document.getElementById('telemetry-coord').innerText = 
      `${Math.abs(targetLng).toFixed(3)}° E · ${Math.abs(targetLat).toFixed(3)}° S`;
  }
}

/**
 * 7. Switch Jalur / Via / Basecamp within selected Mountain (Pencet via/jalur baru disesuaikan jumlah posnya)
 */
function switchJalur(mountainId, basecampId) {
  const m = allMountains.find(item => item.id === mountainId);
  if (!m) return;

  selectedMountain = m;
  const bc = m.basecamps.find(b => b.id === basecampId) || m.basecamps[0];
  selectedBasecamp = bc;
  selectedJalurByMountain[m.id] = bc.id;

  renderMountainCards();
  renderMountainPins();

  drawMountainTrail(m, bc);
  updateInspectorPanel(m, bc);
  updateMapTrailSummary(m, bc);

  const waypoints = getExpeditionWaypoints(m, bc);
  const summary = calculateTrailSegments(waypoints);

  showToast(`Jalur dipilih: ${m.nama} via ${bc.jalurVia} · ${summary.totalDistanceFormatted} (BC ➔ Puncak) · ${bc.pos.length} Pos`, 'success');
}

/**
 * Helper: Bangun rute urutan lintasan resmi dari Posisi Berdiri di Basecamp -> Pos 1 -> Pos 2 -> ... -> Puncak
 */
function getExpeditionWaypoints(mountain, basecamp) {
  if (!mountain || !basecamp) return [];
  const waypoints = [];

  // 1. Titik Awal: Basecamp (Tempat pendaki berdiri sebelum berangkat)
  waypoints.push({
    id: `bc-${basecamp.id}`,
    basecampId: basecamp.id,
    name: basecamp.nama,
    type: 'basecamp',
    urutan: 0,
    lat: basecamp.latitude,
    lng: basecamp.longitude,
    elev: basecamp.elevasi || 1400,
    areaCamp: true,
    keterangan: 'Titik awal keberangkatan pendakian resmi (Basecamp)'
  });

  // 2. Pos-pos pendakian berurutan
  const sortedPos = [...(basecamp.pos || [])].sort((a, b) => (a.urutan || 0) - (b.urutan || 0));
  sortedPos.forEach((p, idx) => {
    waypoints.push({
      id: p.id,
      basecampId: p.basecampId,
      name: p.namaPos,
      type: 'pos',
      urutan: p.urutan || (idx + 1),
      lat: p.latitude,
      lng: p.longitude,
      elev: p.elevasi || Math.round((basecamp.elevasi || 1400) + (idx + 1) * 200),
      adaAir: p.adaAir,
      areaCamp: p.areaCamp,
      keterangan: p.keterangan || `Pos pendakian #${p.urutan || (idx + 1)}`
    });
  });

  // 3. Titik Akhir: Puncak Gunung (jika belum tercakup pos)
  if (mountain.latitude && mountain.longitude) {
    const lastWp = waypoints[waypoints.length - 1];
    const distToPeak = calculateHaversineMeters(lastWp.lat, lastWp.lng, mountain.latitude, mountain.longitude);
    if (distToPeak > 150 && !lastWp.name.toLowerCase().includes('puncak')) {
      waypoints.push({
        id: `summit-${mountain.id}`,
        basecampId: basecamp.id,
        name: `Puncak ${mountain.nama}`,
        type: 'summit',
        urutan: waypoints.length,
        lat: mountain.latitude,
        lng: mountain.longitude,
        elev: mountain.ketinggian,
        areaCamp: false,
        keterangan: `Titik tertinggi Puncak ${mountain.nama} (${mountain.ketinggian} MDPL)`
      });
    }
  }

  return waypoints;
}

/**
 * Helper: Hitung kalkulasi segmen jalan kaki & tanjakan elevasi per pos
 */
function calculateTrailSegments(waypoints) {
  if (!waypoints || waypoints.length < 2) {
    return { segments: [], totalDistanceM: 0, totalGainM: 0, totalMinutes: 0, totalDistanceFormatted: '0 km', totalGainFormatted: '+0 m', totalHoursFormatted: '0 Menit' };
  }

  const segments = [];
  let totalDistanceM = 0;
  let totalGainM = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];

    const distM = calculateHaversineMeters(from.lat, from.lng, to.lat, to.lng);
    const elevDiff = (to.elev || 0) - (from.elev || 0);
    const gainM = Math.max(0, elevDiff);

    totalDistanceM += distM;
    totalGainM += gainM;

    // Estimasi waktu hiking (kecepatan datar ~3 km/jam + tanjakan vertikal ~400m/jam)
    const flatMinutes = (distM / 1000) / 3.0 * 60;
    const climbMinutes = (gainM / 400) * 60;
    const estMinutes = Math.round(Math.max(15, flatMinutes + climbMinutes));

    segments.push({
      stepNumber: i + 1,
      fromName: from.name,
      toName: to.name,
      fromElev: from.elev,
      toElev: to.elev,
      distanceM: Math.round(distM),
      distanceFormatted: distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`,
      elevGain: gainM,
      elevGainFormatted: gainM > 0 ? `+${gainM} m` : '±0 m',
      estMinutes,
      estTimeFormatted: estMinutes >= 60 ? `${Math.floor(estMinutes / 60)}j ${estMinutes % 60}m` : `${estMinutes} mnt`,
      keterangan: to.keterangan || (to.type === 'summit' ? 'Menuju Titik Puncak' : `Pos pendakian`)
    });
  }

  const totalMinutes = segments.reduce((acc, s) => acc + s.estMinutes, 0);

  return {
    segments,
    totalDistanceM: Math.round(totalDistanceM),
    totalDistanceFormatted: `${(totalDistanceM / 1000).toFixed(2)} km`,
    totalGainM,
    totalGainFormatted: `+${totalGainM} m`,
    totalMinutes,
    totalHoursFormatted: totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)} Jam ${totalMinutes % 60} Menit` : `${totalMinutes} Menit`
  };
}

/**
 * 8. Draw Trail Polyline connecting Basecamp -> Pos 1 -> Pos 2 -> ... -> Puncak
 * Sesuai rute ekspedisi berdiri dari basecamp ke pos hingga puncak
 */
function drawMountainTrail(mountain, basecamp) {
  trailMarkersGroup.clearLayers();
  markerInstances = {};

  if (!basecamp) return;

  const waypoints = getExpeditionWaypoints(mountain, basecamp);
  if (waypoints.length === 0) return;

  // Initialize editingWaypoints state for coordinate editor & live dragging
  editingWaypoints = waypoints.map(w => ({
    id: w.id,
    rawId: w.type === 'basecamp' ? basecamp.id : (w.type === 'summit' ? mountain.id : w.id),
    name: w.name,
    type: w.type,
    urutan: w.urutan,
    lat: w.lat,
    lng: w.lng,
    elev: w.elev,
    originalLat: w.lat,
    originalLng: w.lng,
    keterangan: w.keterangan
  }));

  const summary = calculateTrailSegments(waypoints);
  const polyCoords = waypoints.map(w => [w.lat, w.lng]);

  if (polyCoords.length >= 2) {
    // 1. White casing polyline underneath for high contrast
    activeTrailCasing = L.polyline(polyCoords, {
      color: '#ffffff',
      weight: 8,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(trailMarkersGroup);

    // 2. High-visibility emerald hiking trail with marching dashes
    activeTrailPolyline = L.polyline(polyCoords, {
      color: '#059669',
      weight: 5,
      opacity: 0.95,
      dashArray: '8, 6',
      className: 'trail-path'
    }).addTo(trailMarkersGroup);

    // Tooltip on the trail line
    const distFormatted = summary.totalDistanceFormatted;
    const posCount = basecamp.pos ? basecamp.pos.length : 0;
    const tooltipHtml = `
      <div class="p-1.5 text-xs font-headline font-bold text-on-surface">
        <div class="text-primary font-bold">🏔️ ${mountain.nama} · Via ${basecamp.jalurVia}</div>
        <div class="text-on-surface mt-0.5 font-mono">🛣️ Jarak Jalur: <strong class="text-primary">${distFormatted}</strong> (BC ➔ Puncak)</div>
        <div class="text-secondary font-mono">📍 Jumlah Pos: <strong class="text-secondary">${posCount} Pos</strong> Pendakian</div>
        <div class="text-[10px] text-on-surface-variant font-normal mt-0.5 italic">Klik jalur untuk buka panduan langkah rute</div>
      </div>
    `;
    activeTrailPolyline.bindTooltip(tooltipHtml, { sticky: true, className: 'trail-tooltip' });
    activeTrailPolyline.on('click', () => {
      openArahRutePendakianModal();
    });

    // 3. Smooth fitBounds so the full trail from BC all the way to Puncak is framed right in the center!
    const bounds = L.latLngBounds(polyCoords);
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [80, 80],
        maxZoom: 14,
        animate: true,
        duration: 1.0
      });
    }
  }

  // Hitung akumulasi jarak dari Basecamp untuk setiap titik
  let cumDistanceM = 0;

  waypoints.forEach((wp, idx) => {
    if (idx > 0) {
      const prev = waypoints[idx - 1];
      cumDistanceM += calculateHaversineMeters(prev.lat, prev.lng, wp.lat, wp.lng);
    }

    const distFromBcFormatted = cumDistanceM >= 1000 ? `${(cumDistanceM / 1000).toFixed(2)} km` : `${Math.round(cumDistanceM)} m`;
    let pinColor = '#059669'; // Emerald
    let innerContent = '';
    let size = 30;
    let labelPillText = '';

    if (wp.type === 'basecamp') {
      pinColor = '#d97706'; // Amber 600
      size = 36;
      innerContent = `<span class="material-symbols-outlined text-[20px]">cottage</span>`;
      labelPillText = `🚩 START: BC ${basecamp.jalurVia} (0.0 km)`;
    } else if (wp.type === 'summit' || idx === waypoints.length - 1) {
      pinColor = '#b91c1c'; // Red 700
      size = 38;
      innerContent = `<span class="material-symbols-outlined text-[20px]">filter_hdr</span>`;
      labelPillText = `⛰️ FINISH: Puncak (${summary.totalDistanceFormatted})`;
    } else {
      // Pos Intermediate: display order number inside circle pin
      const orderNum = wp.urutan || idx;
      innerContent = `<span class="font-headline font-bold text-xs font-mono">${orderNum}</span>`;
      labelPillText = `Pos ${orderNum}: ${wp.name} (${distFromBcFormatted})`;
    }

    const posHtml = `
      <div class="custom-geo-pin">
        <span class="geo-pin-label">${labelPillText}</span>
        <div style="background-color: ${pinColor}; width: ${size}px; height: ${size}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2.5px solid white;">
          ${innerContent}
        </div>
      </div>
    `;

    const posIcon = L.divIcon({
      html: posHtml,
      className: 'empty-icon',
      iconSize: [140, size + 20],
      iconAnchor: [70, size + 20]
    });

    const marker = L.marker([wp.lat, wp.lng], { 
      icon: posIcon,
      draggable: isDragMarkerMode 
    }).addTo(trailMarkersGroup);

    markerInstances[wp.id] = marker;

    // Real-time drag event listener: updates polyline and KM recalculation immediately
    marker.on('drag', (e) => {
      const { lat, lng } = e.target.getLatLng();
      const newLat = parseFloat(lat.toFixed(6));
      const newLng = parseFloat(lng.toFixed(6));

      const curWp = editingWaypoints.find(w => w.id === wp.id);
      if (curWp) {
        curWp.lat = newLat;
        curWp.lng = newLng;
      }

      const rawId = wp.type === 'basecamp' ? basecamp.id : (wp.type === 'summit' ? mountain.id : wp.id);
      const rowLat = document.getElementById(`coord-lat-${wp.type}-${rawId}`);
      const rowLng = document.getElementById(`coord-lng-${wp.type}-${rawId}`);
      if (rowLat) rowLat.value = newLat;
      if (rowLng) rowLng.value = newLng;

      updateLivePolyline();
      updateCoordEditorDistance();
    });

    marker.on('dragend', (e) => {
      const { lat, lng } = e.target.getLatLng();
      const distFormatted = document.getElementById('coord-editor-live-dist')?.innerText || '';
      showToast(`📍 Posisi ${wp.name} digeser: ${lat.toFixed(6)}, ${lng.toFixed(6)}${distFormatted ? ' · Jarak: ' + distFormatted : ''}`, 'info');
    });

    // Marker Popup
    const isBc = wp.type === 'basecamp';
    const isSummit = wp.type === 'summit' || idx === waypoints.length - 1;
    const badgeText = isBc ? 'TITIK AWAL (BASECAMP)' : (isSummit ? 'TITIK AKHIR (PUNCAK)' : `POS #${wp.urutan || idx}`);
    const distInfo = isBc 
      ? `Total Jarak ke Puncak: <strong class="text-primary font-mono">${summary.totalDistanceFormatted}</strong>`
      : isSummit
        ? `Total Jarak Ditempuh: <strong class="text-primary font-mono">${summary.totalDistanceFormatted}</strong>`
        : `Jarak dari Basecamp: <strong class="text-secondary font-mono">${distFromBcFormatted}</strong>`;

    const popupHtml = `
      <div class="p-3 text-xs flex flex-col gap-1.5 min-w-[240px]">
        <div class="flex items-center justify-between border-b border-surface-container pb-1">
          <span class="font-headline font-bold text-[10px] uppercase text-secondary">${mountain.nama} · Via ${basecamp.jalurVia}</span>
          <span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-headline font-bold text-[10px]">${badgeText}</span>
        </div>
        <h4 class="font-headline font-bold text-sm text-primary leading-tight mt-0.5">${wp.name}</h4>
        <div class="flex items-center justify-between text-on-surface-variant text-[11px] font-mono">
          <span>${wp.elev ? wp.elev.toLocaleString('id-ID') + ' mdpl' : '-'}</span>
          <span>${distInfo}</span>
        </div>
        <div class="bg-surface-container-low p-2 rounded-lg text-[11px] text-on-surface-variant flex items-center justify-between mt-1">
          <span>Jalur Via: <strong>${basecamp.jalurVia}</strong></span>
          <span>Jumlah Pos: <strong class="text-secondary">${basecamp.pos.length} Pos</strong></span>
        </div>
        ${wp.keterangan ? `<p class="text-[11px] text-on-surface-variant italic mt-0.5">${wp.keterangan}</p>` : ''}
        <div class="mt-1 flex items-center justify-between gap-1 pt-1.5 border-t border-surface-container">
          <button onclick="openArahRutePendakianModal()" class="text-secondary hover:underline font-headline font-bold text-[11px] flex items-center gap-0.5">
            <span class="material-symbols-outlined text-[14px]">alt_route</span> Panduan Rute
          </button>
          <div class="flex items-center gap-1">
            <button onclick="openCoordEditorModal()" class="px-2 py-0.5 rounded bg-surface-container hover:bg-secondary hover:text-white text-secondary text-[10px] font-bold transition-colors flex items-center gap-0.5" title="Edit Lat/Lng jalur">
              <span class="material-symbols-outlined text-[12px]">edit_location_alt</span> Edit Lat/Lng
            </button>
            ${wp.type === 'pos' ? `<button onclick="openPosModal(${wp.id}, ${wp.basecampId})" class="px-2 py-0.5 rounded bg-surface-container hover:bg-primary hover:text-white text-primary text-[10px] font-bold transition-colors">Rename Pos</button>` : ''}
          </div>
        </div>
      </div>
    `;

    marker.bindPopup(popupHtml);
  });
}

/**
 * 9. Update Inspector Panel at Bottom Right with Jalur Selector & Metrics
 */
function updateInspectorPanel(mountain, basecamp) {
  const panel = document.getElementById('inspector-panel');
  if (!panel) return;

  panel.classList.remove('hidden');

  // Title & Subtitle
  document.getElementById('inspector-title').innerText = mountain.nama;
  document.getElementById('inspector-subtitle').innerHTML = 
    `${mountain.kabupaten}, ${mountain.provinsi} · Ketinggian Puncak <strong class="text-on-surface">${mountain.ketinggian.toLocaleString('id-ID')} mdpl</strong>`;

  // Status Badge
  const statusBadge = document.getElementById('inspector-status-badge');
  if (mountain.statusJalur === 'Buka') {
    statusBadge.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-headline text-[10px] font-bold';
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-tertiary-container animate-ping"></span> JALUR BUKA RESMI`;
  } else if (mountain.statusJalur === 'Waspada') {
    statusBadge.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-headline text-[10px] font-bold';
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> WASPADA LEVEL 2`;
  } else {
    statusBadge.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container font-headline text-[10px] font-bold';
    statusBadge.innerHTML = `<span class="material-symbols-outlined text-[12px]">lock</span> JALUR DITUTUP SEMENTARA`;
  }

  // Type
  const typeEl = document.getElementById('inspector-type');
  if (typeEl) typeEl.innerText = mountain.tipeGunung || 'GUNUNG PENDAKIAN';

  // Render Jalur Pills with distance KM and pos count
  const jalurPillsContainer = document.getElementById('inspector-jalur-pills');
  document.getElementById('inspector-jalur-count-badge').innerText = `${mountain.basecamps.length} Jalur`;

  jalurPillsContainer.innerHTML = mountain.basecamps.map(b => {
    const isBcActive = basecamp && basecamp.id === b.id;
    const bWaypoints = getExpeditionWaypoints(mountain, b);
    const bSummary = calculateTrailSegments(bWaypoints);
    const pillClass = isBcActive 
      ? 'bg-primary text-on-primary font-bold shadow-md ring-2 ring-primary-container scale-[1.02]' 
      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface font-semibold';
    return `
      <button onclick="switchJalur(${mountain.id}, ${b.id})" class="px-3 py-1.5 rounded-xl font-headline text-xs shrink-0 transition-all flex items-center gap-1.5 ${pillClass}">
        <span>Via ${b.jalurVia}</span>
        <span class="text-[10px] ${isBcActive ? 'bg-black/20 text-white' : 'bg-surface-container-highest text-on-surface-variant'} px-1.5 py-0.5 rounded-md font-mono font-bold">${bSummary.totalDistanceFormatted}</span>
        <span class="text-[10px] opacity-80 font-bold">(${b.pos.length} Pos)</span>
      </button>
    `;
  }).join('');

  // Trail Waypoint & Segment Calculations
  const waypoints = basecamp ? getExpeditionWaypoints(mountain, basecamp) : [];
  const trailSummary = calculateTrailSegments(waypoints);
  const posCount = basecamp ? basecamp.pos.length : mountain.totalPos;

  // Metrics: Focus on Jarak BC-Puncak (KM) and Jumlah Pos
  const distEl = document.getElementById('metric-trail-distance');
  if (distEl) distEl.innerText = trailSummary.totalDistanceFormatted;
  const distDescEl = document.getElementById('metric-trail-distance-desc');
  if (distDescEl) distDescEl.innerText = basecamp ? 'BC ➔ Puncak' : 'Panjang Jalur';

  const posTotalEl = document.getElementById('metric-total-pos');
  if (posTotalEl) posTotalEl.innerText = `${posCount} Pos`;
  const posDescEl = document.getElementById('metric-total-pos-desc');
  if (posDescEl) posDescEl.innerText = basecamp ? `Via ${basecamp.jalurVia}` : 'Total Pos';

  const bcNameEl = document.getElementById('metric-basecamp-count');
  if (bcNameEl) bcNameEl.innerText = basecamp ? basecamp.nama : `${mountain.totalJalur} Jalur`;
  const bcElevEl = document.getElementById('metric-basecamp-list');
  if (bcElevEl) bcElevEl.innerText = basecamp ? `${(basecamp.elevasi || 1500).toLocaleString('id-ID')} mdpl (Awal)` : 'Pilih jalur';

  const puncakElevEl = document.getElementById('metric-puncak-elev');
  if (puncakElevEl) puncakElevEl.innerText = `${mountain.ketinggian.toLocaleString('id-ID')} mdpl`;

  const gainEl = document.getElementById('metric-gain-val');
  if (gainEl) gainEl.innerText = `+${trailSummary.totalGainM.toLocaleString('id-ID')} m Gain`;

  // Dynamic Elevation Profile Curve
  renderElevationProfile(mountain, basecamp, trailSummary);
}

/**
 * Update Floating Trail Summary Overlay on the Map
 */
function updateMapTrailSummary(mountain, basecamp) {
  const banner = document.getElementById('map-trail-summary');
  if (!banner) return;

  if (!mountain || !basecamp) {
    banner.classList.add('hidden');
    return;
  }

  const waypoints = getExpeditionWaypoints(mountain, basecamp);
  const summary = calculateTrailSegments(waypoints);
  const bcElev = basecamp.elevasi || Math.round(mountain.ketinggian * 0.45);
  const gain = Math.max(0, mountain.ketinggian - bcElev);

  const titleEl = document.getElementById('map-trail-title');
  if (titleEl) titleEl.innerText = `${mountain.nama} · Via ${basecamp.jalurVia}`;

  const distEl = document.getElementById('map-trail-dist');
  if (distEl) distEl.innerText = `${summary.totalDistanceFormatted}`;

  const posEl = document.getElementById('map-trail-pos');
  if (posEl) posEl.innerText = `${basecamp.pos.length} Pos`;

  const gainEl = document.getElementById('map-trail-gain');
  if (gainEl) gainEl.innerText = `${bcElev.toLocaleString('id-ID')}m ➔ ${mountain.ketinggian.toLocaleString('id-ID')}m (+${gain.toLocaleString('id-ID')}m)`;

  banner.classList.remove('hidden');
}

function closeMapTrailSummary() {
  const banner = document.getElementById('map-trail-summary');
  if (banner) banner.classList.add('hidden');
}

/**
 * 8B. Coordinate Editor & Live Interactive Dragging
 * Memungkinkan editing Latitude & Longitude titik jalur (Basecamp, Pos, Puncak)
 * langsung dari web tanpa ubah Excel manual, dengan kalkulasi live jarak KM rute.
 */
function openCoordEditorModal() {
  const m = selectedMountain || allMountains[0];
  const bc = selectedBasecamp || m?.basecamps[0];

  if (!m || !bc) {
    showToast('Pilih gunung dan jalur via terlebih dahulu', 'warning');
    return;
  }

  const badge = document.getElementById('coord-editor-mountain-badge');
  if (badge) {
    badge.innerText = `${m.nama} · Via ${bc.jalurVia}`;
  }

  // Pastikan editingWaypoints terisi dari lintasan aktif
  if (!editingWaypoints || editingWaypoints.length === 0) {
    const waypoints = getExpeditionWaypoints(m, bc);
    editingWaypoints = waypoints.map(w => ({
      id: w.id,
      rawId: w.type === 'basecamp' ? bc.id : (w.type === 'summit' ? m.id : w.id),
      name: w.name,
      type: w.type,
      urutan: w.urutan,
      lat: w.lat,
      lng: w.lng,
      elev: w.elev,
      originalLat: w.lat,
      originalLng: w.lng,
      keterangan: w.keterangan
    }));
  }

  renderCoordEditorTable();
  updateCoordEditorDistance();

  // Sinkronkan toggle checkbox mode geser pin
  const toggle = document.getElementById('toggle-drag-markers');
  if (toggle) toggle.checked = isDragMarkerMode;

  document.getElementById('coord-editor-modal')?.classList.remove('hidden');
}

function closeCoordEditorModal() {
  document.getElementById('coord-editor-modal')?.classList.add('hidden');
  isPickingCoordinates = false;
  activeCoordTarget = null;
}

function renderCoordEditorTable() {
  const tbody = document.getElementById('coord-editor-tbody');
  if (!tbody || !editingWaypoints) return;

  tbody.innerHTML = editingWaypoints.map((wp, idx) => {
    let typeBadge = '';
    if (wp.type === 'basecamp') {
      typeBadge = `<span class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-headline font-bold text-[10px]">🚩 Basecamp</span>`;
    } else if (wp.type === 'summit') {
      typeBadge = `<span class="px-2 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-300 font-headline font-bold text-[10px]">⛰️ Puncak</span>`;
    } else {
      typeBadge = `<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-headline font-bold text-[10px]">Pos ${wp.urutan || idx}</span>`;
    }

    const safeName = (wp.name || '').replace(/'/g, "\\'");

    return `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="py-2.5 px-1">${typeBadge}</td>
        <td class="py-2.5 px-2">
          <div class="font-headline font-bold text-on-surface text-xs">${wp.name}</div>
          <div class="text-[10px] text-on-surface-variant font-mono">${wp.keterangan || (wp.type === 'summit' ? 'Puncak Tertinggi' : 'Titik Jalur')}</div>
        </td>
        <td class="py-2.5 px-2 font-mono text-on-surface-variant text-xs">
          ${wp.elev ? wp.elev.toLocaleString('id-ID') + ' m' : '-'}
        </td>
        <td class="py-2.5 px-2">
          <input 
            id="coord-lat-${wp.type}-${wp.rawId}" 
            type="number" 
            step="any" 
            value="${wp.lat}" 
            class="w-full bg-surface-container-low border border-surface-container rounded-lg p-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary font-semibold"
            oninput="onCoordInputChange('${wp.type}', '${wp.rawId}')"
          >
        </td>
        <td class="py-2.5 px-2">
          <input 
            id="coord-lng-${wp.type}-${wp.rawId}" 
            type="number" 
            step="any" 
            value="${wp.lng}" 
            class="w-full bg-surface-container-low border border-surface-container rounded-lg p-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary font-semibold"
            oninput="onCoordInputChange('${wp.type}', '${wp.rawId}')"
          >
        </td>
        <td class="py-2.5 px-1 text-right">
          <button 
            type="button" 
            onclick="pickCoordinateForPoint('${wp.type}', '${wp.rawId}', '${safeName}')" 
            class="px-2 py-1 rounded-lg bg-surface-container-high hover:bg-secondary hover:text-white text-secondary font-headline font-bold text-[10px] inline-flex items-center gap-1 transition-colors"
            title="Klik peta untuk ambil koordinat titik ini"
          >
            <span class="material-symbols-outlined text-[13px]">my_location</span>
            <span>Peta</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function onCoordInputChange(type, id) {
  const rowLat = document.getElementById(`coord-lat-${type}-${id}`);
  const rowLng = document.getElementById(`coord-lng-${type}-${id}`);
  if (!rowLat || !rowLng) return;

  const latVal = parseFloat(rowLat.value);
  const lngVal = parseFloat(rowLng.value);
  if (isNaN(latVal) || isNaN(lngVal)) return;

  const target = editingWaypoints.find(w => w.type === type && String(w.rawId) === String(id));
  if (target) {
    target.lat = latVal;
    target.lng = lngVal;

    // Update pin marker di peta jika ada
    const marker = markerInstances[target.id];
    if (marker) {
      marker.setLatLng([latVal, lngVal]);
    }

    updateLivePolyline();
    updateCoordEditorDistance();
  }
}

function updateLivePolyline() {
  if (!editingWaypoints || editingWaypoints.length < 2) return;
  const pts = editingWaypoints.map(w => [w.lat, w.lng]);
  if (activeTrailCasing) activeTrailCasing.setLatLngs(pts);
  if (activeTrailPolyline) activeTrailPolyline.setLatLngs(pts);
}

function updateCoordEditorDistance() {
  if (!editingWaypoints || editingWaypoints.length === 0) return;
  const summary = calculateTrailSegments(editingWaypoints);

  const liveDistEl = document.getElementById('coord-editor-live-dist');
  if (liveDistEl) liveDistEl.innerText = summary.totalDistanceFormatted;

  const liveCountEl = document.getElementById('coord-editor-point-count');
  if (liveCountEl) liveCountEl.innerText = `${editingWaypoints.length} Titik`;

  // Update floating banner jarak di peta
  const mapDistEl = document.getElementById('map-trail-dist');
  if (mapDistEl) mapDistEl.innerText = summary.totalDistanceFormatted;

  // Update inspector panel jarak & elevasi gain
  const metricDistEl = document.getElementById('metric-trail-distance');
  if (metricDistEl) metricDistEl.innerText = summary.totalDistanceFormatted;

  const metricGainEl = document.getElementById('metric-gain-val');
  if (metricGainEl) metricGainEl.innerText = summary.totalGainFormatted;

  if (activeTrailPolyline) {
    const m = selectedMountain;
    const bc = selectedBasecamp;
    if (m && bc) {
      const tooltipHtml = `
        <div class="p-1.5 text-xs font-headline font-bold text-on-surface">
          <div class="text-primary font-bold">🏔️ ${m.nama} · Via ${bc.jalurVia}</div>
          <div class="text-on-surface mt-0.5 font-mono">🛣️ Jarak Jalur: <strong class="text-primary">${summary.totalDistanceFormatted}</strong> (BC ➔ Puncak)</div>
          <div class="text-secondary font-mono">📍 Jumlah Pos: <strong class="text-secondary">${bc.pos ? bc.pos.length : 0} Pos</strong> Pendakian</div>
          <div class="text-[10px] text-on-surface-variant font-normal mt-0.5 italic">Klik jalur untuk buka panduan langkah rute</div>
        </div>
      `;
      activeTrailPolyline.setTooltipContent(tooltipHtml);
    }
  }
}

function toggleDragMarkerMode(enable) {
  isDragMarkerMode = !!enable;

  // Sinkronkan checkbox state
  const checkbox = document.getElementById('toggle-drag-markers');
  if (checkbox && checkbox.checked !== isDragMarkerMode) {
    checkbox.checked = isDragMarkerMode;
  }

  // Aktifkan / nonaktifkan dragging pada semua pin di peta
  Object.values(markerInstances).forEach(marker => {
    if (marker && marker.dragging) {
      if (isDragMarkerMode) {
        marker.dragging.enable();
      } else {
        marker.dragging.disable();
      }
    }
  });

  if (isDragMarkerMode) {
    showToast('Mode Geser Pin AKTIF: Anda dapat menggeser pin di peta untuk melihat jarak KM berubah real-time!', 'info');
  } else {
    showToast('Mode Geser Pin DINONAKTIFKAN.', 'info');
  }
}

function pickCoordinateForPoint(type, id, name) {
  closeCoordEditorModal();
  isPickingCoordinates = true;
  activeCoordTarget = { type, id: String(id), name };
  switchView('map');
  showToast(`Silakan KLIK pada peta untuk menentukan koordinat ${name}`, 'info');
}

function resetCoordEditor() {
  if (!editingWaypoints || editingWaypoints.length === 0) return;

  editingWaypoints.forEach(wp => {
    wp.lat = wp.originalLat;
    wp.lng = wp.originalLng;

    const rowLat = document.getElementById(`coord-lat-${wp.type}-${wp.rawId}`);
    const rowLng = document.getElementById(`coord-lng-${wp.type}-${wp.rawId}`);
    if (rowLat) rowLat.value = wp.originalLat;
    if (rowLng) rowLng.value = wp.originalLng;

    const marker = markerInstances[wp.id];
    if (marker) {
      marker.setLatLng([wp.originalLat, wp.originalLng]);
    }
  });

  updateLivePolyline();
  updateCoordEditorDistance();
  showToast('Koordinat dikembalikan ke nilai semula.', 'info');
}

async function saveCoordinatesBatch() {
  const m = selectedMountain;
  const bc = selectedBasecamp;
  if (!m || !bc || !editingWaypoints || editingWaypoints.length === 0) {
    showToast('Data jalur belum siap untuk disimpan', 'error');
    return;
  }

  const bcWp = editingWaypoints.find(w => w.type === 'basecamp');
  const summitWp = editingWaypoints.find(w => w.type === 'summit');
  const posWps = editingWaypoints.filter(w => w.type === 'pos');

  const payload = {
    pos: posWps.map(p => ({
      id: parseInt(p.rawId, 10),
      latitude: parseFloat(p.lat),
      longitude: parseFloat(p.lng)
    }))
  };

  if (bcWp) {
    payload.basecamp = {
      id: parseInt(bcWp.rawId, 10),
      latitude: parseFloat(bcWp.lat),
      longitude: parseFloat(bcWp.lng)
    };
  }

  if (summitWp) {
    payload.gunung = {
      id: parseInt(summitWp.rawId, 10),
      latitude: parseFloat(summitWp.lat),
      longitude: parseFloat(summitWp.lng)
    };
  }

  try {
    const res = await fetch('/api/coordinates/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.success) {
      showToast(json.message || 'Koordinat berhasil disimpan ke database!', 'success');

      // Update in-memory models
      if (bcWp && bc) {
        bc.latitude = bcWp.lat;
        bc.longitude = bcWp.lng;
        const foundBc = allBasecamps.find(b => b.id === bc.id);
        if (foundBc) {
          foundBc.latitude = bcWp.lat;
          foundBc.longitude = bcWp.lng;
        }
      }

      if (summitWp && m) {
        m.latitude = summitWp.lat;
        m.longitude = summitWp.lng;
        const foundM = allMountains.find(item => item.id === m.id);
        if (foundM) {
          foundM.latitude = summitWp.lat;
          foundM.longitude = summitWp.lng;
        }
      }

      posWps.forEach(p => {
        const foundPos = bc.pos?.find(item => item.id === parseInt(p.rawId, 10));
        if (foundPos) {
          foundPos.latitude = p.lat;
          foundPos.longitude = p.lng;
        }
      });

      // Update originalLat & originalLng
      editingWaypoints.forEach(w => {
        w.originalLat = w.lat;
        w.originalLng = w.lng;
      });

      closeCoordEditorModal();

      // Redraw trail and update UI
      drawMountainTrail(m, bc);
      updateInspectorPanel(m, bc);
      updateMapTrailSummary(m, bc);
      renderMountainPins();
      renderMountainCards();
    } else {
      showToast(json.message || 'Gagal menyimpan koordinat', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan koneksi: ' + err.message, 'error');
  }
}

/**
 * Render Dynamic SVG Elevation Profile with Waypoints
 */
function renderElevationProfile(mountain, basecamp, trailSummary) {
  const elevSvg = document.getElementById('elev-svg');
  if (!elevSvg) return;

  const summary = trailSummary || calculateTrailSegments(getExpeditionWaypoints(mountain, basecamp));
  const jalurName = basecamp ? basecamp.jalurVia : 'Jalur Utama';
  document.getElementById('elev-profile-label').innerText = `Profil Jalur: BC ${basecamp ? basecamp.nama : 'Basecamp'} ➔ Puncak ${mountain.nama}`;

  const bcElev = basecamp?.elevasi || Math.round(mountain.ketinggian * 0.45);
  const summitElev = mountain.ketinggian;
  const gain = summitElev - bcElev;
  const posCount = basecamp?.pos?.length || 4;

  document.getElementById('elev-gain-label').innerText = `+${gain.toLocaleString('id-ID')} m Gain · ${summary.totalDistanceFormatted} · ${posCount} Pos`;
  document.getElementById('elev-start-label').innerText = `Basecamp ${bcElev}m`;
  document.getElementById('elev-summit-label').innerText = `Puncak ${summitElev}m`;

  const dotsGroup = document.getElementById('elev-dots');
  dotsGroup.innerHTML = '';

  const coords = [];
  coords.push({ x: 0, y: 38, name: 'Basecamp' });

  for (let i = 1; i <= posCount; i++) {
    const x = Math.round((i / (posCount + 1)) * 440 + 20);
    const progress = i / (posCount + 1);
    const y = Math.round(38 - Math.pow(progress, 0.8) * 34);
    coords.push({ x, y, name: basecamp?.pos[i - 1]?.namaPos || `Pos ${i}` });

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', '#1e5f38');
    dotsGroup.appendChild(circle);
  }

  coords.push({ x: 480, y: 2, name: 'Puncak' });
  const summitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  summitCircle.setAttribute('cx', '480');
  summitCircle.setAttribute('cy', '2');
  summitCircle.setAttribute('r', '4');
  summitCircle.setAttribute('fill', '#ff850d');
  dotsGroup.appendChild(summitCircle);

  const lineD = 'M ' + coords.map(c => `${c.x} ${c.y}`).join(' L ');
  const areaD = lineD + ' L 480 40 L 0 40 Z';

  document.getElementById('elev-line').setAttribute('d', lineD);
  document.getElementById('elev-area').setAttribute('d', areaD);
}

function closeInspector() {
  const panel = document.getElementById('inspector-panel');
  if (panel) panel.classList.add('hidden');
}

/**
 * 10. Filters & Toggles
 */
function applyFilters() {
  filterOpen = document.getElementById('toggle-open')?.checked ?? true;
  filterWater = document.getElementById('toggle-water')?.checked ?? false;
  filterBeginner = document.getElementById('toggle-beginner')?.checked ?? false;

  renderMountainCards();
  renderMountainPins();
}

function resetFilters() {
  activeRegion = 'all';
  filterOpen = false;
  filterWater = false;
  filterBeginner = false;
  searchQuery = '';

  const searchInput = document.getElementById('mountain-search');
  if (searchInput) searchInput.value = '';

  document.getElementById('toggle-open').checked = false;
  document.getElementById('toggle-water').checked = false;
  document.getElementById('toggle-beginner').checked = false;

  setProvinceFilter('all');
}

function clearSearch() {
  const input = document.getElementById('mountain-search');
  if (input) input.value = '';
  searchQuery = '';
  document.getElementById('clear-search')?.classList.add('hidden');
  renderMountainCards();
}

/**
 * 11. View Switcher
 */
function switchView(viewName) {
  const views = ['map', 'detail', 'basecamp'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      if (v === viewName) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  const navBtns = {
    map: document.getElementById('nav-btn-map'),
    detail: document.getElementById('nav-btn-detail'),
    basecamp: document.getElementById('nav-btn-basecamp'),
  };

  Object.entries(navBtns).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === viewName) {
      btn.className = 'nav-tab px-4 py-2 text-xs font-headline font-bold rounded-lg transition-all bg-primary-container text-on-primary shadow-sm flex items-center gap-1.5';
    } else {
      btn.className = 'nav-tab px-4 py-2 text-xs font-headline font-semibold rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all flex items-center gap-1.5';
    }
  });

  if (viewName === 'map') {
    setTimeout(() => map.invalidateSize(), 200);
  } else if (viewName === 'detail') {
    renderDetailView();
  } else if (viewName === 'basecamp') {
    renderBasecampTable();
  }
}

/**
 * 12. Detail Pos & Jalur Table View (Berpasangan dengan Gunung & Jalur)
 */
function renderDetailView() {
  const m = selectedMountain || allMountains[0];
  if (!m) return;

  document.getElementById('detail-gunung-name').innerText = m.nama;
  document.getElementById('detail-gunung-prov').innerText = `${m.provinsi} · ${m.kabupaten}`;

  if (selectedBasecamp) {
    const activeWps = getExpeditionWaypoints(m, selectedBasecamp);
    const activeSummary = calculateTrailSegments(activeWps);
    document.getElementById('detail-gunung-desc').innerText = 
      `Jalur Terpilih: Basecamp ${selectedBasecamp.nama} ➔ Puncak ${m.nama} (${m.ketinggian.toLocaleString('id-ID')} MDPL) · Jarak: ${activeSummary.totalDistanceFormatted} (BC ➔ Puncak) · Jumlah: ${selectedBasecamp.pos.length} Pos Terdata.`;
  } else {
    document.getElementById('detail-gunung-desc').innerText = 
      `Ketinggian ${m.ketinggian.toLocaleString('id-ID')} MDPL · Titik pos resmi dipasangkan dengan jalur pendakian.`;
  }

  // Gunung Selector dropdown
  const gunungSelect = document.getElementById('detail-gunung-select');
  if (gunungSelect) {
    gunungSelect.innerHTML = allMountains.map(g => `
      <option value="${g.id}" ${g.id === m.id ? 'selected' : ''}>${g.nama} (${g.provinsi})</option>
    `).join('');
  }

  // Jalur Selector dropdown dengan Jarak KM dan Pos
  const jalurSelect = document.getElementById('detail-jalur-select');
  if (jalurSelect) {
    let optionsHtml = m.basecamps.map(b => {
      const bWaypoints = getExpeditionWaypoints(m, b);
      const bSummary = calculateTrailSegments(bWaypoints);
      return `
        <option value="${b.id}" ${selectedBasecamp && selectedBasecamp.id === b.id ? 'selected' : ''}>
          Via ${b.jalurVia} · ${bSummary.totalDistanceFormatted} (${b.pos.length} Pos)
        </option>
      `;
    }).join('');
    optionsHtml += `<option value="all">Tampilkan Semua Jalur (${m.basecamps.length} Jalur)</option>`;
    jalurSelect.innerHTML = optionsHtml;
  }

  filterPosTable();
}

function changeDetailGunung(gunungId) {
  const m = allMountains.find(item => item.id === parseInt(gunungId, 10));
  if (!m) return;

  selectedMountain = m;
  const bcId = selectedJalurByMountain[m.id];
  selectedBasecamp = bcId ? (m.basecamps.find(b => b.id === bcId) || m.basecamps[0]) : (m.basecamps[0] || null);
  if (selectedBasecamp) selectedJalurByMountain[m.id] = selectedBasecamp.id;

  renderDetailView();
  if (selectedBasecamp) {
    drawMountainTrail(m, selectedBasecamp);
    updateInspectorPanel(m, selectedBasecamp);
    updateMapTrailSummary(m, selectedBasecamp);
  }
}

function changeDetailJalur(basecampId) {
  const m = selectedMountain;
  if (!m) return;

  if (basecampId === 'all') {
    selectedBasecamp = null;
  } else {
    selectedBasecamp = m.basecamps.find(b => b.id === parseInt(basecampId, 10)) || null;
    if (selectedBasecamp) {
      selectedJalurByMountain[m.id] = selectedBasecamp.id;
    }
  }

  filterPosTable();

  if (selectedBasecamp) {
    drawMountainTrail(m, selectedBasecamp);
    updateInspectorPanel(m, selectedBasecamp);
    updateMapTrailSummary(m, selectedBasecamp);
  }
}

function toggleAllPosMode(checked) {
  showAllPosMode = checked;
  filterPosTable();
  showToast(checked ? 'Menampilkan seluruh pos se-Pulau Jawa berpasangan' : 'Menampilkan pos gunung aktif', 'info');
}

function filterPosTable() {
  const tbody = document.getElementById('detail-pos-tbody');
  if (!tbody) return;

  const q = (document.getElementById('pos-table-search')?.value || '').toLowerCase().trim();

  let posList = [];

  if (showAllPosMode) {
    // Collect all pos across all mountains
    allMountains.forEach(m => {
      m.basecamps.forEach(b => {
        b.pos.forEach(p => {
          posList.push({
            ...p,
            gunungId: m.id,
            gunungNama: m.nama,
            provinsi: m.provinsi,
            kabupaten: m.kabupaten,
            jalurVia: b.jalurVia,
            basecampNama: b.nama
          });
        });
      });
    });
  } else {
    const m = selectedMountain || allMountains[0];
    if (m) {
      const bcs = selectedBasecamp ? [selectedBasecamp] : m.basecamps;
      bcs.forEach(b => {
        b.pos.forEach(p => {
          posList.push({
            ...p,
            gunungId: m.id,
            gunungNama: m.nama,
            provinsi: m.provinsi,
            kabupaten: m.kabupaten,
            jalurVia: b.jalurVia,
            basecampNama: b.nama
          });
        });
      });
    }
  }

  // Apply search query
  if (q !== '') {
    posList = posList.filter(p => {
      const matchName = p.namaPos.toLowerCase().includes(q);
      const matchGunung = p.gunungNama.toLowerCase().includes(q);
      const matchVia = p.jalurVia.toLowerCase().includes(q);
      const matchUrutan = String(p.urutan).includes(q);
      const matchElev = p.elevasi ? String(p.elevasi).includes(q) : false;
      return matchName || matchGunung || matchVia || matchUrutan || matchElev;
    });
  }

  renderPosTable(posList);
}

function renderPosTable(posList) {
  const tbody = document.getElementById('detail-pos-tbody');
  const badge = document.getElementById('detail-total-pos-badge');
  if (!tbody) return;

  if (badge) badge.innerText = `${posList.length} Pos Terdaftar`;

  if (posList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-outline">Tidak ada titik pos yang sesuai filter pencarian.</td></tr>`;
    return;
  }

  tbody.innerHTML = posList.map((p, idx) => `
    <tr class="hover:bg-surface-container-low transition-colors">
      <td class="py-3 px-4">
        <strong class="font-headline font-bold text-primary block">${p.gunungNama}</strong>
        <span class="text-[10px] text-on-surface-variant">${p.provinsi} · ${p.kabupaten}</span>
      </td>
      <td class="py-3 px-4">
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-headline font-bold text-[10px]">
          <span class="material-symbols-outlined text-[12px]">alt_route</span>
          Via ${p.jalurVia}
        </span>
        <span class="block text-[10px] text-on-surface-variant font-mono mt-0.5 truncate max-w-[130px]">${p.basecampNama}</span>
      </td>
      <td class="py-3 px-4 font-headline font-bold text-primary">#${p.urutan || idx + 1}</td>
      <td class="py-3 px-4">
        <span class="font-headline font-bold text-on-surface block">${p.namaPos}</span>
        ${p.keterangan ? `<span class="block text-[11px] font-normal text-on-surface-variant">${p.keterangan}</span>` : ''}
      </td>
      <td class="py-3 px-4 font-mono font-bold text-on-surface">${p.elevasi ? p.elevasi.toLocaleString('id-ID') + ' m' : '-'}</td>
      <td class="py-3 px-4 font-mono text-[11px] text-outline">${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</td>
      <td class="py-3 px-4">
        ${p.areaCamp 
          ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-headline font-bold text-[10px]"><span class="material-symbols-outlined text-[12px]">cabin</span> Cocok</span>' 
          : '<span class="text-outline text-[11px]">Terjal</span>'}
      </td>
      <td class="py-3 px-4 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="focusPosOnMap(${p.latitude}, ${p.longitude}, '${p.namaPos}')" class="p-1.5 rounded-lg bg-surface-container hover:bg-primary hover:text-white text-primary transition-colors" title="Lihat di Peta">
            <span class="material-symbols-outlined text-[16px]">visibility</span>
          </button>
          <button onclick="openPosModal(${p.id}, ${p.basecampId})" class="p-1.5 rounded-lg bg-surface-container hover:bg-secondary hover:text-white text-secondary transition-colors" title="Rename / Edit Pos">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="deletePosItem(${p.id}, '${p.namaPos}')" class="p-1.5 rounded-lg bg-surface-container hover:bg-error hover:text-white text-error transition-colors" title="Hapus Pos">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openDetailViewForActive() {
  switchView('detail');
}

function focusPosOnMap(lat, lng, name) {
  switchView('map');
  setTimeout(() => {
    map.flyTo([lat, lng], 15, { duration: 1 });
    showToast(`Fokus ke ${name}`, 'info');
  }, 250);
}

/**
 * 13. Basecamp Directory CRUD Table
 */
async function loadBasecamps() {
  try {
    const res = await fetch('/api/basecamp');
    const json = await res.json();
    if (json.success) {
      allBasecamps = json.data;
    }
  } catch (err) {
    console.error('Gagal memuat basecamp:', err);
  }
}

function renderBasecampTable() {
  const tbody = document.getElementById('basecamp-table-body');
  if (!tbody) return;

  filterBasecampTable();
}

function filterBasecampTable() {
  const tbody = document.getElementById('basecamp-table-body');
  if (!tbody) return;

  const q = (document.getElementById('basecamp-table-search')?.value || '').toLowerCase();
  const prov = document.getElementById('basecamp-filter-prov')?.value || 'all';
  const status = document.getElementById('basecamp-filter-status')?.value || 'all';

  const filtered = allBasecamps.filter(b => {
    if (prov === 'jabar' && !b.provinsi.toLowerCase().includes('barat')) return false;
    if (prov === 'jateng' && !b.provinsi.toLowerCase().includes('tengah')) return false;
    if (prov === 'diy' && !b.provinsi.toLowerCase().includes('diy')) return false;
    if (prov === 'jatim' && !b.provinsi.toLowerCase().includes('timur')) return false;

    if (status !== 'all' && b.status !== status) return false;

    if (q.trim() !== '') {
      const matchName = b.nama.toLowerCase().includes(q);
      const matchVia = b.jalurVia.toLowerCase().includes(q);
      const matchGunung = b.gunungNama.toLowerCase().includes(q);
      if (!matchName && !matchVia && !matchGunung) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-outline">Tidak ada basecamp yang cocok dengan filter pencarian.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(b => `
    <tr class="hover:bg-surface-container-low transition-colors">
      <td class="py-3 px-4">
        <strong class="font-headline font-bold text-on-surface block">${b.nama}</strong>
        <span class="text-[11px] text-on-surface-variant">Via ${b.jalurVia}</span>
      </td>
      <td class="py-3 px-4 font-headline font-bold text-primary">${b.gunungNama}</td>
      <td class="py-3 px-4 text-on-surface-variant">${b.provinsi} · ${b.kabupaten}</td>
      <td class="py-3 px-4 font-headline font-bold text-on-surface">${b.totalPos} Pos</td>
      <td class="py-3 px-4 font-mono text-[11px] text-outline">${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}</td>
      <td class="py-3 px-4">
        <span class="px-2 py-0.5 rounded-full font-headline text-[10px] font-bold ${b.status === 'Buka' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : b.status === 'Waspada' ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-error-container text-on-error-container'}">
          ${b.status}
        </span>
      </td>
      <td class="py-3 px-4 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="viewBasecampOnMap(${b.gunungId}, ${b.id})" class="p-1.5 rounded-lg bg-surface-container hover:bg-secondary hover:text-white transition-colors" title="Visualisasikan Jalur BC ke Puncak di Peta">
            <span class="material-symbols-outlined text-[16px]">alt_route</span>
          </button>
          <button onclick="editBasecamp(${b.id})" class="p-1.5 rounded-lg bg-surface-container hover:bg-primary hover:text-white transition-colors" title="Edit Basecamp">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="deleteBasecampItem(${b.id})" class="p-1.5 rounded-lg bg-surface-container hover:bg-error hover:text-white transition-colors" title="Hapus Basecamp">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function viewBasecampOnMap(gunungId, basecampId) {
  switchView('map');
  setTimeout(() => {
    switchJalur(gunungId, basecampId);
  }, 250);
}

/**
 * 14. Basecamp Modal (Create & Edit)
 */
function openBasecampModal(editId = null) {
  const modal = document.getElementById('basecamp-modal');
  const selectGunung = document.getElementById('form-bc-gunung');
  
  selectGunung.innerHTML = allMountains.map(m => `
    <option value="${m.id}">${m.nama} (${m.provinsi})</option>
  `).join('');

  if (editId) {
    const b = allBasecamps.find(item => item.id === editId);
    if (b) {
      document.getElementById('modal-basecamp-title').innerText = 'Edit Data Basecamp';
      document.getElementById('form-bc-id').value = b.id;
      selectGunung.value = b.gunungId;
      document.getElementById('form-bc-nama').value = b.nama;
      document.getElementById('form-bc-jalur').value = b.jalurVia;
      document.getElementById('form-bc-lat').value = b.latitude;
      document.getElementById('form-bc-lng').value = b.longitude;
      document.getElementById('form-bc-elevasi').value = b.elevasi || 1800;
      document.getElementById('form-bc-status').value = b.status || 'Buka';
      document.getElementById('form-bc-kontak').value = b.kontak || '';
    }
  } else {
    document.getElementById('modal-basecamp-title').innerText = 'Tambah Basecamp Baru';
    document.getElementById('basecamp-form').reset();
    document.getElementById('form-bc-id').value = '';
    if (selectedMountain) {
      selectGunung.value = selectedMountain.id;
    }
  }

  modal.classList.remove('hidden');
}

function closeBasecampModal() {
  document.getElementById('basecamp-modal')?.classList.add('hidden');
}

function enableMapCoordPicker() {
  closeBasecampModal();
  isPickingCoordinates = true;
  activeCoordTarget = 'basecamp_modal';
  switchView('map');
  showToast('Silakan KLIK pada peta untuk menentukan titik koordinat Basecamp', 'info');
}

function editBasecamp(id) {
  openBasecampModal(id);
}

async function submitBasecampForm(e) {
  e.preventDefault();
  const id = document.getElementById('form-bc-id').value;
  const payload = {
    gunungId: parseInt(document.getElementById('form-bc-gunung').value, 10),
    nama: document.getElementById('form-bc-nama').value,
    jalurVia: document.getElementById('form-bc-jalur').value,
    latitude: parseFloat(document.getElementById('form-bc-lat').value),
    longitude: parseFloat(document.getElementById('form-bc-lng').value),
    elevasi: parseInt(document.getElementById('form-bc-elevasi').value, 10) || 1800,
    status: document.getElementById('form-bc-status').value,
    kontak: document.getElementById('form-bc-kontak').value
  };

  try {
    const url = id ? `/api/basecamp/${id}` : '/api/basecamp';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      closeBasecampModal();
      await loadMountains();
      await loadBasecamps();
      renderBasecampTable();
    } else {
      showToast(json.message || 'Terjadi kesalahan', 'error');
    }
  } catch (err) {
    showToast('Gagal menyimpan data basecamp: ' + err.message, 'error');
  }
}

async function deleteBasecampItem(id) {
  const b = allBasecamps.find(item => item.id === id);
  if (!b) return;

  if (!confirm(`Apakah Anda yakin ingin menghapus ${b.nama}? Semua pos di jalur ini juga akan terhapus.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/basecamp/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      await loadMountains();
      await loadBasecamps();
      renderBasecampTable();
    } else {
      showToast(json.message || 'Gagal menghapus', 'error');
    }
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, 'error');
  }
}

/**
 * 14B. Admin: Kelola & Rename Data Gunung (CRUD)
 */
function openGunungModal(id = null) {
  const modal = document.getElementById('gunung-modal');
  if (!modal) return;

  const btnDelete = document.getElementById('btn-delete-gunung');
  const modalTitle = document.getElementById('modal-gunung-title');

  if (id) {
    const m = allMountains.find(item => item.id === id);
    if (m) {
      modalTitle.innerText = `Rename & Edit: ${m.nama}`;
      document.getElementById('form-gunung-id').value = m.id;
      document.getElementById('form-gunung-nama').value = m.nama;
      document.getElementById('form-gunung-ketinggian').value = m.ketinggian;
      document.getElementById('form-gunung-provinsi').value = m.provinsi;
      document.getElementById('form-gunung-kabupaten').value = m.kabupaten;
      document.getElementById('form-gunung-status').value = m.statusJalur || 'Buka';
      document.getElementById('form-gunung-tipe').value = m.tipeGunung || 'Pegunungan Jawa';
      document.getElementById('form-gunung-deskripsi').value = m.deskripsi || '';
      document.getElementById('form-gunung-lat').value = m.latitude || '';
      document.getElementById('form-gunung-lng').value = m.longitude || '';
      btnDelete?.classList.remove('hidden');
    }
  } else {
    modalTitle.innerText = 'Tambah Data Gunung Baru';
    document.getElementById('gunung-form').reset();
    document.getElementById('form-gunung-id').value = '';
    btnDelete?.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function closeGunungModal() {
  document.getElementById('gunung-modal')?.classList.add('hidden');
}

function enableGunungCoordPicker() {
  closeGunungModal();
  isPickingCoordinates = true;
  activeCoordTarget = 'gunung_modal';
  switchView('map');
  showToast('Silakan KLIK pada peta untuk menentukan koordinat Puncak Gunung ini', 'info');
}

async function submitGunungForm(e) {
  e.preventDefault();
  const id = document.getElementById('form-gunung-id').value;
  const payload = {
    nama: document.getElementById('form-gunung-nama').value,
    ketinggian: parseInt(document.getElementById('form-gunung-ketinggian').value, 10),
    provinsi: document.getElementById('form-gunung-provinsi').value,
    kabupaten: document.getElementById('form-gunung-kabupaten').value,
    statusJalur: document.getElementById('form-gunung-status').value,
    tipeGunung: document.getElementById('form-gunung-tipe').value,
    deskripsi: document.getElementById('form-gunung-deskripsi').value,
    latitude: parseFloat(document.getElementById('form-gunung-lat').value) || undefined,
    longitude: parseFloat(document.getElementById('form-gunung-lng').value) || undefined
  };

  try {
    const url = id ? `/api/gunung/${id}` : '/api/gunung';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      closeGunungModal();
      await loadMountains();
      await loadStatistics();
      if (selectedMountain && selectedMountain.id === parseInt(id, 10)) {
        selectedMountain = allMountains.find(item => item.id === parseInt(id, 10)) || selectedMountain;
        if (selectedBasecamp) {
          updateInspectorPanel(selectedMountain, selectedBasecamp);
        }
      }
      if (document.getElementById('view-detail').classList.contains('hidden') === false) {
        renderDetailView();
      }
    } else {
      showToast(json.message || 'Gagal menyimpan perubahan', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
}

async function deleteActiveGunung() {
  const id = document.getElementById('form-gunung-id').value;
  if (!id) return;

  const m = allMountains.find(item => item.id === parseInt(id, 10));
  if (!m) return;

  if (!confirm(`Hapus seluruh data gunung ${m.nama}? Semua basecamp dan pos di gunung ini akan ikut terhapus.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/gunung/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      closeGunungModal();
      await loadMountains();
      await loadStatistics();
      if (allMountains.length > 0) {
        selectMountain(allMountains[0].id, true);
      }
    } else {
      showToast(json.message || 'Gagal menghapus', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

/**
 * 14C. Admin: Kelola & Rename Titik Pos Pendakian (CRUD)
 */
function openPosModal(posId = null, basecampId = null) {
  const modal = document.getElementById('pos-modal');
  if (!modal) return;

  const m = selectedMountain || allMountains[0];
  if (!m) return;

  const bcSelect = document.getElementById('form-pos-bc-select');
  bcSelect.innerHTML = m.basecamps.map(b => `
    <option value="${b.id}" ${(basecampId && b.id === basecampId) || (selectedBasecamp && selectedBasecamp.id === b.id) ? 'selected' : ''}>
      ${m.nama} - Via ${b.jalurVia}
    </option>
  `).join('');

  const btnDelete = document.getElementById('btn-delete-pos');
  const parentBadge = document.getElementById('modal-pos-parent-badge');

  if (posId) {
    let targetPos = null;
    let parentBc = null;
    for (const g of allMountains) {
      for (const b of g.basecamps) {
        const found = b.pos.find(p => p.id === posId);
        if (found) {
          targetPos = found;
          parentBc = b;
          break;
        }
      }
      if (targetPos) break;
    }

    if (targetPos) {
      document.getElementById('modal-pos-title').innerText = `Rename / Edit: ${targetPos.namaPos}`;
      parentBadge.innerText = `${m.nama} · Via ${parentBc.jalurVia}`;
      document.getElementById('form-pos-id').value = targetPos.id;
      document.getElementById('form-pos-bc-id').value = targetPos.basecampId;
      bcSelect.value = targetPos.basecampId;
      document.getElementById('form-pos-nama').value = targetPos.namaPos;
      document.getElementById('form-pos-urutan').value = targetPos.urutan || 1;
      document.getElementById('form-pos-elevasi').value = targetPos.elevasi || '';
      document.getElementById('form-pos-lat').value = targetPos.latitude;
      document.getElementById('form-pos-lng').value = targetPos.longitude;
      document.getElementById('form-pos-camp').checked = !!targetPos.areaCamp;
      document.getElementById('form-pos-keterangan').value = targetPos.keterangan || '';
      btnDelete?.classList.remove('hidden');
    }
  } else {
    document.getElementById('modal-pos-title').innerText = 'Tambah Pos Baru';
    parentBadge.innerText = `${m.nama} · Via ${selectedBasecamp?.jalurVia || 'Utama'}`;
    document.getElementById('pos-form').reset();
    document.getElementById('form-pos-id').value = '';
    const currentBc = selectedBasecamp || m.basecamps[0];
    if (currentBc) {
      document.getElementById('form-pos-bc-id').value = currentBc.id;
      bcSelect.value = currentBc.id;
      document.getElementById('form-pos-urutan').value = currentBc.pos.length + 1;
      document.getElementById('form-pos-lat').value = (currentBc.latitude + 0.005).toFixed(5);
      document.getElementById('form-pos-lng').value = (currentBc.longitude + 0.005).toFixed(5);
    }
    btnDelete?.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function closePosModal() {
  document.getElementById('pos-modal')?.classList.add('hidden');
}

function enablePosCoordPicker() {
  closePosModal();
  isPickingCoordinates = true;
  activeCoordTarget = 'pos_modal';
  switchView('map');
  showToast('Silakan KLIK pada peta untuk menentukan koordinat Pos ini', 'info');
}

async function submitPosForm(e) {
  e.preventDefault();
  const id = document.getElementById('form-pos-id').value;
  const basecampId = parseInt(document.getElementById('form-pos-bc-select').value, 10);

  const payload = {
    basecampId,
    namaPos: document.getElementById('form-pos-nama').value,
    urutan: parseInt(document.getElementById('form-pos-urutan').value, 10) || 1,
    elevasi: parseInt(document.getElementById('form-pos-elevasi').value, 10) || null,
    latitude: parseFloat(document.getElementById('form-pos-lat').value),
    longitude: parseFloat(document.getElementById('form-pos-lng').value),
    areaCamp: document.getElementById('form-pos-camp').checked,
    keterangan: document.getElementById('form-pos-keterangan').value
  };

  try {
    const url = id ? `/api/pos/${id}` : '/api/pos';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      closePosModal();
      await loadMountains();
      if (selectedMountain) {
        selectedMountain = allMountains.find(item => item.id === selectedMountain.id) || selectedMountain;
        if (selectedBasecamp) {
          selectedBasecamp = selectedMountain.basecamps.find(b => b.id === selectedBasecamp.id) || selectedMountain.basecamps[0];
          drawMountainTrail(selectedMountain, selectedBasecamp);
          updateInspectorPanel(selectedMountain, selectedBasecamp);
        }
      }
      renderDetailView();
    } else {
      showToast(json.message || 'Gagal menyimpan data pos', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
}

async function deleteActivePos() {
  const id = document.getElementById('form-pos-id').value;
  if (!id) return;
  const name = document.getElementById('form-pos-nama').value;
  await deletePosItem(parseInt(id, 10), name);
  closePosModal();
}

async function deletePosItem(id, nama) {
  if (!confirm(`Hapus titik pos "${nama}"?`)) return;

  try {
    const res = await fetch(`/api/pos/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      await loadMountains();
      if (selectedMountain) {
        selectedMountain = allMountains.find(item => item.id === selectedMountain.id) || selectedMountain;
        if (selectedBasecamp) {
          selectedBasecamp = selectedMountain.basecamps.find(b => b.id === selectedBasecamp.id) || selectedMountain.basecamps[0];
          drawMountainTrail(selectedMountain, selectedBasecamp);
        }
      }
      renderDetailView();
    } else {
      showToast(json.message || 'Gagal menghapus pos', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

/**
 * 14D. Live Tracking Engine (Real GPS + Demo Simulation)
 */
function toggleLiveTrackingHUD() {
  const hud = document.getElementById('live-tracking-hud');
  if (!hud) return;

  if (hud.classList.contains('hidden')) {
    openLiveTrackingHUD();
  } else {
    closeLiveTrackingHUD();
  }
}

function openLiveTrackingHUD() {
  const hud = document.getElementById('live-tracking-hud');
  if (!hud) return;

  hud.classList.remove('hidden');
  switchView('map');
  showToast('HUD Live Tracking dibuka. Pilih GPS Asli atau Simulasi Jalur.', 'info');
}

function closeLiveTrackingHUD() {
  document.getElementById('live-tracking-hud')?.classList.add('hidden');
}

function toggleTrackingLock() {
  isTrackingLocked = !isTrackingLocked;
  const btn = document.getElementById('hud-btn-lock');
  if (btn) {
    btn.className = isTrackingLocked 
      ? 'p-1 rounded-lg text-primary hover:bg-surface-container transition-colors' 
      : 'p-1 rounded-lg text-outline hover:bg-surface-container transition-colors';
  }
  showToast(isTrackingLocked ? 'Kamera peta mengikuti posisi hiker' : 'Kamera peta bebas', 'info');
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

function formatDuration(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startRealGpsTracking() {
  const m = selectedMountain || allMountains[0];
  const bc = selectedBasecamp || m?.basecamps[0];

  if (!m || !bc) {
    showToast('Pilih gunung dan jalur via terlebih dahulu', 'warning');
    return;
  }

  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung pada browser Anda', 'error');
    return;
  }

  resetTrackingState();
  isLiveTracking = true;
  trackingMode = 'real';

  openLiveTrackingHUD();
  updateHUDUIActive(`Merekam GPS: ${m.nama} via ${bc.jalurVia}`);

  // Inisialisasi posisi berdiri awal pendaki di Basecamp
  currentUserCoords = [bc.latitude, bc.longitude];
  handleLivePositionUpdate(bc.latitude, bc.longitude, bc.elevasi || 1500, 0);

  trackingTimerInterval = setInterval(() => {
    if (!isTrackingPaused) {
      trackingSeconds++;
      document.getElementById('hud-timer').innerText = formatDuration(trackingSeconds);
    }
  }, 1000);

  trackingWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (isTrackingPaused) return;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const distFromBc = calculateHaversineMeters(lat, lng, bc.latitude, bc.longitude);

      // Jika user berada di sekitar basecamp/gunung (< 5 km), gunakan koordinat fisik
      if (distFromBc < 5000) {
        const alt = pos.coords.altitude || estimateElevationFromNearestPos(lat, lng);
        const speed = pos.coords.speed || 0.8;
        handleLivePositionUpdate(lat, lng, alt, speed);
      } else {
        // Jika user berada jauh (misalnya di rumah di kota lain):
        // Hindari menarik garis jauh dari rumah ke basecamp!
        // Alihkan tracking ekspedisi mulai berdiri di Basecamp menuju puncak.
        showToast(`📍 Posisi GPS Anda berada di luar area gunung (${Math.round(distFromBc / 1000)} km). Pelacakan diset mulai dari posisi berdiri di Basecamp ${bc.nama} (${bc.elevasi} mdpl)!`, 'info');
        stopRealGpsWatch();
        startSimulatedTracking();
      }
    },
    (err) => {
      console.warn('GPS error:', err);
      showToast('Sinyal GPS fisik lemah. Beralih ke pelacakan jalur dari Basecamp.', 'warning');
      stopRealGpsWatch();
      startSimulatedTracking();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );

  showToast(`Live Tracking GPS Aktif! Berangkat dari Basecamp ${bc.nama}.`, 'success');
}

function stopRealGpsWatch() {
  if (trackingWatchId !== null) {
    navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
  }
}

function startSimulatedTracking() {
  const m = selectedMountain || allMountains[0];
  const bc = selectedBasecamp || m?.basecamps[0];

  if (!m || !bc) {
    showToast('Pilih gunung dan jalur dengan data pos terlebih dahulu', 'error');
    return;
  }

  resetTrackingState();
  isLiveTracking = true;
  trackingMode = 'sim';

  openLiveTrackingHUD();
  updateHUDUIActive(`Mendaki: ${m.nama} via ${bc.jalurVia}`);

  // Mengambil lintasan urutan resmi dari Posisi Berdiri di Basecamp -> Pos 1 -> Pos 2 -> ... -> Puncak
  const keypoints = getExpeditionWaypoints(m, bc);

  if (keypoints.length < 2) {
    showToast('Jalur ini belum memiliki data pos untuk tracking', 'warning');
    return;
  }

  // Bangun lintasan halus (smooth trail) antar segmen dari Basecamp ke Puncak
  const smoothTrail = [];
  const stepsPerSegment = 10;
  for (let i = 0; i < keypoints.length - 1; i++) {
    const p1 = keypoints[i];
    const p2 = keypoints[i + 1];
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      smoothTrail.push({
        lat: p1.lat + (p2.lat - p1.lat) * t,
        lng: p1.lng + (p2.lng - p1.lng) * t,
        elev: Math.round(p1.elev + (p2.elev - p1.elev) * t),
        fromName: p1.name,
        targetName: p2.name,
        targetType: p2.type
      });
    }
  }
  const lastKp = keypoints[keypoints.length - 1];
  smoothTrail.push({
    lat: lastKp.lat,
    lng: lastKp.lng,
    elev: lastKp.elev,
    fromName: keypoints[keypoints.length - 2]?.name || bc.nama,
    targetName: lastKp.name,
    targetType: lastKp.type
  });

  simWaypointIndex = 0;

  // Inisialisasi posisi awal pendaki di Basecamp
  const startPt = smoothTrail[0];
  handleLivePositionUpdate(startPt.lat, startPt.lng, startPt.elev, 0);

  trackingTimerInterval = setInterval(() => {
    if (!isTrackingPaused) {
      trackingSeconds++;
      document.getElementById('hud-timer').innerText = formatDuration(trackingSeconds);
    }
  }, 1000);

  simInterval = setInterval(() => {
    if (isTrackingPaused) return;

    if (simWaypointIndex >= smoothTrail.length) {
      clearInterval(simInterval);
      showToast(`🎉 Ekspedisi Selesai! Pendaki tiba di ${lastKp.name} (${lastKp.elev} mdpl).`, 'success');
      document.getElementById('hud-status-text').innerText = `Tiba di Puncak ${m.nama} (Selesai)`;
      return;
    }

    const currentPt = smoothTrail[simWaypointIndex];
    const speed = 0.85 + (Math.sin(simWaypointIndex) * 0.25); // ~2.8 - 3.8 km/jam langkah kaki
    handleLivePositionUpdate(currentPt.lat, currentPt.lng, currentPt.elev, speed);

    // Update status arah rute aktif di HUD
    if (currentPt.targetType === 'summit') {
      document.getElementById('hud-status-text').innerText = `Menuju Puncak (${lastKp.elev} mdpl)`;
    } else {
      document.getElementById('hud-status-text').innerText = `Menuju ${currentPt.targetName}`;
    }

    simWaypointIndex++;
  }, 800);

  showToast(`Ekspedisi dimulai! Posisi awal pendaki berdiri di Basecamp ${bc.nama}.`, 'success');
}

function handleLivePositionUpdate(lat, lng, altitude, speedMps) {
  const coord = [lat, lng];

  if (trackingBreadcrumbs.length > 0) {
    const last = trackingBreadcrumbs[trackingBreadcrumbs.length - 1];
    const dist = calculateHaversineMeters(last[0], last[1], lat, lng);
    if (dist < 1000) {
      trackingTotalDistance += dist;
    }
  }

  trackingBreadcrumbs.push(coord);

  document.getElementById('hud-distance').innerText = `${(trackingTotalDistance / 1000).toFixed(2)} km`;
  document.getElementById('hud-elevation').innerText = `${Math.round(altitude)} mdpl`;
  document.getElementById('hud-speed').innerText = `${(speedMps * 3.6).toFixed(1)} km/h`;
  document.getElementById('hud-coords').innerText = `${Math.abs(lng).toFixed(5)}° E, ${Math.abs(lat).toFixed(5)}° S`;

  const nearest = findNearestPosOnTrack(lat, lng);
  if (nearest) {
    document.getElementById('hud-nearest-pos').innerText = `${nearest.name} (${Math.round(nearest.dist)} m)`;
  }

  if (!trackingBreadcrumbPolyline) {
    trackingBreadcrumbPolyline = L.polyline(trackingBreadcrumbs, {
      color: '#00E676',
      weight: 5,
      opacity: 0.95,
      className: 'live-breadcrumb-trail'
    }).addTo(map);
  } else {
    trackingBreadcrumbPolyline.setLatLngs(trackingBreadcrumbs);
  }

  if (!liveTrackerMarker) {
    const markerHtml = `
      <div class="live-tracker-icon">
        <div class="live-tracker-pulse"></div>
        <div class="live-tracker-dot"></div>
      </div>
    `;
    const iconObj = L.divIcon({
      html: markerHtml,
      className: 'empty-icon',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    liveTrackerMarker = L.marker(coord, { icon: iconObj, zIndexOffset: 10000 }).addTo(map);
  } else {
    liveTrackerMarker.setLatLng(coord);
  }

  if (isTrackingLocked) {
    map.panTo(coord, { animate: true, duration: 0.5 });
  }
}

function findNearestPosOnTrack(lat, lng) {
  const m = selectedMountain;
  if (!m) return null;
  const bc = selectedBasecamp || m.basecamps[0];
  if (!bc || !bc.pos) return null;

  let nearest = null;
  let minDist = Infinity;

  bc.pos.forEach(p => {
    const d = calculateHaversineMeters(lat, lng, p.latitude, p.longitude);
    if (d < minDist) {
      minDist = d;
      nearest = { name: p.namaPos, dist: d };
    }
  });

  return nearest;
}

function estimateElevationFromNearestPos(lat, lng) {
  const m = selectedMountain;
  if (!m) return 2000;
  return m.ketinggian ? Math.round(m.ketinggian * 0.75) : 2000;
}

function updateHUDUIActive(statusText) {
  document.getElementById('hud-idle-controls')?.classList.add('hidden');
  document.getElementById('hud-active-controls')?.classList.remove('hidden');
  document.getElementById('hud-ping')?.classList.remove('hidden');
  document.getElementById('hud-dot')?.classList.add('bg-emerald-500');
  document.getElementById('hud-dot')?.classList.remove('bg-outline');
  document.getElementById('hud-status-text').innerText = statusText;

  document.getElementById('topbar-track-ping')?.classList.remove('hidden');
  document.getElementById('topbar-track-dot')?.classList.add('bg-emerald-500');
}

function resetTrackingState() {
  if (trackingWatchId !== null) {
    navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
  }
  if (trackingTimerInterval) {
    clearInterval(trackingTimerInterval);
    trackingTimerInterval = null;
  }
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }

  trackingSeconds = 0;
  trackingTotalDistance = 0;
  trackingBreadcrumbs = [];
  isTrackingPaused = false;

  if (trackingBreadcrumbPolyline) {
    map.removeLayer(trackingBreadcrumbPolyline);
    trackingBreadcrumbPolyline = null;
  }
  if (liveTrackerMarker) {
    map.removeLayer(liveTrackerMarker);
    liveTrackerMarker = null;
  }

  document.getElementById('hud-timer').innerText = '00:00:00';
  document.getElementById('hud-distance').innerText = '0.00 km';
  document.getElementById('hud-elevation').innerText = '-- mdpl';
  document.getElementById('hud-speed').innerText = '0.0 km/h';
}

function togglePauseTracking() {
  isTrackingPaused = !isTrackingPaused;
  const icon = document.getElementById('hud-pause-icon');
  const text = document.getElementById('hud-pause-text');
  if (isTrackingPaused) {
    icon.innerText = 'play_arrow';
    text.innerText = 'Lanjut';
    document.getElementById('hud-status-text').innerText = 'Tracking Dijeda';
    showToast('Live Tracking dijeda', 'info');
  } else {
    icon.innerText = 'pause';
    text.innerText = 'Jeda';
    document.getElementById('hud-status-text').innerText = 'Tracking Berjalan...';
    showToast('Live Tracking dilanjutkan', 'info');
  }
}

function stopTracking() {
  if (!isLiveTracking) return;

  const totalDistKm = (trackingTotalDistance / 1000).toFixed(2);
  const totalTimeStr = formatDuration(trackingSeconds);

  if (trackingWatchId !== null) {
    navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
  }
  if (trackingTimerInterval) {
    clearInterval(trackingTimerInterval);
    trackingTimerInterval = null;
  }
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }

  isLiveTracking = false;
  trackingMode = 'idle';

  document.getElementById('hud-idle-controls')?.classList.remove('hidden');
  document.getElementById('hud-active-controls')?.classList.add('hidden');
  document.getElementById('hud-ping')?.classList.add('hidden');
  document.getElementById('hud-dot')?.classList.remove('bg-emerald-500');
  document.getElementById('hud-dot')?.classList.add('bg-outline');
  document.getElementById('hud-status-text').innerText = 'Siaga (Standby)';

  document.getElementById('topbar-track-ping')?.classList.add('hidden');
  document.getElementById('topbar-track-dot')?.classList.remove('bg-emerald-500');

  showToast(`Selesai! Jarak: ${totalDistKm} km | Waktu: ${totalTimeStr}`, 'success');
}

function exportLiveTrackGpx() {
  if (trackingBreadcrumbs.length === 0) {
    showToast('Belum ada riwayat jejak tracking untuk diekspor', 'warning');
    return;
  }

  const mName = selectedMountain?.nama || 'Ekspedisi-Jawa';
  const gpxPoints = trackingBreadcrumbs.map((pt, idx) => 
    `      <trkpt lat="${pt[0]}" lon="${pt[1]}"><time>${new Date(Date.now() - (trackingBreadcrumbs.length - idx) * 1000).toISOString()}</time></trkpt>`
  ).join('\n');

  const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KANIMAP Live Tracker" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Live Track ${mName}</name>
    <desc>Rekaman jejak GPS asli KANIMAP Expedition System</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>Jalur Tracking ${mName}</name>
    <trkseg>
${gpxPoints}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-track-${mName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('File GPX hasil tracking berhasil diunduh!', 'success');
}

/**
 * 15. Panduan Arah Rute Pendakian (Basecamp -> Pos 1 -> Pos 2 -> Puncak)
 * Menyesuaikan arah rute resmi dari titik pendaki berdiri di Basecamp hingga Puncak
 */
function openArahRutePendakianModal() {
  const m = selectedMountain || allMountains[0];
  const bc = selectedBasecamp || m?.basecamps[0];

  if (!m || !bc) {
    showToast('Pilih gunung dan jalur via terlebih dahulu', 'warning');
    return;
  }

  const modal = document.getElementById('nav-modal');
  if (!modal) return;

  const waypoints = getExpeditionWaypoints(m, bc);
  const summary = calculateTrailSegments(waypoints);

  document.getElementById('nav-modal-destination').innerText = `${m.nama} · Via ${bc.jalurVia}`;
  document.getElementById('nav-modal-start-point').innerText = `${bc.nama} (${bc.elevasi || 1500} mdpl)`;
  document.getElementById('nav-modal-end-point').innerText = `Puncak ${m.nama} (${m.ketinggian} mdpl)`;

  document.getElementById('nav-modal-distance').innerText = summary.totalDistanceFormatted;
  document.getElementById('nav-modal-gain').innerText = summary.totalGainFormatted;
  document.getElementById('nav-modal-duration').innerText = summary.totalHoursFormatted;
  document.getElementById('nav-modal-pos-count').innerText = `${bc.pos.length} Pos`;

  const stepsContainer = document.getElementById('nav-modal-steps');
  if (stepsContainer) {
    stepsContainer.innerHTML = summary.segments.map((seg, idx) => {
      let icon = 'hiking';
      let badgeBg = 'bg-primary/10 text-primary';
      if (idx === summary.segments.length - 1) {
        icon = 'filter_hdr';
        badgeBg = 'bg-secondary/15 text-secondary';
      }

      return `
        <div class="flex items-start gap-3 p-3 rounded-xl bg-surface-container-low border border-surface-container">
          <div class="w-8 h-8 rounded-xl ${badgeBg} flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-[18px]">${icon}</span>
          </div>
          <div class="flex flex-col flex-1">
            <div class="flex items-center justify-between gap-1">
              <span class="font-headline font-bold text-on-surface text-xs">${seg.fromName} → ${seg.toName}</span>
              <span class="font-headline font-bold text-secondary text-[11px]">${seg.estTimeFormatted}</span>
            </div>
            <div class="flex items-center gap-3 text-[11px] text-on-surface-variant font-mono mt-0.5">
              <span>Jarak: <strong>${seg.distanceFormatted}</strong></span>
              <span>Tanjakan: <strong class="text-primary">${seg.elevGainFormatted}</strong></span>
              <span>Elevasi: ${seg.toElev} mdpl</span>
            </div>
            <p class="text-[11px] text-outline mt-1 italic">${seg.keterangan}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
}

function startLiveTrackingFromArahRute() {
  closeNavModal();
  startSimulatedTracking();
}

function closeNavModal() {
  document.getElementById('nav-modal')?.classList.add('hidden');
}

// Alias kompatibilitas
const startNavigationToActiveBasecamp = openArahRutePendakianModal;

/**
 * 16. GPX Download
 */
function downloadActiveGpx() {
  if (!selectedBasecamp) {
    showToast('Pilih basecamp terlebih dahulu', 'error');
    return;
  }
  const url = `/api/gpx/${selectedBasecamp.id}`;
  window.open(url, '_blank');
  showToast(`Mengunduh file GPX: ${selectedBasecamp.nama}`, 'success');
}


/**
 * 18. Map Controls
 */
function mapZoomIn() {
  map.zoomIn();
}
function mapZoomOut() {
  map.zoomOut();
}
function recenterJava() {
  const targetBounds = REGION_BOUNDS[activeRegion] || REGION_BOUNDS.all;
  map.flyToBounds(targetBounds, { padding: [40, 40], duration: 1 });
  showToast('Pusatkan peta ke wilayah aktif', 'info');
}

function locateUserProximity() {
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung pada browser Anda', 'error');
    return;
  }

  showToast('Mencari gunung terdekat dari posisi Anda...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const uLat = pos.coords.latitude;
      const uLng = pos.coords.longitude;

      if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
      }

      userLocationMarker = L.circleMarker([uLat, uLng], {
        radius: 8,
        fillColor: '#004724',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map).bindPopup('<b>Posisi Anda Saat Ini</b>').openPopup();

      let closest = null;
      let minDistance = Infinity;

      allMountains.forEach(m => {
        if (!m.latitude || !m.longitude) return;
        const d = Math.hypot(m.latitude - uLat, m.longitude - uLng);
        if (d < minDistance) {
          minDistance = d;
          closest = m;
        }
      });

      if (closest) {
        showToast(`Gunung terdekat: ${closest.nama}`, 'success');
        selectMountain(closest.id, true);
      }
    },
    (err) => {
      showToast('Gagal mendeteksi lokasi GPS: ' + err.message, 'error');
    }
  );
}

/**
 * 19. Single Unified Search Event Listeners & Keyboard Shortcuts
 */
function setupEventListeners() {
  // Global shortcut Cmd+K or Ctrl+K focuses the single search input
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const s = document.getElementById('mountain-search');
      s?.focus();
      s?.select();
    }
  });

  // Single Search Input in Explorer Sidebar
  const searchInput = document.getElementById('mountain-search');
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    const clearBtn = document.getElementById('clear-search');
    if (searchQuery.trim()) {
      clearBtn?.classList.remove('hidden');
    } else {
      clearBtn?.classList.add('hidden');
    }
    renderMountainCards();
  });
}

/**
 * 20. Toast Notifications
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-primary text-on-primary' : type === 'error' ? 'bg-error text-on-error' : 'bg-surface-container-highest text-on-surface';

  toast.className = `${bg} px-4 py-2.5 rounded-xl font-headline font-bold text-xs shadow-lg transition-all duration-300 flex items-center gap-2 pointer-events-auto border border-white/20`;
  toast.innerHTML = `
    <span class="material-symbols-outlined text-[16px]">${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function showNotificationPanel() {
  showToast('Sistem Geospasial aktif. Pemantauan jalur resmi se-Pulau Jawa.', 'info');
}
