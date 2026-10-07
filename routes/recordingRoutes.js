const express = require('express');
const router = express.Router();
const authorizeRoles = require('../config/multiRoleAuth');
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

const {
    getBatchRecordings,
    getAllRecordings,
    getRecordingStreamUrl,
    handleLiveKitWebhook,
    uploadClassRecording
} = require('../controllers/recordingController');

// 1. LiveKit Webhook for automated recording finalization (raw text/json from LiveKit)
router.post('/webhook', express.raw({ type: 'application/webhook+json' }), handleLiveKitWebhook);

// 2. Student & Teacher: Get recordings for specific batch
router.get('/batch/:batch_id', authorizeRoles(['admin', 'academic', 'teacher', 'student']), getBatchRecordings);

// 3. Academic Manager / Admin / Teacher: Get recordings
router.get('/all', authorizeRoles(['admin', 'academic', 'teacher']), getAllRecordings);
router.get('/', authorizeRoles(['admin', 'academic', 'teacher']), getAllRecordings);

// 4. Playback stream URL: Secure 2-hour signed URL for video player
router.get('/:id/stream', authorizeRoles(['admin', 'academic', 'teacher', 'student']), getRecordingStreamUrl);

// 5. Upload Recorded Video directly into Supabase Storage Bucket
router.post('/:id/upload', authorizeRoles(['admin', 'academic', 'teacher']), upload.single('video'), uploadClassRecording);

module.exports = router;
