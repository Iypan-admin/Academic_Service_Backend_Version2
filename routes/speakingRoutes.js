const express = require("express");
const authenticate = require("../config/authMiddleware.js");
const speakingUpload = require("../middleware/speakingUpload.js");
const optionalSpeakingUpload = require("../middleware/optionalSpeakingUpload.js");
const {
    uploadSpeakingMaterial,
    getSpeakingByCourse,
    getSpeakingByBatch,
    markSpeakingComplete,
    getStudentSpeaking,
    saveSpeakingAttempt,
    getSpeakingSubmissions,
    addSpeakingFeedback,
    deleteSpeakingSession
} = require("../controllers/lsrwController.js");

const router = express.Router();

// Debug: Log when routes are loaded
console.log('✅ Speaking routes loaded - /feedback route registered');

// Resource Manager routes - Upload speaking material
router.post("/upload", authenticate("resource_manager"), speakingUpload, uploadSpeakingMaterial);

// Get speaking materials by course
router.get("/byCourse/:course_id", authenticate("resource_manager"), getSpeakingByCourse);

// Delete speaking session (delete entire session with all files)
router.delete("/session/:id", authenticate("resource_manager"), deleteSpeakingSession);

// Teacher routes - Get batch speaking materials
router.get("/batch/:batch_id", authenticate("teacher"), getSpeakingByBatch);

// Teacher routes - Mark material as completed
router.put("/complete/:mapping_id", authenticate("teacher"), markSpeakingComplete);

// Teacher routes - Get student submissions for review
router.get("/batch/:batch_id/submissions", authenticate("teacher"), getSpeakingSubmissions);

// Teacher routes - Add/Update feedback for student attempt (supports text and audio)
// Handles both JSON (no files) and multipart/form-data (with audio file)
router.post("/feedback", authenticate("teacher"), (req, res, next) => {
    console.log('📝 Feedback route hit - Content-Type:', req.headers['content-type']);
    console.log('👤 User authenticated:', req.user?.id, req.user?.role);
    // Check content type - only use multer for multipart requests
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
        // Has files, use multer
        console.log('📁 Multipart request detected - using multer');
        return optionalSpeakingUpload(req, res, next);
    } else {
        // JSON request - skip multer, set req.files to empty object
        console.log('📄 JSON request detected - skipping multer');
        req.files = {};
        return next();
    }
}, async (req, res) => {
    console.log('🎯 Calling addSpeakingFeedback controller');
    console.log('📋 Final req.body:', JSON.stringify(req.body));
    console.log('📁 Final req.files keys:', Object.keys(req.files || {}));
    try {
        await addSpeakingFeedback(req, res);
    } catch (error) {
        console.error('❌ Unhandled error in feedback route:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || "Internal server error" });
        }
    }
});

// Student routes - Get visible speaking materials
router.get("/student/:batch_id", authenticate("student"), getStudentSpeaking);

// Student routes - Save speaking attempt (draft or submit)
router.post("/attempt", authenticate("student"), saveSpeakingAttempt);

module.exports = router;

