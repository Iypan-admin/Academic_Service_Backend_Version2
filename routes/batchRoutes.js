const express = require("express");
const { 
    createBatch, 
    getBatches, 
    getBatchById, 
    updateBatch, 
    deleteBatch, 
    approveStudent,
    updateStudentBatch,
    getPendingBatches,
    approveBatch,
    rejectBatch,
    // Batch Request Management Functions
    createBatchRequest,
    getBatchRequestsForState,
    getBatchRequestsForAcademic,
    approveBatchRequest,
    rejectBatchRequest,
    createBatchFromRequest,
    // Batch Start + Attendance Functions
    startBatch,
    completeBatch,
    getStartedBatches,
    // Batch Merge Functions
    getBatchesForMerge,
    createMergeGroup,
    getMergeGroups,
    deleteMergeGroup
} = require("../controllers/batchController.js");
const authenticate = require("../config/authMiddleware.js");

const router = express.Router();

// Create batch routes (Academic, Manager, Admin, Center)
router.post("/", authenticate(["academic", "manager", "admin", "center"]), createBatch);

// Get batches routes (Academic, Manager, Admin)
router.get("/", authenticate(["academic", "manager", "admin"]), getBatches);
router.get("/:id", authenticate(["academic", "manager", "admin", "teacher"]), getBatchById);

// Student enrollment routes (Academic only)
router.post("/approve", authenticate("academic"), approveStudent);
router.put("/update-student-batch", authenticate("academic"), updateStudentBatch);

// Batch approval workflow routes (Manager and Admin only) - MUST come before /:id routes
router.get("/pending", authenticate(["manager", "admin"]), getPendingBatches);
router.put("/:id/approve", authenticate(["manager", "admin"]), approveBatch);
router.put("/:id/reject", authenticate(["manager", "admin"]), rejectBatch);

// Update batch routes (Academic, Manager, Admin)
router.put("/:id", authenticate(["academic", "manager", "admin"]), updateBatch);

// Delete batch routes (Admin only)
router.delete("/:id", authenticate("admin"), deleteBatch);

// ==================== BATCH START + ATTENDANCE ROUTES ====================


// ==================== BATCH REQUEST ROUTES ====================

// Batch request routes
router.post("/requests/create", authenticate(["center"]), createBatchRequest);
router.get("/requests/state", authenticate(["state"]), getBatchRequestsForState);
router.get("/requests/academic", authenticate(["academic"]), getBatchRequestsForAcademic);
router.post("/requests/:id/approve", authenticate(["state"]), approveBatchRequest);
router.post("/requests/:id/reject", authenticate(["state", "academic"]), rejectBatchRequest);
router.post("/requests/:id/create-batch", authenticate(["academic"]), createBatchFromRequest);

// Batch Start + Attendance Routes
router.post("/:id/start", authenticate(["academic", "manager", "admin"]), startBatch);
router.post("/:id/complete", authenticate(["academic", "manager", "admin"]), completeBatch);
router.get("/started/list", authenticate(), getStartedBatches);

// ==================== BATCH MERGE ROUTES ====================

// Get eligible batches for merging (Academic Admin only)
router.get("/merge/eligible", authenticate(["academic"]), getBatchesForMerge);

// Create a new merge group (Academic Admin only)
router.post("/merge/create", authenticate(["academic"]), createMergeGroup);

// Get all merge groups (Academic Admin and Teachers)
router.get("/merge/list", authenticate(["academic", "teacher"]), getMergeGroups);

// Delete merge group (Academic Admin only)
router.delete("/merge/:merge_group_id", authenticate(["academic"]), deleteMergeGroup);

module.exports = router;


