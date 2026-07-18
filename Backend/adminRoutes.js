const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// AUTHENTICATION GUARD MIDDLEWARE
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Access Denied: Administrative token missing." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Session expired or invalid token structure." });
        }
        req.user = user;
        next();
    });
}

// Accept Supabase from the main server file
module.exports = function(supabase) {

    // ==========================================================================
    // ADMIN LOGIN ENDPOINT
    // ==========================================================================
    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        const envUser = process.env.ADMIN_USERNAME;
        const envPass = process.env.ADMIN_PASSWORD;

        if (username && password && username === envUser && password === envPass) {
            const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '2h' });
            return res.json({ success: true, token });
        }
        return res.status(401).json({ error: "Invalid console control credentials." });
    });

    // ==========================================================================
    // SESSIONS LIST PIPELINE
    // ==========================================================================
    router.get('/sessions', authenticateAdmin, async (req, res) => {
        try {
            const { data: sessions, error } = await supabase
                .from('chat_sessions')
                .select('*')
                .order('updated_at', { ascending: false });

            if (error) throw error;
            res.json(sessions);
        } catch (error) {
            console.error("Session pull error:", error);
            res.status(500).json({ error: "Failed to pull operational sessions." });
        }
    });

    // ==========================================================================
    // TAKEOVER INTERCEPT ROUTE
    // ==========================================================================
    router.post('/takeover', authenticateAdmin, async (req, res) => {
        try {
            const { sessionId, isHumanActive } = req.body;
            if (!sessionId) return res.status(400).json({ error: "Missing tracking parameters." });

            const { data, error } = await supabase
                .from('chat_sessions')
                .update({ is_human_agent: isHumanActive, updated_at: new Date() })
                .eq('id', sessionId)
                .select()
                .single();

            if (error) throw error;
            res.json({ success: true, is_human_agent: data.is_human_agent });
        } catch (error) {
            console.error("Takeover modification error:", error);
            res.status(500).json({ error: "Failure modifying takeover configurations." });
        }
    });

    // ==========================================================================
    // CHAT HISTORY PIPELINE
    // ==========================================================================
    router.get('/messages/:sessionId', authenticateAdmin, async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { data: messages, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            res.json(messages || []);
        } catch (error) {
            console.error("History fetch crash:", error);
            res.status(500).json({ error: "Failed to pull message history." });
        }
    });

    // ==========================================================================
    // INJECT LIVE TRANSMISSION ROUTE
    // ==========================================================================
    router.post('/message', authenticateAdmin, async (req, res) => {
        try {
            const { message, sessionId } = req.body;
            if (!sessionId || !message) return res.status(400).json({ error: "Missing payload data." });

            const { data, error } = await supabase
                .from('chat_messages')
                .insert([{ session_id: sessionId, sender: 'me', message: message }])
                .select()
                .single();

            if (error) throw error;

            await supabase
                .from('chat_sessions')
                .update({ updated_at: new Date() })
                .eq('id', sessionId);

            res.json({ success: true, message: data });
        } catch (error) {
            console.error("Admin post message execution failed:", error);
            res.status(500).json({ error: "Failed to log admin transmission." });
        }
    });

    return router;
};