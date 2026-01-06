const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const batchRoutes = require("./routes/batchRoutes.js");
const notesRoutes = require("./routes/notesRoutes.js");
const gmeetRoutes = require("./routes/gmeetRoutes.js");
const courseRoutes = require("./routes/courseRoutes.js");
const courseFeesRoutes = require("./routes/courseFeesRoutes.js");
const attendanceRoutes = require("./routes/attendanceRoutes.js");
const eventRoutes = require("./routes/eventRoutes.js");
const lsrwRoutes = require("./routes/lsrwRoutes.js");
const speakingRoutes = require("./routes/speakingRoutes.js");
const readingRoutes = require("./routes/readingRoutes.js");
const writingRoutes = require("./routes/writingRoutes.js");

dotenv.config();

const app = express();
app.use(cors());
// Only parse JSON for non-multipart requests
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use("/api/batches", batchRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/gmeets", gmeetRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/course-fees", courseFeesRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/lsrw", lsrwRoutes);
app.use("/api/speaking", speakingRoutes);
app.use("/api/reading", readingRoutes);
app.use("/api/writing", writingRoutes);

// Student-specific routes
app.use("/api/classes", require("./routes/studentClassRoutes.js"));

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
