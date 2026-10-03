const jwt = require("jwt-simple");
const dotenv = require("dotenv");
dotenv.config();

/**
 * Flexible middleware that allows one or more roles
 * Usage: authorizeRoles(['admin', 'academic', 'teacher'])
 */
const authorizeRoles = (allowedRoles = []) => {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ error: "Access Denied. No Token Provided." });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "Access Denied. Token is missing." });
        }

        try {
            const secret = process.env.SECRET_KEY;
            if (!secret) {
                throw new Error("SECRET_KEY is missing in environment variables.");
            }

            const decoded = jwt.decode(token, secret);
            const userRole = decoded.role || (decoded.student_id ? 'student' : null);

            if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
                return res.status(403).json({
                    error: `Access Denied. Allowed roles: ${allowedRoles.join(', ')}. Your role: ${userRole}`
                });
            }

            req.user = decoded;
            next();
        } catch (error) {
            return res.status(401).json({ error: "Invalid or expired token", details: error.message });
        }
    };
};

module.exports = authorizeRoles;
