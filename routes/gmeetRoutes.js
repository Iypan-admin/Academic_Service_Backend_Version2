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

router.post("/", authenticate(["teacher", "academic"]), createGMeet);
router.get("/today/live", authenticate(["admin", "manager", "academic"]), getTodayLiveClasses);
router.get("/all", authenticate(["admin", "manager", "academic"]), getAllClasses);
router.get("/:batch_id", authenticate(["teacher", "academic"]), getGMeetsByBatch);
router.get("/meet/:meet_id", authenticate(["teacher", "academic"]), getGMeetById);
router.put("/:meet_id", authenticate(["teacher", "academic"]), updateGMeet);
router.delete("/:meet_id", authenticate(["teacher", "academic"]), deleteGMeet);

module.exports = router;
