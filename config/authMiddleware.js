const jwt = require("jwt-simple");
const dotenv = require("dotenv");

dotenv.config();

const authenticate = (requiredRole) => {
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
            if (!process.env.SECRET_KEY) {
                throw new Error("SECRET_KEY is missing in environment variables.");
            }

            const decoded = jwt.decode(token, process.env.SECRET_KEY);

            if (decoded.role !== requiredRole) {
                return res.status(403).json({ error: `Access Denied. Only ${requiredRole}s are allowed.` });
            }

            req.user = decoded;
            next();
        } catch (error) {
            return res.status(400).json({ error: "Invalid Token", details: error.message });
        }
    };
};

// ✅ Correct export (not { authenticate })
module.exports = authenticate;
