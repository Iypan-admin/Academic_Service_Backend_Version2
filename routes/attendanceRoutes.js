const express = require('express');
const router = express.Router();
const authorizeRoles = require('../config/multiRoleAuth');
const {
    getBatchAttendance,
    createAttendanceSession,
    bulkUpdateAttendanceRecords,
    updateAttendanceRecord,
    getLiveClassAttendance,
    markLiveClassAttendance,
    getAcademicAttendanceOverview,
    getStudentBatchAttendance
} = require('../controllers/attendanceController');

// 1. Academic Manager & Admin Overview (Batches overview & filters)
router.get('/academic/overview', authorizeRoles(['admin', 'academic', 'teacher']), getAcademicAttendanceOverview);

// 2. Batch Attendance (Sessions & Enrolled Student Records)
router.get('/batch/:batchId', authorizeRoles(['admin', 'academic', 'teacher']), getBatchAttendance);

// 3. Create Attendance Session
router.post('/sessions', authorizeRoles(['admin', 'academic', 'teacher']), createAttendanceSession);

// 4. Update Records
router.post('/records/bulk-update', authorizeRoles(['admin', 'academic', 'teacher']), bulkUpdateAttendanceRecords);
router.put('/records/:recordId', authorizeRoles(['admin', 'academic', 'teacher']), updateAttendanceRecord);

// 5. Live Class Attendance (From Live Studio)
router.get('/live-class/:liveClassId', authorizeRoles(['admin', 'academic', 'teacher']), getLiveClassAttendance);
router.post('/live-class/:liveClassId/mark', authorizeRoles(['admin', 'academic', 'teacher']), markLiveClassAttendance);

// 6. Student View (Batch Attendance History)
router.get('/student/batch/:batchId', authorizeRoles(['admin', 'academic', 'teacher', 'student']), getStudentBatchAttendance);

module.exports = router;
