const express = require("express");
const authorizeRoles = require("../config/multiRoleAuth.js");
const {
    createNote,
    getNotes,
    getNoteById,
    updateNote,
    deleteNote
} = require("../controllers/notesController.js");

const router = express.Router();

router.post("/", authorizeRoles(["teacher", "academic", "admin", "manager"]), createNote);
router.get("/", authorizeRoles(["teacher", "academic", "admin", "manager", "student"]), getNotes);
router.get("/:id", authorizeRoles(["teacher", "academic", "admin", "manager", "student"]), getNoteById);
router.put("/:id", authorizeRoles(["teacher", "academic", "admin", "manager"]), updateNote);
router.delete("/:id", authorizeRoles(["teacher", "academic", "admin", "manager"]), deleteNote);

module.exports = router;
