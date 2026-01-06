const express = require("express");
const {
    createAttendanceSession,
    getBatchAttendance,
    updateAttendanceRecord,
    debugTeacherAssignment
} = require("../controllers/attendanceController.js");
const authenticate = require("../config/authMiddleware.js");

const router = express.Router();

// Create attendance session (Teacher only)
router.post("/sessions", authenticate(["teacher"]), createAttendanceSession);

// Get attendance data for a batch (Role-based access)
router.get("/batch/:id", authenticate(["academic", "manager", "admin", "teacher"]), getBatchAttendance);

// Update individual attendance record (Teacher only)
router.put("/records/:id", authenticate(["teacher"]), updateAttendanceRecord);

// Debug endpoint to check teacher assignment
router.get("/debug/:batchId", authenticate(["academic", "manager", "admin", "teacher"]), debugTeacherAssignment);

module.exports = router;
