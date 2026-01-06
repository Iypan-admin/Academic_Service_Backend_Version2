const express = require("express");
const authenticate = require("../config/authMiddleware.js");
const writingUpload = require("../middleware/writingUpload.js");
const { writingSubmissionUpload } = require("../middleware/writingUpload.js");
const optionalWritingUpload = require("../middleware/optionalWritingUpload.js");
const {
    uploadWritingTask,
    getWritingByCourse,
    getWritingByBatch,
    markWritingComplete,
    getStudentWriting,
    submitWritingSubmission,
    getWritingSubmissions,
    addWritingFeedback,
    deleteWritingSession
} = require("../controllers/lsrwController.js");

const router = express.Router();

// Resource Manager routes - Upload writing task
router.post("/upload", authenticate("resource_manager"), writingUpload, uploadWritingTask);

// Get writing tasks by course (Resource Manager)
router.get("/byCourse/:course_id", authenticate("resource_manager"), getWritingByCourse);

// Delete writing session (delete entire session with all files)
router.delete("/session/:id", authenticate("resource_manager"), deleteWritingSession);

// Teacher routes - Get batch writing tasks
router.get("/batch/:batch_id", authenticate("teacher"), getWritingByBatch);

// Teacher routes - Mark task as read/completed
router.put("/complete/:mapping_id", authenticate("teacher"), markWritingComplete);

// Teacher routes - Get student submissions for review
router.get("/batch/:batch_id/submissions", authenticate("teacher"), getWritingSubmissions);

// Teacher routes - Add/Update feedback for writing submission
router.post("/feedback", authenticate("teacher"), optionalWritingUpload, addWritingFeedback);

// Student routes - Get visible writing tasks
router.get("/student/:batch_id", authenticate("student"), getStudentWriting);

// Student routes - Submit writing (upload image)
router.post("/submit", authenticate("student"), writingSubmissionUpload, submitWritingSubmission);

module.exports = router;






