require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

// ⚡ Import your admin routes module (ensure the filename matches your admin routes file, e.g., adminRoutes.js)
const adminRoutes = require('./adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Administrative Supabase Client (Bypasses RLS)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Initialize Groq AI SDK
const groq = new Groq({ apiKey: process.env.GROK_API_KEY });

// ⚡ Mount the admin router to resolve the 404 error on /api/admin/login
app.use('/api/admin', adminRoutes(supabase));

app.get('/api/config', (req, res) => {
    res.status(200).json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

// Handshake Endpoint
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

// Core Interactive Chat Processing Pipeline
app.post('/api/chat', async (req, res) => {
    try {
        let { message, sessionId, visitorName, history = [] } = req.body;
        const emailId = process.env.AKHIN_EMAIL || "your-email@domain.com";
        const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

        if (!message) {
            return res.status(400).json({ error: "Message content cannot be blank." });
        }

        if (!sessionId) {
            const { data } = await supabase
                .from('chat_sessions')
                .insert([{ visitor_name: visitorName || 'Guest', is_human_agent: false, updated_at: new Date() }])
                .select().single();
            sessionId = data ? data.id : 'fallback-session';
        }

        // 1. ACTIVE HUMAN INTERCEPT CHECK
        if (sessionId && sessionId !== 'fallback-session') {
            const { data: currentSession } = await supabase
                .from('chat_sessions')
                .select('is_human_agent')
                .eq('id', sessionId)
                .single();

            if (currentSession && currentSession.is_human_agent) {
                await supabase.from('chat_messages').insert([
                    { session_id: sessionId, sender: 'user', message: message }
                ]);
                await supabase.from('chat_sessions').update({ updated_at: new Date() }).eq('id', sessionId);
                return res.status(200).json({ reply: null, sessionId, humanActive: true });
            }
        }

        // 2. DISCORD WEBHOOK & HUMAN ESCALATION INTERCEPT MATRIX
        const cleanQuery = message.toLowerCase();
        const affirmativeTriggers = ['yes', 'sure', 'yeah', 'yep', 'connect', 'talk to akhin', 'please'];
        const isUserAcceptingHandoff = affirmativeTriggers.some(word => cleanQuery.includes(word));
        
        // Find if the last assistant bubble was offering the human handoff prompt
        const lastAiBubble = [...history].reverse().find(msg => msg.sender === 'assistant')?.message || '';
        const didAiOfferHandoff = lastAiBubble.toLowerCase().includes('talk to akhin');

        if ((isUserAcceptingHandoff && didAiOfferHandoff) || cleanQuery.includes('connect discord')) {
            // A. Update Supabase Session state to True so future messages route directly to admin dashboard
            if (sessionId !== 'fallback-session') {
                await supabase.from('chat_sessions').update({ is_human_agent: true, updated_at: new Date() }).eq('id', sessionId);
                await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'user', message: message }]);
            }

            // B. Dispatch secure request payload out onto your active Discord server webhook
            if (discordWebhookUrl) {
                try {
                    await fetch(discordWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: `🚨 **Live Portfolio Chat Takeover Requested!**\n👤 **Visitor:** ${visitorName || 'Guest'}\n🆔 **Session ID:** \`${sessionId}\`\n💬 **Last Word:** "${message}"\n🔗 *Log into your portfolio admin dashboard console right away to reply live!*`
                        })
                    });
                } catch (webhookErr) {
                    console.error("Discord integration notification channel down:", webhookErr);
                }
            }

            // C. Return explicit tracking response state to front-end viewport
            const liveTakeoverNotice = `Done! I've sent a direct message to Akhin's Discord server to alert him. If he's online, he can log into this session and continue chatting with you right here!\n\n✉️ You can also email him directly at: **${emailId}**.\n\n⚠️ *Please note: During working hours it will be difficult to respond immediately, but if you don't find any response in a minute, please contact via email.*`;
            
            if (sessionId !== 'fallback-session') {
                await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'assistant', message: liveTakeoverNotice }]);
            }
            
            return res.status(200).json({ reply: liveTakeoverNotice, sessionId, humanActive: true });
        }

        // Write the standard message history trace to Supabase
        if (sessionId !== 'fallback-session') {
            await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'user', message: message }]);
            await supabase.from('chat_sessions').update({ updated_at: new Date() }).eq('id', sessionId);
        }

        // 3. BUILD CONTEXT WINDOW WITH DYNAMIC SYSTEM DIRECTIVES
        const cleanContextArray = history.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.message
        }));
        
        cleanContextArray.unshift({
            role: "system",
            content: `You are Buddy, Akhin Murali's conversational Portfolio Assistant. Keep answers precise, short, and technical. 

start by asking the user's name and what they do naturally, without deviating from portfolio subjects or being intrusive. Let them know how you can help with their work. If you cannot help, let them know it was good to meet them and perhaps you can collaborate in the future.

INITIALIZATION RULE:
- When a user first steps into/opens the chat, immediately initiate the Discord webhook to alert Akhin that a visitor has joined.
-Do Not provide factual or false information about Akhin .Do not artifically try to match his skills to users requirements if it matches only then try to build a rapport on the topic else have a friendly converstion 
ESCALATION & WEBHOOK RULES:
Trigger the Discord webhook and append the mandatory text block immediately if:
1. The user explicitly states they want to talk to Akhin.
2. The user asks questions completely unrelated to tech/projects/career (off-topic), appears highly confused, or the conversation history length exceeds 5 rounds. (For these cases, first ask: "Do you want to talk to Akhin about these?", and on User Confirmation "Yes", trigger the webhook).

MANDATORY TEXT BLOCK (append this exactly when the webhook is triggered):
"You can contact him directly at ${emailId}. I’ve alerted Akhin so he can step in live. Please note that during working hours it can sometimes take a moment for him to respond. If you don't receive a response within a minute, please feel free to contact him directly via email."`
		});
        
        cleanContextArray.push({ role: "user", content: message });

        const chatCompletion = await groq.chat.completions.create({
            messages: cleanContextArray,
            model: "llama-3.1-8b-instant",
            temperature: 0.5,
            max_tokens: 300
        });

        const systemReplyText = chatCompletion.choices[0]?.message?.content || "Connection lost. Re-establishing link pipeline context.";

        if (sessionId !== 'fallback-session') {
            await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'assistant', message: systemReplyText }]);
        }

        res.status(200).json({ reply: systemReplyText, sessionId });

    } catch (err) {
        console.error("AI pipeline core compilation failure:", err);
        res.status(500).json({ error: "System error down within inference node layer pipelines." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Master Portfolio Server Engine active on port: ${PORT}`);
});