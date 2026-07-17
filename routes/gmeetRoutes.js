const express = require("express");
const  authenticate = require("../config/authMiddleware.js");
const {
    createGMeet,
    getGMeetsByBatch,
    getGMeetById,
    updateGMeet,
    deleteGMeet
} = require("../controllers/gmeetController");

const router = express.Router();

router.post("/", authenticate("teacher"), createGMeet);
router.get("/:batch_id", authenticate("teacher"), getGMeetsByBatch);
router.get("/meet/:meet_id", authenticate("teacher"), getGMeetById);
router.put("/:meet_id", authenticate("teacher"), updateGMeet);
router.delete("/:meet_id", authenticate("teacher"), deleteGMeet);

module.exports = router;
