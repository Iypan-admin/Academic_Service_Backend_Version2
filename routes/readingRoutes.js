const express = require("express");
const authenticate = require("../config/authMiddleware.js");
const readingUpload = require("../middleware/readingUpload.js");
const optionalReadingUpload = require("../middleware/optionalReadingUpload.js");
const {
    uploadReadingMaterial,
    getReadingByCourse,
    getReadingByBatch,
    markReadingComplete,
    getStudentReading,
    submitReadingAttempt,
    getReadingSubmissions,
    addReadingFeedback,
    verifyReadingAttempt,
    deleteReadingSession
} = require("../controllers/lsrwController.js"); // Note: functions are in lsrwController

const router = express.Router();

// Resource Manager routes - Extract Reading content from file (for preview)
router.post("/extract", authenticate("resource_manager"), readingUpload, require("../controllers/lsrwController.js").extractReadingContent);

// Resource Manager routes - Upload Reading material
router.post("/upload", authenticate("resource_manager"), readingUpload, uploadReadingMaterial);

// Get Reading content by course (Resource Manager)
router.get("/byCourse/:course_id", authenticate("resource_manager"), getReadingByCourse);

// Resource Manager routes - Delete reading session
router.delete("/session/:id", authenticate("resource_manager"), deleteReadingSession);

// Teacher routes - Get batch Reading content
router.get("/batch/:batch_id", authenticate("teacher"), getReadingByBatch);

// Teacher routes - Mark material as completed
router.put("/complete/:mapping_id", authenticate("teacher"), markReadingComplete);

// Teacher routes - Get student submissions for review
router.get("/batch/:batch_id/submissions", authenticate("teacher"), getReadingSubmissions);

// Teacher routes - Add/Update feedback for reading attempt (supports marks and audio)
router.post("/feedback", authenticate("teacher"), optionalReadingUpload, addReadingFeedback);

// Teacher routes - Verify reading attempt and release marks
router.put("/verify/:attempt_id", authenticate("teacher"), verifyReadingAttempt);

// Student routes - Get visible Reading content
router.get("/student/:batch_id", authenticate("student"), getStudentReading);

// Student routes - Submit reading quiz attempt
router.post("/attempt", authenticate("student"), submitReadingAttempt);

module.exports = router;

