const express = require("express");
const  authenticate = require("../config/authMiddleware.js");
const {
    createGMeet,
    getGMeetsByBatch,
    getGMeetById,
    updateGMeet,
    deleteGMeet,
    getTodayLiveClasses,
    getAllClasses
} = require("../controllers/gmeetController");

const router = express.Router();

router.post("/", authenticate(["teacher", "academic", "admin", "manager"]), createGMeet);
router.get("/today/live", authenticate(["admin", "manager", "academic"]), getTodayLiveClasses);
router.get("/all", authenticate(["admin", "manager", "academic"]), getAllClasses);
router.get("/:batch_id", authenticate(["teacher", "academic", "admin", "manager"]), getGMeetsByBatch);
router.get("/meet/:meet_id", authenticate(["teacher", "academic", "admin", "manager"]), getGMeetById);
router.put("/:meet_id", authenticate(["teacher", "academic", "admin", "manager"]), updateGMeet);
router.delete("/:meet_id", authenticate(["teacher", "academic", "admin", "manager"]), deleteGMeet);

module.exports = router;
