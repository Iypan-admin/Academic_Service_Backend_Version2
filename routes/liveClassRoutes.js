const express = require('express');
const router = express.Router();
const authorizeRoles = require('../config/multiRoleAuth');
const {
    scheduleLiveClass,
    getLiveClasses,
    getLiveClassById,
    startLiveClass,
    joinLiveClass,
    endLiveClass,
    updateLiveClass,
    deleteLiveClass,
    requestJoinClass,
    getJoinStatus,
    getJoinRequests,
    admitStudent,
    admitAllStudents,
    rejectStudent,
    checkScheduleConflictEndpoint,
    resetLiveClassTimer
} = require('../controllers/liveClassController');

// 1. Academic Manager / Admin / Teacher / Student view classes
router.get('/', authorizeRoles(['admin', 'academic', 'teacher', 'student', 'center', 'state']), getLiveClasses);
router.get('/:id', authorizeRoles(['admin', 'academic', 'teacher', 'student']), getLiveClassById);

// 2. Academic Manager & Admin: Schedule, Edit, Delete, Check Conflict
router.post('/schedule', authorizeRoles(['admin', 'academic']), scheduleLiveClass);
router.post('/check-conflict', authorizeRoles(['admin', 'academic']), checkScheduleConflictEndpoint);
router.put('/:id', authorizeRoles(['admin', 'academic']), updateLiveClass);
router.delete('/:id', authorizeRoles(['admin', 'academic']), deleteLiveClass);

// 3. Tutor Actions: Start, End, Reset Timer
router.post('/:id/start', authorizeRoles(['admin', 'academic', 'teacher']), startLiveClass);
router.post('/:id/end', authorizeRoles(['admin', 'academic', 'teacher']), endLiveClass);
router.post('/:id/reset-timer', authorizeRoles(['admin', 'academic', 'teacher']), resetLiveClassTimer);

// 4. Join Class: Student, Tutor, Academic Manager
router.post('/:id/join', authorizeRoles(['admin', 'academic', 'teacher', 'student']), joinLiveClass);

// 5. Admissions & Waiting Room (Student Knock & Tutor Approval)
router.post('/:id/request-join', authorizeRoles(['admin', 'academic', 'teacher', 'student']), requestJoinClass);
router.get('/:id/join-status', authorizeRoles(['admin', 'academic', 'teacher', 'student']), getJoinStatus);
router.get('/:id/join-requests', authorizeRoles(['admin', 'academic', 'teacher']), getJoinRequests);
router.post('/:id/admit-student', authorizeRoles(['admin', 'academic', 'teacher']), admitStudent);
router.post('/:id/admit-all', authorizeRoles(['admin', 'academic', 'teacher']), admitAllStudents);
router.post('/:id/reject-student', authorizeRoles(['admin', 'academic', 'teacher']), rejectStudent);

module.exports = router;
