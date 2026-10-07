const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const batchRoutes = require("./routes/batchRoutes.js");
const notesRoutes = require("./routes/notesRoutes.js");
const gmeetRoutes = require("./routes/gmeetRoutes.js");
const courseRoutes = require("./routes/courseRoutes.js");  
const eventRoutes = require("./routes/eventRoutes.js");
const liveClassRoutes = require("./routes/liveClassRoutes.js");
const recordingRoutes = require("./routes/recordingRoutes.js");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    if (req.url.includes('/join-') || req.url.includes('/request-join') || req.url.includes('/admit') || req.url.includes('/live-classes')) {
        console.log(`[ACADEMIC_REQ] ${new Date().toISOString()} ${req.method} ${req.url}`);
    }
    next();
});

app.use("/api/batches", batchRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/gmeets", gmeetRoutes);
app.use("/api/courses", courseRoutes);  
app.use("/api/events", eventRoutes);
app.use("/api/live-classes", liveClassRoutes);
app.use("/api/recordings", recordingRoutes);

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

