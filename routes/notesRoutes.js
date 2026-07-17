const express = require("express");
const authenticate = require("../config/authMiddleware.js");
const {
    createNote,
    getNotes,
    getNoteById,
    updateNote,
    deleteNote
} = require("../controllers/notesController.js");

const router = express.Router();

router.post("/", authenticate("teacher"), createNote);
router.get("/", authenticate("teacher"), getNotes);
router.get("/:id", authenticate("teacher"), getNoteById);
router.put("/:id", authenticate("teacher"), updateNote);
router.delete("/:id", authenticate("teacher"), deleteNote);

module.exports = router;
