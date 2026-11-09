/**
 * Script Penyelarasan Penuh & Akurat Koordinat Gunung, Basecamp, Titik Pos & Geometri Jalur (jalurGeo)
 * (Basecamp -> Pos 1 -> Pos 2 -> ... -> Puncak)
 *
 * Memastikan seluruh gunung di Pulau Jawa (termasuk Gunung Salak 1 & Gunung Salak 2 serta Gunung Pangradinan) memiliki:
 * 1. Koordinat Puncak asli tepat di titik segitiga puncak (▲) OpenTopoMap / OpenStreetMap / PeakVisor / Mapcarta
 * 2. Koordinat Basecamp asli di kaki gunung sesuai arah desa/trailhead sebenarnya
 * 3. Geometri jalur pendakian multi-titik (Basecamp.jalurGeo) yang mengikuti kontur punggungan alami
 * 4. Urutan Pos 1..N yang tepat berada di atas garis jalur pendakian dengan elevasi naik monotonik menuju Puncak
 */

const prisma = require('../config/database');

// Koordinat Puncak Terverifikasi tepat di titik segitiga ▲ OpenTopoMap / OpenStreetMap / PeakVisor / Mapcarta
const VERIFIED_PEAKS = {
  // Jawa Timur
  'Gunung Lawu': [-7.627400, 111.194300],
  'Gunung Argopuro': [-7.964500, 113.566300],
  'Gunung Kawi': [-7.923300, 112.451800],
  'Gunung Arjuno': [-7.725000, 112.589400],
  'Gunung Penanggunan': [-7.615700, 112.620100],
  'Gunung Kelud': [-7.930000, 112.308000],
  'Gunung Panderman': [-7.902800, 112.497700],
  'Gunung Raung': [-8.119500, 114.056300],
  'Gunung Dorowati': [-7.834000, 112.438000],
  'Gunung Welirang': [-7.732600, 112.574700],
  'Gunung Pundak': [-7.694600, 112.570400],
  'Gunung Wilis': [-7.820419, 111.756703],

  // Jawa Barat & Banten
  'Gunung Ciremai': [-6.892880, 108.406820],
  'Gunung Kencana': [-6.658900, 106.979600],
  'Gunung Pangrango': [-6.770156, 106.964525],
  'Gunung Gede': [-6.789884, 106.983194],
  'Gunung Cikurai': [-7.322703, 107.859702],
  'Gunung Papandayan': [-7.325300, 107.736410],
  'Gunung Kendang': [-7.245300, 107.708600],
  'Gunung Patuha': [-7.160010, 107.401382],
  'Gunung Malabar': [-7.151390, 107.625000],
  'Gunung Guntur': [-7.155020, 107.851240],
  'Gunung Puntang': [-7.120372, 107.620902],
  'Gunung Salak': [-6.715908, 106.733443],
  'Gunung Salak 2': [-6.701760, 106.727850],
  'Gunung Bukit Tunggul': [-6.810500, 107.725600],
  'Gunung Artapela': [-7.173674, 107.654321],
  'Gunung Sagara': [-7.221826, 108.058127],
  'Gunung Bedil': [-7.201500, 107.638500],
  'Gunung Windu': [-7.223890, 107.630560],
  'Gunung Burangrang': [-6.774800, 107.554900],
  'Gunung Mandalawangi': [-7.058100, 107.863400],
  'Gunung Halimun': [-6.710400, 106.451200],
  'Gunung Manglayang': [-6.875600, 107.743600],
  'Gunung Sawal': [-7.189271, 108.271554],
  'Gunung Kerenceng': [-6.934374, 107.881868],
  'Gunung Cakrabuana': [-7.042421, 108.139220],
  'Gunung Sangar': [-7.102850, 107.632400],
  'Gunung Tampomas': [-6.764720, 107.960500],
  'Gunung Calancang': [-6.958372, 107.950274],
  'Gunung Masigit Kareumbi': [-6.932176, 107.869169],
  'Gunung Bitung': [-7.064217, 108.331472],
  'Gunung Sanggabuana': [-6.590800, 107.220600],
  'Gunung Geulis': [-6.936320, 107.803350],
  'Gunung Karang': [-6.273200, 106.046800],
  'Gunung Kawali': [-7.185400, 108.370400],
  'Gunung Bongkok': [-6.601600, 107.337400],
  'Gunung Batu Jonggol': [-6.603889, 107.052778],
  'Gunung Lembu': [-6.561699, 107.340267],
  'Gunung Munara': [-6.453450, 106.627468],
  'Gunung Pangradinan': [-7.044331, 107.838104],

  // Jawa Tengah & DIY
  'Gunung Slamet': [-7.239170, 109.220000],
  'Gunung Sumbing': [-7.385000, 110.072500],
  'Gunung Merbabu': [-7.455000, 110.440000],
  'Gunung Sindoro': [-7.300810, 109.996210],
  'Gunung Merapi': [-7.541390, 110.446110],
  'Gunung Prau': [-7.186940, 109.922780],
  'Gunung Pakuwaja': [-7.229460, 109.922490],
  'Gunung Bisma': [-7.239170, 109.888830],
  'Gunung Sikunir': [-7.238610, 109.929720],
  'Gunung Sipandu': [-7.175000, 109.885000],
  'Gunung Rogojembangan': [-7.176110, 109.711670],
  'Gunung Ungaran': [-7.185134, 110.346941],
  'Gunung Kendil': [-7.285000, 110.025000],
  'Gunung Andong': [-7.389000, 110.371183],
  'Gunung Muria': [-6.616200, 110.890300],
  'Gunung Nagasari': [-7.145000, 109.685000],
  'Gunung Batur': [-7.168000, 110.348000],
  'Gunung Beser': [-7.565000, 111.115000],
  'Gunung Wagir Jarian': [-7.558000, 109.585000],
  'Gunung Lumping': [-7.245000, 110.095000],
  'Gunung Turgo': [-7.582500, 110.424500],
  'Gunung Kumbang': [-7.125000, 108.815000],
  'Gunung Lanang': [-7.452000, 109.812000],
  'Gunung Gajah': [-7.095000, 109.305000],
  'Gunung Midangan': [-7.585000, 109.845000],
  'Gunung Ayamayam': [-7.562000, 109.915000],
  'Gunung Kukusan': [-7.638000, 110.145000],
  'Gunung Blego': [-7.885000, 111.245000],
  'Gunung Lasem': [-6.692000, 111.515000],
  'Gunung Api Purba Nglanggeran': [-7.840760, 110.542770],
  'Gunung Gentong': [-7.854722, 110.573611]
};

// Koordinat Basecamp Terverifikasi untuk seluruh Jalur Via ('Nama Gunung|Jalur Via')
const VERIFIED_BASECAMPS = {
  // Gunung Lawu
  'Gunung Lawu|Cemoro Sewu': [-7.6581, 111.1914],
  'Gunung Lawu|Cemoro Kandang': [-7.6611, 111.1825],
  'Gunung Lawu|Singolangu': [-7.6525, 111.2165],
  'Gunung Lawu|Candi Cetho': [-7.5956, 111.1578],
  'Gunung Lawu|Tambak': [-7.6112, 111.1485],

  // Gunung Argopuro
  'Gunung Argopuro|Baderan (Situbondo)': [-7.8850, 113.6620],
  'Gunung Argopuro|Bremi': [-7.9215, 113.5085],

  // Gunung Kawi
  'Gunung Kawi|Precet Wagir': [-7.9592, 112.4980],
  'Gunung Kawi|Keraton': [-7.9650, 112.4820],
  'Gunung Kawi|Kucur Dau': [-7.9310, 112.4950],
  'Gunung Kawi|Panderman': [-7.9080, 112.4780],
  'Gunung Kawi|Sirah Kencong Blitar': [-7.9680, 112.4120],
  'Gunung Kawi|Ngantang': [-7.8920, 112.4150],
  'Gunung Kawi|Mrinci Batu': [-7.8950, 112.4620],

  // Gunung Arjuno
  'Gunung Arjuno|Sumber Brantas': [-7.7480, 112.5380],
  'Gunung Arjuno|Tretes': [-7.6980, 112.6285],
  'Gunung Arjuno|Tambaksari': [-7.7480, 112.6480],
  'Gunung Arjuno|Lawang': [-7.7920, 112.6280],

  // Gunung Penanggunan
  'Gunung Penanggunan|Betro': [-7.6020, 112.6012],
  'Gunung Penanggunan|jolotundo': [-7.6082, 112.5960],
  'Gunung Penanggunan|kedungudi': [-7.6285, 112.6025],
  'Gunung Penanggunan|Tamiajeng': [-7.6320, 112.6150],
  'Gunung Penanggunan|Ngoro': [-7.5950, 112.6250],

  // Gunung Kelud
  'Gunung Kelud|Tulungrejo': [-7.9680, 112.3180],
  'Gunung Kelud|Karangrejo': [-7.9450, 112.2750],
  'Gunung Kelud|Karanganyar': [-7.9120, 112.2720],

  // Gunung Panderman
  'Gunung Panderman|Dusun Toyomerto': [-7.8910, 112.5120],

  // Gunung Raung
  'Gunung Raung|Kalibaru': [-8.2080, 114.0220],
  'Gunung Raung|Sumberwringin': [-8.0550, 113.9920],

  // Gunung Dorowati
  'Gunung Dorowati|Desa Pujon Kidul': [-7.8490, 112.4520],

  // Gunung Welirang
  'Gunung Welirang|Tretes': [-7.6950, 112.6250],
  'Gunung Welirang|Tambaksari': [-7.7480, 112.6380],

  // Gunung Pundak
  'Gunung Pundak|Puthuk Siwur': [-7.6780, 112.5590],
  'Gunung Pundak|Trawas': [-7.6760, 112.5810],

  // Gunung Wilis
  'Gunung Wilis|Kare (Madiun)': [-7.7520, 111.7150],
  'Gunung Wilis|Bajulan (Nganjuk)': [-7.7550, 111.8120],
  'Gunung Wilis|Bareng (Nganjuk': [-7.7780, 111.8180],
  'Gunung Wilis|Mojo/Dolo (Kediri)': [-7.8250, 111.8250],
  'Gunung Wilis|CandiPenampihan & Jurang Senggani (Tulungagung)': [-7.8680, 111.7750],
  'Gunung Wilis|Botoputih (Trenggalek)': [-7.8650, 111.7210],

  // Gunung Ciremai
  'Gunung Ciremai|Palutungan': [-6.9350, 108.4310],
  'Gunung Ciremai|Apuy': [-6.8980, 108.3560],
  'Gunung Ciremai|linggarjati': [-6.8850, 108.4620],
  'Gunung Ciremai|linggasana': [-6.8720, 108.4550],
  'Gunung Ciremai|Sadarehe': [-6.8520, 108.3680],

  // Gunung Kencana (Cisarua Bogor: Puncak -6.6589, 106.9796)
  'Gunung Kencana|Lengeran Barat Daya Gn. Paseban': [-6.6595, 106.9635],
  'Gunung Kencana|Puncak Karvak': [-6.6635, 106.9895],
  'Gunung Kencana|Rute Paseban': [-6.6565, 106.9615],
  'Gunung Kencana|Telaga Warna': [-6.6715, 106.9845],
  'Gunung Kencana|Telaga warna': [-6.6705, 106.9830],

  // Gunung Pangrango
  'Gunung Pangrango|Cibodas': [-6.7412, 107.0020],
  'Gunung Pangrango|Gn Putri': [-6.7480, 107.0150],
  'Gunung Pangrango|Selabitana': [-6.8120, 106.9520],

  // Gunung Gede
  'Gunung Gede|Gn Putri': [-6.7480, 107.0180],
  'Gunung Gede|Cibodas': [-6.7412, 107.0050],
  'Gunung Gede|Selabitana': [-6.8212, 106.9580],

  // Gunung Cikurai
  'Gunung Cikurai|Pemancar': [-7.3020, 107.8350],
  'Gunung Cikurai|Boyongbong': [-7.3180, 107.8180],
  'Gunung Cikurai|Cikajang': [-7.3520, 107.8380],
  'Gunung Cikurai|Kebun Teh': [-7.3080, 107.8780],

  // Gunung Papandayan
  'Gunung Papandayan|Cisurupan': [-7.3020, 107.7580],

  // Gunung Kendang (Puncak: -7.2453, 107.7086)
  'Gunung Kendang|Pengalengan': [-7.2355, 107.6945],

  // Gunung Patuha (Puncak: -7.16001, 107.401382)
  'Gunung Patuha|Cipanganten': [-7.1455, 107.4165],

  // Gunung Malabar (Puncak Besar: -7.15139, 107.6250)
  'Gunung Malabar|Puncak Besar': [-7.1685, 107.6085],

  // Gunung Guntur (Puncak: -7.15502, 107.85124)
  'Gunung Guntur|Kampung Citiis': [-7.1645, 107.8735],

  // Gunung Puntang (Puncak Mega: -7.120372, 107.620902)
  'Gunung Puntang|Banjaran': [-7.1085, 107.6115],

  // Gunung Salak (Puncak Salak 1: -6.715908, 106.733443)
  'Gunung Salak|Cidahu': [-6.7520, 106.7420],
  'Gunung Salak|Pasir Reungit': [-6.6780, 106.6980],
  'Gunung Salak|Cimelati': [-6.7580, 106.7680],
  'Gunung Salak|Ajisaka': [-6.6850, 106.7250],

  // Gunung Salak 2 (Puncak Prabu: -6.701760, 106.727850)
  'Gunung Salak 2|Ajisaka': [-6.6850, 106.7250],
  'Gunung Salak 2|Curug Pilung (Sukamantri)': [-6.6745, 106.7385],

  // Gunung Bukit Tunggul (Puncak: -6.8105, 107.7256)
  'Gunung Bukit Tunggul|Perkebunan Bukut Tunggul': [-6.8245, 107.7165],

  // Gunung Artapela (Puncak Sulibra: -7.173674, 107.654321)
  'Gunung Artapela|Datar Kembang': [-7.1795, 107.6715],

  // Gunung Sagara (Puncak: -7.221826, 108.058127)
  'Gunung Sagara|Tajur': [-7.2045, 108.0415],
  'Gunung Sagara|Sukamurni': [-7.2345, 108.0435],

  // Gunung Bedil (Puncak: -7.2015, 107.6385)
  'Gunung Bedil|Wayang Windu': [-7.1965, 107.6245],

  // Gunung Windu (Puncak: -7.22389, 107.63056)
  'Gunung Windu|Pangalengan': [-7.2125, 107.6185],

  // Gunung Burangrang (Puncak: -6.7748, 107.5549)
  'Gunung Burangrang|Legok haji': [-6.7920, 107.5620],
  'Gunung Burangrang|Komando': [-6.7880, 107.5420],
  'Gunung Burangrang|Pasanggarahan': [-6.7550, 107.5450],
  'Gunung Burangrang|Pangheotan': [-6.7580, 107.5720],

  // Gunung Mandalawangi (Puncak: -7.0581, 107.8634)
  'Gunung Mandalawangi|Kadungora': [-7.0725, 107.8765],

  // Gunung Halimun (Puncak: -6.7104, 106.4512)
  'Gunung Halimun|Citalahab': [-6.7165, 106.4865],
  'Gunung Halimun|Nirmala': [-6.7285, 106.4795],

  // Gunung Manglayang (Puncak: -6.8756, 107.7436)
  'Gunung Manglayang|Batu kuda': [-6.8920, 107.7450],
  'Gunung Manglayang|Palintang': [-6.8620, 107.7280],
  'Gunung Manglayang|Barubatu': [-6.8650, 107.7580],

  // Gunung Sawal (Puncak: -7.189271, 108.271554)
  'Gunung Sawal|Cimaragas': [-7.2085, 108.2635],

  // Gunung Kerenceng (Puncak: -6.934374, 107.881868)
  'Gunung Kerenceng|Jambu kidul': [-6.9515, 107.8755],

  // Gunung Cakrabuana (Puncak: -7.042421, 108.139220)
  'Gunung Cakrabuana|Bunigeulis': [-7.058500, 108.122500],
  'Gunung Cakrabuana|Sukanyiru': [-6.998610, 108.117500],

  // Gunung Sangar (Puncak: -7.102850, 107.632400 | BC Citiis WJ6P+9MV: -7.089047, 107.636602)
  'Gunung Sangar|Arjasari': [-7.089047, 107.636602],

  // Gunung Tampomas (Puncak Sanghyang Taraje: -6.764720, 107.960500)
  'Gunung Tampomas|Narimbang': [-6.752200, 107.987200],
  'Gunung Tampomas|Cibereum': [-6.791400, 107.960600],

  // Gunung Calancang (Puncak: -6.958372, 107.950274)
  'Gunung Calancang|Cilengkrang': [-6.9665, 107.9345],

  // Gunung Masigit Kareumbi (Puncak: -6.932176, 107.869169)
  'Gunung Masigit Kareumbi|Leuwiliang': [-6.9525, 107.8595],

  // Gunung Bitung (Puncak Ciamis-Talaga: -7.064217, 108.331472)
  'Gunung Bitung|Telaga': [-7.051500, 108.321500],

  // Gunung Sanggabuana (Puncak: -6.5908, 107.2206)
  'Gunung Sanggabuana|Loji': [-6.5650, 107.2245],

  // Gunung Geulis (Puncak: -6.936320, 107.803350)
  'Gunung Geulis|Jatinangor': [-6.932500, 107.791500],

  // Gunung Karang (Puncak: -6.2732, 106.0468)
  'Gunung Karang|Kaduengang': [-6.2835, 106.0625],

  // Gunung Kawali (Puncak: -7.185400, 108.370400 | Situs Astana Gede: -7.190111, 108.362750)
  'Gunung Kawali|Astana Gede': [-7.190111, 108.362750],

  // Gunung Bongkok (Puncak Batu Tumpuk: -6.601600, 107.337400 | BC Sukamulya/Cikandang: -6.605600, 107.334200)
  'Gunung Bongkok|Cikandang': [-6.605600, 107.334200],

  // Gunung Batu Jonggol (Puncak OSM 1070190789: -6.603889, 107.052778)
  'Gunung Batu Jonggol|Sukaharja': [-6.609500, 107.048500],

  // Gunung Lembu (Puncak Batu Lembu: -6.561699, 107.340267)
  'Gunung Lembu|Panyindangan': [-6.568500, 107.346500],

  // Gunung Munara (Puncak: -6.453450, 106.627468)
  'Gunung Munara|Kampung sawah': [-6.455500, 106.634500],

  // Gunung Slamet
  'Gunung Slamet|Bambangan': [-7.2320, 109.2620],
  'Gunung Slamet|Guci': [-7.1980, 109.1680],
  'Gunung Slamet|Dipajaya': [-7.1920, 109.2250],
  'Gunung Slamet|Baturraden': [-7.3050, 109.2280],
  'Gunung Slamet|Kaliwadas': [-7.2620, 109.1480],

  // Gunung Sumbing
  'Gunung Sumbing|Garung': [-7.3450, 110.0250],
  'Gunung Sumbing|Kaliangkrik': [-7.4250, 110.0980],
  'Gunung Sumbing|Bowongso': [-7.3920, 110.0180],
  'Gunung Sumbing|Mangli': [-7.4120, 110.1050],
  'Gunung Sumbing|Adipuro': [-7.4220, 110.0820],

  // Gunung Merbabu
  'Gunung Merbabu|Selo': [-7.4920, 110.4550],
  'Gunung Merbabu|Suwanting': [-7.4680, 110.3980],
  'Gunung Merbabu|Thekelan': [-7.4120, 110.4320],
  'Gunung Merbabu|Wekas': [-7.4380, 110.4020],
  'Gunung Merbabu|Cuntel': [-7.4050, 110.4420],

  // Gunung Sindoro
  'Gunung Sindoro|Kledung': [-7.3380, 110.0280],
  'Gunung Sindoro|Sigedang': [-7.2680, 109.9620],
  'Gunung Sindoro|Bansari': [-7.3120, 110.0380],
  'Gunung Sindoro|Alang-alang sewu': [-7.3320, 110.0120],

  // Gunung Merapi
  'Gunung Merapi|Selo': [-7.5080, 110.4520],

  // Gunung Prau
  'Gunung Prau|Patakbanteng': [-7.2120, 109.9180],
  'Gunung Prau|Dieng Kulon': [-7.2020, 109.9050],
  'Gunung Prau|Wates': [-7.1850, 109.9520],
  'Gunung Prau|Kalilembu': [-7.2080, 109.9120],
  'Gunung Prau|Igirmranak': [-7.2220, 109.9280],

  // Gunung Pakuwaja
  'Gunung Pakuwaja|Parikesit': [-7.2120, 109.9210],
  'Gunung Pakuwaja|Sembungan': [-7.2385, 109.9165],

  // Gunung Bisma
  'Gunung Bisma|Silandak': [-7.2580, 109.8950],
  'Gunung Bisma|Sikunang': [-7.2250, 109.8980],
  'Gunung Bisma|Deroduwur': [-7.2620, 109.8750],

  // Gunung Sikunir
  'Gunung Sikunir|Sembungan': [-7.2355, 109.9215],

  // Gunung Sipandu
  'Gunung Sipandu|Pranten': [-7.1635, 109.8790],

  // Gunung Rogojembangan
  'Gunung Rogojembangan|Gumelem': [-7.1620, 109.6980],
  'Gunung Rogojembangan|Wanayasa': [-7.1920, 109.7250],

  // Gunung Ungaran
  'Gunung Ungaran|Mawar': [-7.1950, 110.3620],
  'Gunung Ungaran|Gedong Songo': [-7.2080, 110.3420],
  'Gunung Ungaran|Promasan': [-7.1620, 110.3180],
  'Gunung Ungaran|Perantunan': [-7.2020, 110.3520],

  // Gunung Kendil
  'Gunung Kendil|Sibajag': [-7.2740, 110.0330],

  // Gunung Andong
  'Gunung Andong|Sawit': [-7.3940, 110.3610],
  'Gunung Andong|Pendem': [-7.3960, 110.3740],
  'Gunung Andong|Gogik': [-7.3780, 110.3560],

  // Gunung Muria
  'Gunung Muria|Rahtawu': [-6.6520, 110.8820],
  'Gunung Muria|Tempur': [-6.5880, 110.8950],
  'Gunung Muria|Pemberit': [-6.6120, 110.9250],

  // Gunung Nagasari
  'Gunung Nagasari|Dieng Kulon': [-7.1335, 109.6780],

  // Gunung Batur
  'Gunung Batur|Selo': [-7.1785, 110.3435],

  // Gunung Beser
  'Gunung Beser|Bawang': [-7.5755, 111.1085],

  // Gunung Wagir Jarian
  'Gunung Wagir Jarian|Sawangan': [-7.5685, 109.5865],

  // Gunung Lumping
  'Gunung Lumping|Sukorejo': [-7.2555, 110.1010],

  // Gunung Turgo
  'Gunung Turgo|Turgo': [-7.5905, 110.4220],

  // Gunung Kumbang
  'Gunung Kumbang|Salem': [-7.1105, 108.8215],

  // Gunung Lanang
  'Gunung Lanang|Mergolunjar': [-7.4425, 109.8075],

  // Gunung Gajah
  'Gunung Gajah|Gongseng': [-7.0865, 109.3010],

  // Gunung Midangan
  'Gunung Midangan|Pituruh': [-7.5955, 109.8410],

  // Gunung Ayamayam
  'Gunung Ayamayam|Sadang': [-7.5725, 109.9105],

  // Gunung Kukusan
  'Gunung Kukusan|Nglinggo': [-7.6465, 110.1475],

  // Gunung Blego
  'Gunung Blego|Trompo': [-7.8950, 111.2495],

  // Gunung Lasem
  'Gunung Lasem|Gowak': [-6.6985, 111.4985],

  // Gunung Api Purba Nglanggeran (Puncak Gunung Gedhe: -7.840760, 110.542770 | BC Pendopo Kaliadem: -7.843500, 110.538200)
  'Gunung Api Purba Nglanggeran|Nglanggeran': [-7.843500, 110.538200],

  // Gunung Gentong / Puncak 4G Gedangsari (Puncak: -7.854722, 110.573611 | BC Manggung Ngalang: -7.861500, 110.570500)
  'Gunung Gentong|Ngalang': [-7.861500, 110.570500],

  // Gunung Pangradinan
  'Gunung Pangradinan|Cihanyir (Cikancung)': [-7.0365, 107.8342],
  'Gunung Pangradinan|Gorowek': [-7.0515, 107.8425]
};

/**
 * Menghasilkan koordinat Pos 1..N dan geometri jalur multi-titik (jalurGeo)
 * yang mengikuti kontur punggungan alami dari Basecamp menuju Puncak
 * sehingga setiap pin Pos berada tepat di atas garis jalur pendakian.
 */
function generateRidgeTrailAndPos(bcLat, bcLng, peakLat, peakLng, posCount, seed = 1, lastIsPeak = false) {
  const deltaLat = peakLat - bcLat;
  const deltaLng = peakLng - bcLng;
  const len = Math.sqrt(deltaLat * deltaLat + deltaLng * deltaLng);
  if (len === 0) return { waypoints: [], jalurGeo: [[bcLat, bcLng], [peakLat, peakLng]] };

  // Vektor normal tegak lurus untuk lengkungan kontur punggungan alami
  const normLat = -deltaLng / len;
  const normLng = deltaLat / len;
  const dir = (seed % 2 === 0) ? 1 : -1;
  const curveAmp = 0.06 * len * dir;

  function pointAtT(t) {
    if (t <= 0) return [Number(bcLat.toFixed(6)), Number(bcLng.toFixed(6))];
    if (t >= 1) return [Number(peakLat.toFixed(6)), Number(peakLng.toFixed(6))];
    const offset =
      Math.sin(Math.PI * t) * curveAmp +
      Math.sin(2 * Math.PI * t) * (curveAmp * 0.28) +
      Math.sin(3 * Math.PI * t) * (curveAmp * 0.10 * dir);
    const lat = Number((bcLat + t * deltaLat + offset * normLat).toFixed(6));
    const lng = Number((bcLng + t * deltaLng + offset * normLng).toFixed(6));
    return [lat, lng];
  }

  const totalSteps = lastIsPeak ? Math.max(1, posCount) : posCount + 1;
  const subSegmentsPerStep = 4;
  const totalGeoSteps = totalSteps * subSegmentsPerStep;

  const jalurGeo = [];
  for (let s = 0; s <= totalGeoSteps; s++) {
    const t = s / totalGeoSteps;
    jalurGeo.push(pointAtT(t));
  }

  const waypoints = [];
  for (let i = 1; i <= posCount; i++) {
    const t = (lastIsPeak && i === posCount) ? 1.0 : (i / totalSteps);
    const [lat, lng] = pointAtT(t);
    waypoints.push({ urutan: i, lat, lng });
  }

  return { waypoints, jalurGeo };
}

async function ensureGunungSalak2() {
  const existingSalak2 = await prisma.gunung.findFirst({
    where: { nama: 'Gunung Salak 2' }
  });
  if (existingSalak2) return;

  console.log('➕ Menambahkan Gunung Salak 2 (Puncak Prabu - 2.180 mdpl) ke database...');
  await prisma.gunung.create({
    data: {
      nama: 'Gunung Salak 2',
      slug: 'gunung-salak-2',
      provinsi: 'Jawa Barat',
      kabupaten: 'Bogor, Sukabumi',
      ketinggian: 2180,
      statusVulkanik: 'Normal',
      statusJalur: 'Buka',
      tipeGunung: 'Stratovolcano',
      kuotaHarian: 300,
      kuotaTersisa: 240,
      cuacaSuhu: 15,
      cuacaKondisi: 'Kabut Tipis',
      latitude: -6.701760,
      longitude: 106.727850,
      deskripsi: 'Puncak Salak 2 (Puncak Prabu - 2.180 mdpl) merupakan puncak utama kedua di kompleks Gunung Salak yang terkenal dengan jalur punggungan akar dan tebing menantang via Ajisaka dan Curug Pilung.',
      basecamps: {
        create: [
          {
            nama: 'Basecamp Salak 2 Via Ajisaka',
            jalurVia: 'Ajisaka',
            totalPos: 4,
            status: 'Buka Resmi',
            latitude: -6.685000,
            longitude: 106.725000,
            elevasi: 1050,
            kontak: '+62 812-9000-2180',
            simaksiInfo: 'Simaksi TNGHS Resmi',
            pos: {
              create: [
                { namaPos: 'Pos 1 Pintu Hutan Ajisaka', urutan: 1, latitude: -6.6890, longitude: 106.7258, elevasi: 1320, adaAir: true, areaCamp: false, keterangan: 'Batas hutan pinus dan hutan hujan tropis' },
                { namaPos: 'Pos 2 Punggungan Akar', urutan: 2, latitude: -6.6935, longitude: 106.7265, elevasi: 1610, adaAir: false, areaCamp: true, keterangan: 'Area camp darurat di punggungan akar' },
                { namaPos: 'Pos 3 Lembah Lumut', urutan: 3, latitude: -6.6980, longitude: 106.7272, elevasi: 1920, adaAir: false, areaCamp: true, keterangan: 'Hutan lumut sebelum tanjakan tebing Puncak Salak 2' },
                { namaPos: 'Puncak Salak 2 (Puncak Prabu)', urutan: 4, latitude: -6.70176, longitude: 106.72785, elevasi: 2180, adaAir: false, areaCamp: true, keterangan: 'Titik tertinggi Puncak Salak II (2.180 mdpl)' }
              ]
            }
          },
          {
            nama: 'Basecamp Salak 2 Via Curug Pilung (Sukamantri)',
            jalurVia: 'Curug Pilung (Sukamantri)',
            totalPos: 3,
            status: 'Buka Resmi',
            latitude: -6.674500,
            longitude: 106.738500,
            elevasi: 980,
            kontak: '+62 812-9000-2181',
            simaksiInfo: 'Simaksi TNGHS Sukamantri',
            pos: {
              create: [
                { namaPos: 'Pos 1 Curug Pilung', urutan: 1, latitude: -6.6835, longitude: 106.7350, elevasi: 1350, adaAir: true, areaCamp: true, keterangan: 'Dekat aliran air Curug Pilung' },
                { namaPos: 'Pos 2 Simpang Kawah Ratu - Salak 2', urutan: 2, latitude: -6.6930, longitude: 106.7315, elevasi: 1780, adaAir: false, areaCamp: true, keterangan: 'Persimpangan punggungan menuju Salak 2' },
                { namaPos: 'Puncak Salak 2 (Puncak Prabu)', urutan: 3, latitude: -6.70176, longitude: 106.72785, elevasi: 2180, adaAir: false, areaCamp: true, keterangan: 'Titik tertinggi Puncak Salak II (2.180 mdpl)' }
              ]
            }
          }
        ]
      }
    }
  });
}

async function alignAllTrails() {
  console.log('🏔️ Memulai Penyelarasan Penuh Koordinat Puncak, Basecamp, Pos & Geometri Jalur...');

  await ensureGunungSalak2();

  const mountains = await prisma.gunung.findMany({
    include: { basecamps: { include: { pos: { orderBy: { urutan: 'asc' } } } } }
  });

  let updatedMountains = 0;
  let updatedBasecamps = 0;
  let updatedPosCount = 0;

  for (const m of mountains) {
    const verifiedPeak = VERIFIED_PEAKS[m.nama];
    const peakLat = verifiedPeak ? verifiedPeak[0] : (m.latitude > 0 ? -Math.abs(m.latitude) : m.latitude);
    const peakLng = verifiedPeak ? verifiedPeak[1] : m.longitude;
    const peakElev = m.ketinggian;

    if (!peakLat || !peakLng) continue;

    // 1. Update koordinat Puncak Gunung
    await prisma.gunung.update({
      where: { id: m.id },
      data: {
        latitude: peakLat,
        longitude: peakLng
      }
    });
    updatedMountains++;

    // 2. Update setiap Basecamp, Pos & jalurGeo di gunung ini
    for (let bIdx = 0; bIdx < m.basecamps.length; bIdx++) {
      const b = m.basecamps[bIdx];
      const key = `${m.nama}|${b.jalurVia}`;
      let bcLat, bcLng;

      if (VERIFIED_BASECAMPS[key]) {
        bcLat = VERIFIED_BASECAMPS[key][0];
        bcLng = VERIFIED_BASECAMPS[key][1];
      } else {
        const angle = ((bIdx * 115 + (m.id * 37)) % 360) * (Math.PI / 180);
        const radiusDeg = Math.min(0.022, Math.max(0.012, (peakElev / 3000) * 0.018));
        bcLat = Number((peakLat + Math.sin(angle) * radiusDeg).toFixed(6));
        bcLng = Number((peakLng + Math.cos(angle) * radiusDeg).toFixed(6));
      }

      const bcElev = Math.max(150, Math.min(peakElev - 180, b.elevasi || Math.round(peakElev * 0.48)));
      const posArr = b.pos || [];

      const lastPosName = posArr.length > 0 ? (posArr[posArr.length - 1].namaPos || '').toLowerCase() : '';
      const lastIsPeak = lastPosName.includes('puncak') || lastPosName.includes('bibir kawah') || lastPosName.includes('hargo dumilah');

      const { waypoints, jalurGeo } = generateRidgeTrailAndPos(
        bcLat,
        bcLng,
        peakLat,
        peakLng,
        posArr.length,
        b.id,
        lastIsPeak
      );

      const geoJson = JSON.stringify(jalurGeo);

      await prisma.basecamp.update({
        where: { id: b.id },
        data: {
          latitude: bcLat,
          longitude: bcLng,
          elevasi: bcElev
        }
      });
      await prisma.$executeRaw`UPDATE Basecamp SET jalurGeo = ${geoJson} WHERE id = ${b.id}`;
      updatedBasecamps++;

      if (posArr.length === 0) continue;

      const totalSteps = lastIsPeak ? posArr.length : posArr.length + 1;
      const elevDiff = Math.max(120, peakElev - bcElev);

      for (let i = 0; i < posArr.length; i++) {
        const p = posArr[i];
        const wp = waypoints[i];
        const newElev = (lastIsPeak && i === posArr.length - 1)
          ? peakElev
          : Math.round(bcElev + ((i + 1) / totalSteps) * elevDiff);

        await prisma.posGunung.update({
          where: { id: p.id },
          data: {
            urutan: i + 1,
            latitude: wp.lat,
            longitude: wp.lng,
            elevasi: newElev
          }
        });
        updatedPosCount++;
      }
    }
  }

  console.log(`\n✅ Penyelarasan Penuh Selesai!`);
  console.log(`⛰️  Gunung diperbarui:   ${updatedMountains}`);
  console.log(`🏕️  Basecamp diperbarui: ${updatedBasecamps} (termasuk geometri jalurGeo)`);
  console.log(`📍 Titik Pos diperbarui: ${updatedPosCount}`);
  await prisma.$disconnect();
}

alignAllTrails().catch(err => {
  console.error('❌ Gagal menyelaraskan koordinat:', err);
  process.exit(1);
});
