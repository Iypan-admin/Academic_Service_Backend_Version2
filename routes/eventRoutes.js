const express = require('express');
const router = express.Router();
const authenticate = require('../config/authMiddleware');
const {
    getAllEvents,
    getEventById,
    createEvent,
    updateEvent,
    deleteEvent,
    getEventsByDateRange,
    getUpcomingEvents,
    getEventStatistics,
    testDatabaseConnection
} = require('../controllers/eventController');

// =====================================================
// EVENT ROUTES - Role-Based Event Management
// =====================================================
// 
// 🎯 ROLE PERMISSIONS:
// - Academic Admin & Admin: Full CRUD access (all routes)
// - Other roles: Read-only access (GET routes only)
// - Students: No access (handled in frontend routing)
// =====================================================

// =====================================================
// PUBLIC ROUTES (No authentication required)
// =====================================================

// GET /api/events/public/upcoming - Get upcoming events (public access)
router.get('/public/upcoming', getUpcomingEvents);

// =====================================================
// AUTHENTICATED ROUTES (All authenticated users)
// =====================================================

// GET /api/events - Get all events (with role-based filtering)
router.get('/', authenticate(), getAllEvents);

// GET /api/events/upcoming - Get upcoming events (for dashboard widgets)
router.get('/upcoming', authenticate(), getUpcomingEvents);

// GET /api/events/range - Get events by date range (for calendar views)
router.get('/range', authenticate(), getEventsByDateRange);

// GET /api/events/:id - Get event by ID
router.get('/:id', authenticate(), getEventById);

// =====================================================
// ACADEMIC ADMIN & ADMIN ROUTES
// =====================================================

// POST /api/events - Create new event (Academic Admin & Admin only)
router.post('/', authenticate(['academic', 'admin']), createEvent);

// PUT /api/events/:id - Update event (Academic Admin & Admin only)
router.put('/:id', authenticate(['academic', 'admin']), updateEvent);

// DELETE /api/events/:id - Delete event (Academic Admin & Admin only)
router.delete('/:id', authenticate(['academic', 'admin']), deleteEvent);

// GET /api/events/stats/statistics - Get event statistics (Academic Admin & Admin only)
router.get('/stats/statistics', authenticate(['academic', 'admin']), getEventStatistics);

// GET /api/events/test/database - Test database connection (for debugging)
router.get('/test/database', testDatabaseConnection);

// =====================================================
// ROUTE DOCUMENTATION
// =====================================================

/*
📋 EVENT API ENDPOINTS

🔹 PUBLIC ROUTES (All authenticated users):
GET    /api/events                    - Get all events (role-based filtering)
GET    /api/events/upcoming          - Get upcoming events (dashboard widget)
GET    /api/events/range             - Get events by date range (calendar)
GET    /api/events/:id               - Get specific event

🔹 ACADEMIC ADMIN & ADMIN ONLY:
POST   /api/events                   - Create new event
PUT    /api/events/:id               - Update event
DELETE /api/events/:id                - Delete event (soft delete)
GET    /api/events/stats/statistics  - Get event statistics

🔹 QUERY PARAMETERS:
- start_date, end_date: Date range filtering
- event_type: Filter by event type
- status: Filter by event status
- limit: Limit results (for upcoming events)

🔹 ROLE-BASED RESPONSES:
- Academic Admin & Admin: Full event data with all fields
- Other roles: Limited fields (read-only)
- Students: No access (frontend routing)

🔹 AUTHENTICATION:
- All routes require valid JWT token
- Academic Admin & Admin routes require 'academic' or 'admin' role
- Other routes accessible to all authenticated users

🔹 ERROR HANDLING:
- 401: Unauthorized (no token)
- 403: Forbidden (insufficient permissions)
- 404: Event not found
- 400: Bad request (validation errors)
- 500: Internal server error
*/

module.exports = router;
