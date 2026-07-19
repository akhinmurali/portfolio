require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================================
// CORE SYSTEM INITIALIZATION & MIDDLEWARE
// ==========================================================================
app.use(cors());
app.use(express.json());

// Initialize Administrative Supabase Client (Service Role Key bypasses RLS)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Initialize Groq AI SDK
const groq = new Groq({ apiKey: process.env.GROK_API_KEY });

// JWT Authentication Verification Middleware for Admin-Only Routes
function authenticateAdminToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <TOKEN>"

    if (!token) {
        return res.status(401).json({ error: "Access denied. Token missing." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Access token is invalid or expired." });
        }
        req.user = user;
        next();
    });
}

// ==========================================================================
// ⚡ STRATEGY B: PUBLIC CONFIG DISCOVERY CHANNEL
// ==========================================================================
app.get('/api/config', (req, res) => {
    // Safely deliver ONLY the public-facing keys to front-end WebSockets
    res.status(200).json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

// ==========================================================================
// CORE VISITORS CONVERSATION ROUTES
// ==========================================================================

// Handshake Endpoint: Generates a persistent user trace mapping state
app.post('/api/session/create', async (req, res) => {
    const { visitorName } = req.body;
    try {
        const { data, error } = await supabase
            .from('chat_sessions')
            .insert([{ 
                visitor_name: visitorName || 'Guest', 
                is_human_agent: false, 
                updated_at: new Date() 
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(200).json({ sessionId: data.id });
    } catch (err) {
        console.error("Session compilation drop:", err);
        res.status(500).json({ error: "Could not provision live tracking session." });
    }
});

// Interactive Pipeline Intercept: Processes inbound user prompt tokens
app.post('/api/chat', async (req, res) => {
    try {
        let { message, sessionId, visitorName, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message content cannot be blank." });
        }

        // Auto-Provision Session if client side lost it during dropouts
        if (!sessionId) {
            const { data } = await supabase
                .from('chat_sessions')
                .insert([{ visitor_name: visitorName || 'Guest', is_human_agent: false, updated_at: new Date() }])
                .select().single();
            sessionId = data ? data.id : 'fallback-session';
        }

        // ⚡ ACTIVE HUMAN INTERCEPT CHECK: Direct Bypass Matrix
        if (sessionId && sessionId !== 'fallback-session') {
            const { data: currentSession } = await supabase
                .from('chat_sessions')
                .select('is_human_agent')
                .eq('id', sessionId)
                .single();

            if (currentSession && currentSession.is_human_agent) {
                // Log user message to data ledger so admin console draws it
                await supabase.from('chat_messages').insert([
                    { session_id: sessionId, sender: 'user', message: message }
                ]);

                // Update activity time marker
                await supabase.from('chat_sessions').update({ updated_at: new Date() }).eq('id', sessionId);
                
                // Return early - do not invoke LLM inference processes
                return res.status(200).json({ reply: null, sessionId, humanActive: true });
            }
        }

        // Write the incoming User prompt directly into the persistent table database
        if (sessionId !== 'fallback-session') {
            await supabase.from('chat_messages').insert([
                { session_id: sessionId, sender: 'user', message: message }
            ]);
            await supabase.from('chat_sessions').update({ updated_at: new Date() }).eq('id', sessionId);
        }

        // Sanitize & format conversational history for LLM Context Window insertion
        const cleanContextArray = history.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.message
        }));
        
        // Inject core operational directives
        cleanContextArray.unshift({
            role: "system",
            content: `You are Buddy, Akhin Murali's conversational AI portfolio engine copilot. 
            Keep answers precise, engaging, short, and highly technical. Focus on Akhin's background.`
        });
        
        // Append current prompt token
        cleanContextArray.push({ role: "user", content: message });

        // Trigger Inference API Pipeline Request
        const chatCompletion = await groq.chat.completions.create({
            messages: cleanContextArray,
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_tokens: 300
        });

        const systemReplyText = chatCompletion.choices[0]?.message?.content || "Connection lost. Re-establishing link pipeline context.";

        // Write AI generated reply to the database data streams
        if (sessionId !== 'fallback-session') {
            await supabase.from('chat_messages').insert([
                { session_id: sessionId, sender: 'assistant', message: systemReplyText }
            ]);
        }

        res.status(200).json({ reply: systemReplyText, sessionId });

    } catch (err) {
        console.error("AI pipeline core compilation failure:", err);
        res.status(500).json({ error: "System error down within inference node layer pipelines." });
    }
});

// Helper check endpoint for non-realtime fallback components
app.get('/api/chat/sync', async (req, res) => {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "Session identification vector required." });

    try {
        const { data: session } = await supabase.from('chat_sessions').select('is_human_agent').eq('id', sessionId).single();
        const { data: messages } = await supabase.from('chat_messages').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
        
        res.status(200).json({
            humanActive: session ? session.is_human_agent : false,
            messages: messages || []
        });
    } catch (err) {
        res.status(500).json({ error: "Sync verification error." });
    }
});

// ==========================================================================
// ADMINISTRATIVE GATEWAY PROTECTED INTERFACE CONTROL ENDPOINTS
// ==========================================================================

// Authorization Validation Route
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'administrator' }, process.env.JWT_SECRET, { expiresIn: '6h' });
        return res.status(200).json({ token });
    }
    res.status(401).json({ error: "Invalid operational access key mappings." });
});

// Access Session Queues Ledger
app.get('/api/admin/sessions', authenticateAdminToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('chat_sessions')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: "Failed to pull session queues." });
    }
});

// Fetch Single Thread Document History Log
app.get('/api/admin/messages/:sessionId', authenticateAdminToken, async (req, res) => {
    const { sessionId } = req.params;
    try {
        const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: "Could not locate historical record traces." });
    }
});

// Toggle Human Takeover Agent Control Rules Override
app.post('/api/admin/takeover', authenticateAdminToken, async (req, res) => {
    const { sessionId, isHumanActive } = req.body;
    try {
        const { error } = await supabase
            .from('chat_sessions')
            .update({ is_human_agent: isHumanActive, updated_at: new Date() })
            .eq('id', sessionId);

        if (error) throw error;
        res.status(200).json({ success: true, isHumanActive });
    } catch (err) {
        res.status(500).json({ error: "Could not set takeover control state rules mapping switch." });
    }
});

// Transmit Manual Agent Chat Override Entry Payload
app.post('/api/admin/message', authenticateAdminToken, async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return res.status(400).json({ error: "Invalid transmission package." });

    try {
        // Inject explicitly as agent sender type 'me' 
        const { data, error } = await supabase
            .from('chat_messages')
            .insert([{ 
                session_id: sessionId, 
                sender: 'me', 
                message: message 
            }])
            .select()
            .single();

        if (error) throw error;

        // Update active tracker tick
        await supabase.from('chat_sessions').update({ updated_at: new Date() }).eq('id', sessionId);

        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: "Transmission node write operation error failure." });
    }
});

// ==========================================================================
// SYSTEM SERVER PORT LIFECYCLE SPIN
// ==========================================================================
app.listen(PORT, () => {
    console.log(`🚀 Master Portfolio Server Engine active on routing vector port: ${PORT}`);
});