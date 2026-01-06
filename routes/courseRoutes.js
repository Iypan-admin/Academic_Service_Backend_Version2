const express = require("express");
const { createCourse, updateCourse, deleteCourse } = require("../controllers/courseController.js");
const authenticate = require("../config/authMiddleware.js");

const router = express.Router();

router.post("/", authenticate("manager"), createCourse);
router.put("/:id", authenticate("manager"), updateCourse);
router.delete("/:id", authenticate("manager"), deleteCourse);

module.exports = router;