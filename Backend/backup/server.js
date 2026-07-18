const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const client = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

// ==========================================================================
// FIX 1: SESSION CREATION ENDPOINT (was missing entirely)
// The frontend needs to call this first to get a sessionId before chatting.
// ==========================================================================
app.post('/api/session/create', async (req, res) => {
    try {
        const { visitorName } = req.body;

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

        res.json({ sessionId: data.id });
    } catch (error) {
        console.error("Session creation error:", error);
        res.status(500).json({ error: "Failed to initialize session." });
    }
});

// ==========================================================================
// CORE CHAT PIPELINE
// ==========================================================================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId, visitorName } = req.body;

        // FIX 2: sessionId is now always present (created before first message).
        // Guard kept as a safety net.
        if (!sessionId) return res.status(400).json({ error: "Missing session tracking configurations." });

        // 1. Log user message to database
        await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'user', message }]);

        // 2. Check if a human operator has taken over the channel
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('is_human_agent')
            .eq('id', sessionId)
            .single();

        if (session && session.is_human_agent) {
            return res.json({ response: null, humanActive: true });
        }

        // 3. Keep session tracking fresh
        await supabase
            .from('chat_sessions')
            .update({ updated_at: new Date(), visitor_name: visitorName || 'Guest' })
            .eq('id', sessionId);

        // 4. Fetch full conversation history for context
        const { data: history } = await supabase
            .from('chat_messages')
            .select('sender, message')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        // 5. System prompt
        const dynamicSystemPrompt = `You are the "System Copilot Engine," an interactive automated information terminal for Akhin Murali's professional portfolio.

CRITICAL CONSTRAINTS & BEHAVIORAL LAWS (STRICT):
1. NO HALLUCINATIONS OR NEGATIVE LABELS: You are strictly forbidden from fabricating, imagining, or expanding upon Akhin Murali's career history. If a detail is not explicitly written in the "VERIFIED TIMELINE & CONTEXT" block below, do not mention it. 
*CRITICAL*: Never explicitly state what Akhin doesn't have. Do not say things like "I do not have professional certifications," or "That information is not in my database." Instead, elegantly pivot to highlight his verified achievements, practical projects, or hands-on automation experience.
2. PROFESSIONAL MODE (NO TRAILING QUESTIONS): When responding to professional, technical, or career-related queries, ONLY answer the question directly. Provide the facts and stop.
3. RESPONSE DURATION: Keep answers crisp and limited to a maximum of 5 to 6 lines. No corporate fluff.
4. INITIAL ENGAGEMENT EXCEPTION: You may ask the user for their name ONLY during the initial greeting phase. Once professional dialogue begins, eliminate all prompt hooks.

VERIFIED TIMELINE & CONTEXT (TRUTH BASE - DO NOT DEVIATE):
- Education: B.Tech in Mechanical Engineering from Kerala University (2017). 100% self-taught in AI engineering methodologies.
- 2023 - Present: PMO Analyst, Allianz Services India. Constructed advanced Power BI dashboards and automated processing scripts via Power Automate.
- 2022 - 2023: Sales & Service Consultant, Allianz Australia.
- 2020 - 2022: Junior Claims Assistant, CareStack.
- Active Technical Projects:
  * Self-ordering kiosks for QSRs integrating UPI-only payment ecosystems.
  * Instagram DM automation via Meta Developer tools and Make.com workflows.
  * Self-hosted storage deployments using OpenMediaVault with Wetty, Podman, and Docker.
- Hobbies: Cricket, football, badminton, cinema screenwriting (military themes), and Malayalam poetry.`;

        // 6. Build messages payload
        const messagesPayload = [{ role: "system", content: dynamicSystemPrompt }];

        // FIX 3: Always push conversation history. The old code fell back to pushing
        // only the current message when history existed — that was backwards.
        // History already includes the current message (inserted in step 1), so
        // we map the full history directly without a separate else branch.
        if (history && history.length > 0) {
            history.forEach(msg => {
                // Skip 'me' (admin) sender rows — those are not part of AI context
                if (msg.sender === 'me') return;
                messagesPayload.push({
                    role: msg.sender === 'user' ? 'user' : 'assistant',
                    content: msg.message
                });
            });
        } else {
            // Fallback: history fetch failed, push current message manually
            messagesPayload.push({ role: "user", content: message });
        }

        // 7. Call Groq via OpenAI SDK
        const chatCompletion = await client.chat.completions.create({
            messages: messagesPayload,
            model: "llama-3.1-8b-instant",
            temperature: 0.3,
            max_tokens: 300
        });

        const aiResponseText = chatCompletion.choices[0]?.message?.content || "Terminal system error. Please retry.";

        // 8. Log AI reply to database
        await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'ai', message: aiResponseText }]);

        res.json({ response: aiResponseText, humanActive: false });

    } catch (error) {
        console.error("Chat routing runtime crash:", error);
        res.status(500).json({ error: "Internal chat orchestration pipeline crash." });
    }
});

// ==========================================================================
// ADMINISTRATIVE ROUTING PIPELINES
// ==========================================================================

// GET: All sessions for admin sidebar
app.get('/api/admin/sessions', async (req, res) => {
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

// POST: Toggle human agent takeover
app.post('/api/admin/takeover', async (req, res) => {
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

// GET: Historical messages for a session
app.get('/api/admin/messages/:sessionId', async (req, res) => {
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

// POST: Admin sends a live manual message
app.post('/api/admin/message', async (req, res) => {
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

// GET: User widget sync polling endpoint
app.get('/api/chat/sync', async (req, res) => {
    try {
        const { sessionId } = req.query;
        if (!sessionId) return res.status(400).json({ error: "Missing tracking ID" });

        const { data: session } = await supabase
            .from('chat_sessions')
            .select('is_human_agent')
            .eq('id', sessionId)
            .single();

        const { data: messages } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        res.json({
            humanActive: session ? session.is_human_agent : false,
            messages: messages || []
        });
    } catch (error) {
        console.error("Sync route failure:", error);
        res.status(500).json({ error: "Timeline sync error." });
    }
});

app.listen(5000, () => console.log('🚀 Copilot Engine Operational on Port 5000'));
