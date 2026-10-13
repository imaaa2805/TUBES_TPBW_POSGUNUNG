const express = require('express');
const router = express.Router();
const pendakianController = require('../controllers/pendakianController');

// Statistics Endpoint
router.get('/stats', pendakianController.getStats);

// Gunung Endpoints (CRUD)
router.get('/gunung', pendakianController.getAllGunung);
router.get('/gunung/:id', pendakianController.getGunungById);
router.post('/gunung', pendakianController.createGunung);
router.put('/gunung/:id', pendakianController.updateGunung);
router.delete('/gunung/:id', pendakianController.deleteGunung);

// Basecamp Endpoints (CRUD)
router.get('/basecamp', pendakianController.getAllBasecamp);
router.get('/basecamp/:id', pendakianController.getBasecampById);
router.post('/basecamp', pendakianController.createBasecamp);
router.put('/basecamp/:id', pendakianController.updateBasecamp);
router.delete('/basecamp/:id', pendakianController.deleteBasecamp);

// Pos Pendakian Endpoints (CRUD)
router.get('/pos', pendakianController.getAllPos);
router.post('/pos', pendakianController.createPos);
router.put('/pos/:id', pendakianController.updatePos);
router.delete('/pos/:id', pendakianController.deletePos);

// Navigation, GPX & Batch Coordinates Update
router.get('/route', pendakianController.getRouteNavigation);
router.get('/gpx/:basecampId', pendakianController.exportGpx);
router.put('/coordinates/batch', pendakianController.updateCoordinatesBatch);

// Backward Compatibility Aliases for fasilitas
router.get('/fasilitas', pendakianController.getAllBasecamp);
router.get('/fasilitas/:id', pendakianController.getBasecampById);
router.post('/fasilitas', pendakianController.createBasecamp);
router.put('/fasilitas/:id', pendakianController.updateBasecamp);
router.delete('/fasilitas/:id', pendakianController.deleteBasecamp);

module.exports = router;
