const express = require("express");
const { 
    createBatch, 
    getBatches, 
    getBatchById, 
    updateBatch, 
    deleteBatch, 
    approveStudent,
    createBatchRequest,
    getBatchRequestsForState,
    getBatchRequestsForAcademic,
    approveBatchRequest,
    rejectBatchRequest,
    createBatchFromRequest,
    getEligibleBatchesForMerge,
    createMergeGroup,
    getMergeGroups,
    deleteMergeGroup,
    approveBatch,
    rejectBatch,
    startBatch,
    completeBatch,
    updateStudentBatch
} = require("../controllers/batchController.js");
const authenticate = require("../config/authMiddleware.js");
const jwt = require("jwt-simple");

const router = express.Router();

// Helper middleware for routes allowed for multiple roles
const authMultiple = (allowedRoles) => {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Access Denied. No Token Provided." });
        const token = authHeader.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Access Denied. Token is missing." });
        try {
            const decoded = jwt.decode(token, process.env.SECRET_KEY);
            if (!allowedRoles.includes(decoded.role)) {
                return res.status(403).json({ error: "Access Denied. Role not authorized." });
            }
            req.user = decoded;
            next();
        } catch (error) {
            return res.status(400).json({ error: "Invalid Token", details: error.message });
        }
    };
};

// Batch Merge endpoints (Must be declared BEFORE /:id to prevent route shadowing)
router.get("/merge/eligible", authenticate("academic"), getEligibleBatchesForMerge);
router.post("/merge/create", authenticate("academic"), createMergeGroup);
router.get("/merge/list", authenticate("academic"), getMergeGroups);
router.delete("/merge/:merge_group_id", authenticate("academic"), deleteMergeGroup);

// Batch Requests endpoints (Must be declared BEFORE /:id to prevent route shadowing)
router.post("/requests/create", authenticate("center"), createBatchRequest);
router.get("/requests/state", authenticate("state"), getBatchRequestsForState);
router.get("/requests/academic", authenticate("academic"), getBatchRequestsForAcademic);
router.post("/requests/:requestId/approve", authMultiple(["state", "academic"]), approveBatchRequest);
router.post("/requests/:requestId/reject", authMultiple(["state", "academic"]), rejectBatchRequest);
router.post("/requests/:requestId/create-batch", authenticate("academic"), createBatchFromRequest);

// Standard Batch endpoints
router.post("/", authenticate("academic"), createBatch);
router.get("/", authMultiple(["academic", "manager", "admin"]), getBatches);
router.put("/update-student-batch", authMultiple(["academic", "manager", "admin"]), updateStudentBatch);
router.put("/:id/approve", authMultiple(["admin", "manager"]), approveBatch);
router.put("/:id/reject", authMultiple(["admin", "manager"]), rejectBatch);
router.post("/:id/start", authMultiple(["admin", "manager", "academic"]), startBatch);
router.post("/:id/complete", authMultiple(["admin", "manager", "academic"]), completeBatch);
router.get("/:id", authMultiple(["academic", "manager", "admin", "teacher"]), getBatchById);
router.put("/:id", authenticate("academic"), updateBatch);
router.delete("/:id", authenticate("academic"), deleteBatch);
router.post("/approve", authenticate("academic"), approveStudent);

module.exports = router;


