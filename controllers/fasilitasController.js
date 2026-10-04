// Re-export or delegate to pendakianController for backward compatibility
const pendakianController = require('./pendakianController');

module.exports = {
  ...pendakianController,
  // Alias for backward compatibility if needed
  getAllFasilitas: pendakianController.getAllBasecamp,
  getFasilitasById: pendakianController.getBasecampById,
  createFasilitas: pendakianController.createBasecamp,
  updateFasilitas: pendakianController.updateBasecamp,
  deleteFasilitas: pendakianController.deleteBasecamp,
};
