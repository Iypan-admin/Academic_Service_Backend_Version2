const express = require("express");
const authenticate = require("../config/authMiddleware.js");
const lsrwUpload = require("../middleware/lsrwUpload.js");
const {
    uploadLSRWContent,
    getLSRWByCourse,
    updateSessionNumbers,
    deleteListeningSession,
    getLSRWByBatch,
    markLSRWComplete,
    getStudentLSRW,
    submitStudentAnswers,
    getStudentResults,
    getStudentSubmissions,
    verifyStudentSubmission
} = require("../controllers/lsrwController.js");

const router = express.Router();

// Resource Manager routes - Upload LSRW content
router.post("/upload", authenticate("resource_manager"), lsrwUpload, uploadLSRWContent);

// Get LSRW content by course
router.get("/byCourse/:course_id", authenticate("resource_manager"), getLSRWByCourse);

// Update session numbers for listening materials (reorder)
router.put("/updateSessionNumbers", authenticate("resource_manager"), updateSessionNumbers);

// Delete listening session (delete entire session with all files)
router.delete("/session/:id", authenticate("resource_manager"), deleteListeningSession);

// Tutor routes - Get batch LSRW content
router.get("/batch/:batch_id", authenticate("teacher"), getLSRWByBatch);

// Tutor routes - Mark lesson as completed
router.put("/complete/:mapping_id", authenticate("teacher"), markLSRWComplete);

// Tutor routes - Get student submissions for verification
router.get("/batch/:batch_id/submissions", authenticate("teacher"), getStudentSubmissions);

// Tutor routes - Verify and release student marks
router.put("/verify/:submission_id", authenticate("teacher"), verifyStudentSubmission);

// Student routes - Get visible LSRW content
router.get("/student/:batch_id", authenticate("student"), getStudentLSRW);

// Student routes - Submit answers
router.post("/submit", authenticate("student"), submitStudentAnswers);

// Student routes - Get results
router.get("/results/:student_id/:lsrw_id", authenticate("student"), getStudentResults);

module.exports = router;

