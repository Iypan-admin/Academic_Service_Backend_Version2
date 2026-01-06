const supabase = require('../config/supabase');

// =====================================================
// EVENT CONTROLLER - Role-Based Event Management
// =====================================================
// 
// 🎯 PERMISSIONS:
// - Academic Admin & Admin: Full CRUD access
// - Other roles: Read-only access
// - Students: No access (handled in frontend)
// =====================================================

// =====================================================
// 1. GET ALL EVENTS (with role-based filtering)
// =====================================================
const getAllEvents = async (req, res) => {
    try {
        const { start_date, end_date, event_type, status } = req.query;
        const userRole = req.user.role;
        const userId = req.user.id;

        // Build query based on role
        let query = supabase
            .from('academic_events')
            .select(`
                id,
                title,
                description,
                event_type,
                event_start_date,
                event_end_date,
                event_start_time,
                event_end_time,
                created_by,
                updated_by,
                status,
                created_at,
                updated_at
            `);

        // Role-based field selection
        if (userRole !== 'academic' && userRole !== 'admin') {
            // Other roles get limited fields (read-only)
            query = supabase
                .from('academic_events')
                .select(`
                    id,
                    title,
                    description,
                    event_type,
                    event_start_date,
                    event_end_date,
                    event_start_time,
                    event_end_time,
                    status
                `);
        }

        // Apply filters
        if (start_date && end_date) {
            query = query.gte('event_start_date', start_date).lte('event_start_date', end_date);
        }

        if (event_type) {
            query = query.eq('event_type', event_type);
        }

        if (status) {
            query = query.eq('status', status);
        } else {
            // Default to active events only
            query = query.eq('status', 'active');
        }

        // Order by date and time
        query = query.order('event_start_date', { ascending: true })
                    .order('event_start_time', { ascending: true });

        const { data, error } = await query;

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch events',
                details: error.message 
            });
        }

        res.json({
            success: true,
            data: data || [],
            count: data?.length || 0,
            role: userRole
        });

    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// 2. GET EVENT BY ID
// =====================================================
const getEventById = async (req, res) => {
    try {
        const { id } = req.params;
        const userRole = req.user.role;

        let query = supabase
            .from('academic_events')
            .select('*')
            .eq('id', id)
            .eq('status', 'active')
            .single();

        const { data, error } = await query;

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Event not found' 
                });
            }
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch event',
                details: error.message 
            });
        }

        // Filter fields for non-academic/admin roles
        if (userRole !== 'academic' && userRole !== 'admin' && data) {
            const { created_by, updated_by, created_at, updated_at, ...filteredData } = data;
            return res.json({
                success: true,
                data: filteredData
            });
        }

        res.json({
            success: true,
            data: data
        });

    } catch (error) {
        console.error('Get event by ID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// 3. CREATE EVENT (Academic Admin only)
// =====================================================
const createEvent = async (req, res) => {
    try {
        console.log('Create event request received:', req.body);
        console.log('User info:', req.user);
        
        const userRole = req.user.role;
        const userId = req.user.id;

        // Check if user has permission to create events
        if (userRole !== 'academic' && userRole !== 'admin') {
            console.log('Access denied for role:', userRole);
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Only Academic Admin and Admin can create events.' 
            });
        }

        const {
            title,
            description,
            event_type = 'general',
            event_start_date,
            event_end_date,
            event_start_time,
            event_end_time
        } = req.body;

        // Validation
        if (!title || !event_start_date) {
            return res.status(400).json({ 
                success: false, 
                error: 'Title and event start date are required' 
            });
        }

        // Validate date
        const eventDate = new Date(event_start_date);
        if (eventDate < new Date().setHours(0, 0, 0, 0)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Event start date cannot be in the past' 
            });
        }

        // Validate time range
        if (event_start_time && event_end_time && event_start_time >= event_end_time) {
            return res.status(400).json({ 
                success: false, 
                error: 'End time must be after start time' 
            });
        }

        // Validate end date
        if (event_end_date && new Date(event_end_date) < new Date(event_start_date)) {
            return res.status(400).json({ 
                success: false, 
                error: 'End date must be on or after start date' 
            });
        }

        const eventData = {
            title,
            description,
            event_type,
            event_start_date,
            event_end_date,
            event_start_time,
            event_end_time,
            status: 'active',
            created_by: userId
        };

        console.log('Event data to insert:', eventData);

        const { data, error } = await supabase
            .from('academic_events')
            .insert([eventData])
            .select()
            .single();

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to create event',
                details: error.message 
            });
        }

        res.status(201).json({
            success: true,
            message: 'Event created successfully',
            data: data
        });

    } catch (error) {
        console.error('Create event error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// 4. UPDATE EVENT (Academic Admin only)
// =====================================================
const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const userRole = req.user.role;
        const userId = req.user.id;

        // Check if user has permission to update events
        if (userRole !== 'academic' && userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Only Academic Admin and Admin can update events.' 
            });
        }

        const {
            title,
            description,
            event_type,
            event_start_date,
            event_end_date,
            event_start_time,
            event_end_time,
            status
        } = req.body;

        // Check if event exists
        const { data: existingEvent, error: fetchError } = await supabase
            .from('academic_events')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !existingEvent) {
            return res.status(404).json({ 
                success: false, 
                error: 'Event not found' 
            });
        }

        // Build update data
        const updateData = {
            updated_by: userId,
            updated_at: new Date().toISOString()
        };

        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (event_type !== undefined) updateData.event_type = event_type;
        if (event_start_date !== undefined) updateData.event_start_date = event_start_date;
        if (event_end_date !== undefined) updateData.event_end_date = event_end_date;
        if (event_start_time !== undefined) updateData.event_start_time = event_start_time;
        if (event_end_time !== undefined) updateData.event_end_time = event_end_time;
        if (status !== undefined) updateData.status = status;

        const { data, error } = await supabase
            .from('academic_events')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update event',
                details: error.message 
            });
        }

        res.json({
            success: true,
            message: 'Event updated successfully',
            data: data
        });

    } catch (error) {
        console.error('Update event error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// 5. DELETE EVENT (Academic Admin only)
// =====================================================
const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const userRole = req.user.role;

        // Check if user has permission to delete events
        if (userRole !== 'academic' && userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Only Academic Admin and Admin can delete events.' 
            });
        }

        // Check if event exists
        const { data: existingEvent, error: fetchError } = await supabase
            .from('academic_events')
            .select('id, title')
            .eq('id', id)
            .single();

        if (fetchError || !existingEvent) {
            return res.status(404).json({ 
                success: false, 
                error: 'Event not found' 
            });
        }

        // Soft delete by updating status
        const { error } = await supabase
            .from('academic_events')
            .update({ 
                status: 'cancelled',
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to delete event',
                details: error.message 
            });
        }

        res.json({
            success: true,
            message: 'Event deleted successfully'
        });

    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// 6. GET EVENTS BY DATE RANGE (for calendar views)
// =====================================================
const getEventsByDateRange = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const userRole = req.user.role;

        if (!start_date || !end_date) {
            return res.status(400).json({ 
                success: false, 
                error: 'Start date and end date are required' 
            });
        }

        let query = supabase
            .from('academic_events')
            .select(`
                id,
                title,
                description,
                event_type,
                event_start_date,
                event_end_date,
                event_start_time,
                event_end_time,
                status
            `)
            .gte('event_start_date', start_date)
            .lte('event_start_date', end_date)
            .eq('status', 'active')
            .order('event_start_date', { ascending: true })
            .order('event_start_time', { ascending: true });

        const { data, error } = await query;

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch events',
                details: error.message 
            });
        }

        // Filter out expired events (events that have passed their end date)
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const filteredData = (data || []).filter(event => {
            // If event has an end_date, check if it's not expired
            if (event.event_end_date) {
                return event.event_end_date >= todayStr;
            }
            // If no end_date, check if start_date is not expired
            return event.event_start_date >= todayStr;
        });

        res.json({
            success: true,
            data: filteredData,
            count: filteredData.length,
            date_range: { start_date, end_date }
        });

    } catch (error) {
        console.error('Get events by date range error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// 7. GET UPCOMING EVENTS (for dashboard widgets)
// =====================================================
const getUpcomingEvents = async (req, res) => {
    try {
        const { limit = 5 } = req.query;
        const userRole = req.user ? req.user.role : 'public';

        // Check if Supabase is configured
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
            console.error('Supabase configuration missing: SUPABASE_URL or SUPABASE_KEY not set');
            return res.status(500).json({ 
                success: false, 
                error: 'Database configuration error',
                details: 'Supabase credentials are not configured. Please check your environment variables.'
            });
        }

        // Use local date to avoid timezone issues
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        let query = supabase
            .from('academic_events')
            .select(`
                id,
                title,
                description,
                event_type,
                event_start_date,
                event_end_date,
                event_start_time,
                event_end_time,
                status
            `)
            .gte('event_start_date', todayStr)
            .eq('status', 'active')
            .order('event_start_date', { ascending: true })
            .order('event_start_time', { ascending: true })
            .limit(parseInt(limit));

        const { data, error } = await query;

        if (error) {
            // Check if it's a network/connection error
            const errorMessage = error.message || String(error);
            const isNetworkError = errorMessage.includes('fetch failed') || 
                                 errorMessage.includes('ECONNREFUSED') ||
                                 errorMessage.includes('ENOTFOUND') ||
                                 errorMessage.includes('network');

            console.error('Database error:', {
                message: errorMessage,
                details: error.details || errorMessage,
                hint: error.hint || (isNetworkError ? 'Check your network connection and Supabase URL' : ''),
                code: error.code || ''
            });

            return res.status(500).json({ 
                success: false, 
                error: isNetworkError ? 'Database connection failed' : 'Failed to fetch upcoming events',
                details: errorMessage,
                hint: isNetworkError ? 'Please check your network connection and ensure Supabase is accessible' : undefined
            });
        }

        // Filter out expired events (events that have passed their end date)
        const filteredData = (data || []).filter(event => {
            // If event has an end_date, check if it's not expired
            if (event.event_end_date) {
                return event.event_end_date >= todayStr;
            }
            // If no end_date, check if start_date is not expired
            return event.event_start_date >= todayStr;
        });

        res.json({
            success: true,
            data: filteredData,
            count: filteredData.length
        });

    } catch (error) {
        // Handle network errors and other exceptions
        const errorMessage = error.message || String(error);
        const isNetworkError = errorMessage.includes('fetch failed') || 
                             errorMessage.includes('ECONNREFUSED') ||
                             errorMessage.includes('ENOTFOUND') ||
                             errorMessage.includes('network');

        console.error('Get upcoming events error:', {
            message: errorMessage,
            details: error.stack || errorMessage,
            hint: isNetworkError ? 'Check your network connection and Supabase configuration' : '',
            code: error.code || ''
        });

        res.status(500).json({ 
            success: false, 
            error: isNetworkError ? 'Database connection failed' : 'Internal server error',
            details: errorMessage,
            hint: isNetworkError ? 'Please verify your Supabase URL and network connectivity' : undefined
        });
    }
};

// =====================================================
// 8. GET EVENT STATISTICS (Academic Admin only)
// =====================================================
const getEventStatistics = async (req, res) => {
    try {
        const userRole = req.user.role;

        // Check if user has permission to view statistics
        if (userRole !== 'academic' && userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Only Academic Admin and Admin can view event statistics.' 
            });
        }

        const { data: stats, error } = await supabase
            .from('academic_events')
            .select('event_type, status, event_start_date')
            .eq('status', 'active');

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch event statistics',
                details: error.message 
            });
        }

        // Calculate statistics
        const statistics = {
            total_events: stats.length,
            by_type: {},
            upcoming_this_week: 0,
            upcoming_this_month: 0
        };

        const today = new Date();
        const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        const monthFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

        stats.forEach(event => {
            // Count by type
            statistics.by_type[event.event_type] = (statistics.by_type[event.event_type] || 0) + 1;
            
            // Count upcoming events
            const eventDate = new Date(event.event_start_date);
            if (eventDate >= today && eventDate <= weekFromNow) {
                statistics.upcoming_this_week++;
            }
            if (eventDate >= today && eventDate <= monthFromNow) {
                statistics.upcoming_this_month++;
            }
        });

        res.json({
            success: true,
            data: statistics
        });

    } catch (error) {
        console.error('Get event statistics error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// =====================================================
// TEST ENDPOINT - Database Connection Test
// =====================================================
const testDatabaseConnection = async (req, res) => {
    try {
        console.log('Testing database connection...');
        
        // Test basic Supabase connection
        const { data, error } = await supabase
            .from('academic_events')
            .select('count(*)')
            .limit(1);

        if (error) {
            console.error('Database connection test failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Database connection failed',
                details: error.message
            });
        }

        console.log('Database connection test successful');
        res.json({
            success: true,
            message: 'Database connection successful',
            data: data
        });

    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            success: false,
            error: 'Database test failed',
            details: error.message
        });
    }
};

module.exports = {
    getAllEvents,
    getEventById,
    createEvent,
    updateEvent,
    deleteEvent,
    getEventsByDateRange,
    getUpcomingEvents,
    getEventStatistics,
    testDatabaseConnection
};
