require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const adminRoutes = require('./adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const groq = new Groq({ apiKey: process.env.GROK_API_KEY });

app.use('/api/admin', adminRoutes(supabase));

app.get('/api/config', (req, res) => {
    res.status(200).json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

// WELCOME WEBHOOK: Triggers immediately when a user opens/enters the chat
app.post('/api/session/create', async (req, res) => {
    const { visitorName } = req.body;
    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

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
        const sessionId = data.id;

        if (discordWebhookUrl) {
            await fetch(discordWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `👋 **New Visitor Joined Portfolio Chat!**\n👤 **Visitor:** ${visitorName || 'Guest'}\n🆔 **Session ID:** \`${sessionId}\``
                })
            }).catch(err => console.error("Welcome webhook failed:", err));
        }

        res.status(200).json({ sessionId });
    } catch (err) {
        console.error("Session compilation drop:", err);
        res.status(500).json({ error: "Could not provision live tracking session." });
    }
});

const chatTools = [
    {
        type: "function",
        function: {
            name: "trigger_discord_handoff",
            description: "Alerts Akhin on his Discord server for a live chat handoff. Use this tool if the user explicitly wants to talk to Akhin, appears confused, asks off-topic questions, or requires human assistance.",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "The contextual reason why the handoff is being triggered."
                    }
                },
                required: ["reason"]
            }
        }
    }
];

app.post('/api/chat', async (req, res) => {
    try {
        let { message, sessionId, visitorName, history = [] } = req.body;
        const emailId = process.env.AKHIN_EMAIL || "akhinmurali@gmail.com";
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

        // Active human intercept check (Only honors manual toggle from the admin panel)
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

        // Keyword/Manual Handoff Trigger Fallback Check
        const cleanQuery = message.toLowerCase();
        const affirmativeTriggers = ['yes', 'sure', 'yeah', 'yep', 'connect', 'talk to akhin', 'please'];
        const isUserAcceptingHandoff = affirmativeTriggers.some(word => cleanQuery.includes(word));
        const lastAiBubble = [...history].reverse().find(msg => msg.sender === 'assistant')?.message || '';
        const didAiOfferHandoff = lastAiBubble.toLowerCase().includes('talk to akhin');

        if ((isUserAcceptingHandoff && didAiOfferHandoff) || cleanQuery.includes('connect discord')) {
            if (sessionId !== 'fallback-session') {
                await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'user', message: message }]);
            }

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

            const liveTakeoverNotice = `Done! I've sent a direct message to Akhin. If he's online, he can log into this session and continue chatting with you right here!\n\n✉️ You can also email him directly at: **${emailId}**.\n\n⚠️ *Please note: During working hours it will be difficult to respond immediately, but if you don't find any response in a minute, please contact via email.*`;
            
            if (sessionId !== 'fallback-session') {
                await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'assistant', message: liveTakeoverNotice }]);
            }
            
            return res.status(200).json({ reply: liveTakeoverNotice, sessionId, humanActive: false });
        }

        if (sessionId !== 'fallback-session') {
            await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'user', message: message }]);
            await supabase.from('chat_sessions').update({ updated_at: new Date() }).eq('id', sessionId);
        }

        const cleanContextArray = history.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.message
        }));
        
        cleanContextArray.unshift({
            role: "system",
            content: `You are Buddy, Akhin Murali's conversational Portfolio Assistant. Keep answers precise, short, and technical. 
Provide an excellent customer experience by asking the user's name and what they do naturally, without deviating from portfolio subjects or being intrusive. 
If the user wants to talk to Akhin, appears confused, or goes off-topic, use the trigger_discord_handoff tool.`Do not go into deep conversations on topics that are irrelevent to Akhin's Portfolio (dont explain too much on tools adn how to do stuff.Keep conversations minimalistic on to point)
        });
        
        cleanContextArray.push({ role: "user", content: message });

        const chatCompletion = await groq.chat.completions.create({
            messages: cleanContextArray,
            model: "llama-3.3-70b-versatile",
            tools: chatTools,
            tool_choice: "auto",
            temperature: 0.5,
            max_tokens: 300
        });

        const responseMessage = chatCompletion.choices[0]?.message;

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolCall = responseMessage.tool_calls[0];
            const args = JSON.parse(toolCall.function.arguments || '{}');

            if (discordWebhookUrl) {
                await fetch(discordWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `🚨 **Autonomous Llama Handoff Triggered!**\n👤 **Visitor:** ${visitorName || 'Guest'}\n🔍 **Reason:** ${args.reason || 'User requested human support'}\n🆔 **Session ID:** \`${sessionId}\``
                    })
                }).catch(err => console.error("Discord webhook error:", err));
            }

            const liveTakeoverNotice = `Done! I've sent a direct message to Akhin. If he's online, he can log into this session and continue chatting with you right here!\n\n✉️ You can also email him directly at: **${emailId}**.\n\n⚠️ *Please note: During working hours it will be difficult to respond immediately, but if you don't find any response in a minute, please contact via email.*`;

            if (sessionId !== 'fallback-session') {
                await supabase.from('chat_messages').insert([{ session_id: sessionId, sender: 'assistant', message: liveTakeoverNotice }]);
            }

            return res.status(200).json({ reply: liveTakeoverNotice, sessionId, humanActive: false });
        }

        const systemReplyText = responseMessage.content || "Connection lost. Re-establishing link pipeline context.";

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