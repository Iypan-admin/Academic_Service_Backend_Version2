const express = require("express");
const jwt = require("jwt-simple");
const {
    getEventsByDateRange,
    getUpcomingEvents,
    getAllEvents,
    createEvent,
    updateEvent,
    deleteEvent
} = require("../controllers/eventController.js");

const router = express.Router();

// Middleware to extract token user if available, without blocking read requests
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(" ")[1];
        if (token) {
            try {
                const decoded = jwt.decode(token, process.env.SECRET_KEY);
                req.user = decoded;
            } catch (e) {
                // Ignore token errors for optional auth
            }
        }
    }
    next();
};

const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Access Denied. No Token Provided." });
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access Denied. Token is missing." });
    try {
        const decoded = jwt.decode(token, process.env.SECRET_KEY);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(400).json({ error: "Invalid Token", details: error.message });
    }
};

// Event routes
router.get("/range", optionalAuth, getEventsByDateRange);
router.get("/upcoming", optionalAuth, getUpcomingEvents);
router.get("/", optionalAuth, getAllEvents);
router.post("/", requireAuth, createEvent);
router.put("/:id", requireAuth, updateEvent);
router.delete("/:id", requireAuth, deleteEvent);

module.exports = router;
