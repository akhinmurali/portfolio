require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const { Resend } = require('resend');

const adminRoutes = require('./adminRoutes');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const client = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

const resend = new Resend(process.env.RESEND_API_KEY);

// Streamlined email notification dispatch
async function dispatchNotificationEmail(subject, textContent) {
    try {
        const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
        const toEmail = process.env.EMAIL_TO;

        if (!toEmail) return;

        await resend.emails.send({
            from: fromEmail,
            to: toEmail,
            subject: `[Portfolio Alert] ${subject}`,
            text: textContent
        });
    } catch (err) {
        console.error("📧 Resend bypass:", err.message);
    }
}

// ==========================================================================
// SESSION CREATION ENDPOINT
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

        dispatchNotificationEmail(
            `New Live Session Started`,
            `A visitor named "${visitorName || 'Guest'}" has initialized a session.\nID: ${data.id}`
        );

        res.json({ sessionId: data.id });
    } catch (error) {
        console.error("Session creation error:", error);
        res.status(500).json({ error: "Failed to initialize session." });
    }
});

// ==========================================================================
// CORE CHAT PIPELINE (Pure LLM-Driven Verification & Stateless Optimization)
// ==========================================================================
app.post('/api/chat', async (req, res) => {
    try {
        let { message, sessionId, visitorName, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message content cannot be blank." });
        }

        // COLD START IMMUNITY: If frontend sends a message before session finishes creating
        if (!sessionId) {
            try {
                const { data } = await supabase
                    .from('chat_sessions')
                    .insert([{ visitor_name: visitorName || 'Guest', is_human_agent: false, updated_at: new Date() }])
                    .select().single();
                if (data) sessionId = data.id;
            } catch (dbErr) {
                sessionId = 'fallback-session';
            }
        }

        // Clean up client history: Remove any offline system warning markers to prevent AI confusion
        let sanitizedHistory = (Array.isArray(history) ? history : [])
            .filter(h => h.message && !h.message.includes("⚠️ Server Offline") && !h.message.includes("⏰ Server Update"));

        let verificationDirectives = "";
        const memoryFilePath = path.join(__dirname, 'memories.json');

        // Look for personal identity context completely via JSON database mapping
        if (fs.existsSync(memoryFilePath)) {
            const memoriesDb = JSON.parse(fs.readFileSync(memoryFilePath, 'utf8'));
            
            // Search if the current message input or the visitor name profile matches a key in memories.json
            const inputKey = message.trim().toLowerCase();
            const nameKey = visitorName ? visitorName.trim().toLowerCase() : "";
            const matchedKey = memoriesDb[inputKey] ? inputKey : (memoriesDb[nameKey] ? nameKey : null);

            if (matchedKey) {
                const profile = memoriesDb[matchedKey];
                
                // Inject the verification challenge rule directly into the LLM system prompt context
                verificationDirectives = `
[SECURITY CHALLENGE RUNTIME]
- The visitor is flagging a match for the profile: "${matchedKey.toUpperCase()}".
- Challenge Question you must ask immediately if not already answered: "${profile.insideJokeQuestion}"
- Secret keywords that confirm their identity: ${JSON.stringify(profile.keywords)}
- UNLOCKED MEMORY PAYLOAD: "${profile.memoryPayload}"

LLM INSTRUCTIONS: Evaluate the conversation history. If the user has NOT provided an answer containing any of the secret keywords yet, you MUST politely challenge them with the question and withhold the payload. If they have successfully answered it within the dialogue history, unlock the payload, greet them warmly, drop professional boundaries, and reference the shared memories naturally.
`;
            }
        }

        // Token-Optimized System Prompt Context to protect free-tier rate limits
        const dynamicSystemPrompt = `You are "Buddy", Akhin Murali's autonomous conversational portfolio terminal.
${verificationDirectives}
PORTFOLIO FACTS (TRUTH BASE):
- Education: B.Tech in Mechanical Engineering, Kerala University (2017).
- 2024-Present: PMO Analyst, Allianz Services. Wrote data-cleaning automation scripts, built advanced Power BI & Power Automate dashboards.
- 2022-2024: Senior Customer Service Consultant, Allianz Australia.
- 2020-2022: Claims Specialist, Good Methods Global Pvt Ltd.

CRITICAL LAWS:
1. Zero Extrapolation: Do not invent skills or biographical data outside this prompt.
2. Keep answers short and concise (max 3 to 5 lines).
3. If an identity challenge is active, follow the runtime security directives above.
4. Once personal memories are shared, smoothly guide the user back to Akhin's portfolio assistance (e.g., asking what projects or experience they want to explore).`;

        // Map payload structures cleanly for the Groq/Llama engine API
        const messagesPayload = [
            { role: "system", content: dynamicSystemPrompt },
            ...sanitizedHistory.map(h => ({
                role: h.sender === 'user' ? 'user' : 'assistant',
                content: h.message || ""
            })),
            { role: "user", content: message }
        ];

        // Call LLM Inference Engine Core
        const chatCompletion = await client.chat.completions.create({
            messages: messagesPayload,
            model: "llama-3.1-8b-instant",
            temperature: 0.2, // Kept low to keep evaluation reliable and accurate
            max_tokens: 250,
            stream: false
        });

        const replyText = chatCompletion.choices[0].message.content;

        // Async Database Sync (Doesn't block user response cycle)
        if (sessionId && sessionId !== 'fallback-session') {
            supabase.from('chat_messages').insert([
                { session_id: sessionId, sender: 'user', message: message },
                { session_id: sessionId, sender: 'assistant', message: replyText }
            ]).then(() => {}).catch(() => {});
        }

        return res.status(200).json({ reply: replyText, sessionId });

    } catch (error) {
        console.error("💥 Chat Pipeline Crash:", error);
        return res.status(500).json({ error: "Internal server error." });
    }
});

// ==========================================================================
// USER SYNC ENDPOINT
// ==========================================================================
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

app.use('/api/admin', adminRoutes(supabase));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Stateless Copilot Engine Operational on Port ${PORT}`));