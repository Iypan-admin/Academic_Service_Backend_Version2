const express = require('express');
const router = express.Router();
const authenticate = require('../config/authMiddleware.js');
const {
  getBatchStudentsWithMarks,
  saveBatchMarks,
  submitBatchMarks,
  getBatchAssessmentSummary,
  setBatchAssessmentDate
} = require('../controllers/assessmentController.js');

// Apply authentication middleware to all routes - allow teacher role
router.use(authenticate(['teacher', 'academic', 'admin', 'manager']));

// Get students in a batch with their assessment marks
router.get('/batch/:batchId/students', getBatchStudentsWithMarks);

// Save or update assessment marks for a batch
router.post('/batch/:batchId/marks', saveBatchMarks);

// Submit final assessment marks for a batch
router.post('/batch/:batchId/submit', submitBatchMarks);

// Get batch assessment summary
router.get('/batch/:batchId/summary', getBatchAssessmentSummary);

// Set assessment date for a batch
router.post('/batch/:batchId/assessment-date', setBatchAssessmentDate);

module.exports = router;
