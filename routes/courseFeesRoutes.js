const express = require("express");
const {
    getAllCourseFees,
    getCourseFeeById,
    createCourseFee,
    updateCourseFee,
    deleteCourseFee
} = require("../controllers/courseFeesController.js");
const authenticate = require("../config/authMiddleware.js");

const router = express.Router();

// Get all course fees
router.get("/", authenticate("manager"), getAllCourseFees);

// Get course fee by ID
router.get("/:id", authenticate("manager"), getCourseFeeById);

// Create new course fee
router.post("/", authenticate("manager"), createCourseFee);

// Update course fee
router.put("/:id", authenticate("manager"), updateCourseFee);

// Delete course fee
router.delete("/:id", authenticate("manager"), deleteCourseFee);

module.exports = router;

