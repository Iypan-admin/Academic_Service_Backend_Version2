const express = require("express");
const authenticate = require("../config/authMiddleware.js");
const upload = require("../middleware/upload.js");
const {
    createNote,
    getNotes,
    getNoteById,
    updateNote,
    deleteNote
} = require("../controllers/notesController.js");

const router = express.Router();

// Use multer middleware for file uploads (accept multiple files)
router.post("/", authenticate("teacher"), upload.array('files', 10), createNote);
router.get("/", authenticate("teacher"), getNotes);
router.get("/:id", authenticate("teacher"), getNoteById);
router.put("/:id", authenticate("teacher"), updateNote);
router.delete("/:id", authenticate("teacher"), deleteNote);

module.exports = router;
