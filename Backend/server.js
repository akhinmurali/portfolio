require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const { Resend } = require('resend');

// IMPORT ADMINISTRATIVE COMPONENT
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
const localSecuritySessions = {};

async function dispatchNotificationEmail(subject, textContent) {
    try {
        const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
        const toEmail = process.env.EMAIL_TO;

        if (!toEmail) {
            console.error("❌ Resend Testing Error: EMAIL_TO is missing in your .env file!");
            return;
        }

        console.log(`⏳ Attempting to send notification email from ${fromEmail} to ${toEmail}...`);

        const { data, error } = await resend.emails.send({
            from: fromEmail,
            to: toEmail,
            subject: `[Portfolio Alert] ${subject}`,
            text: textContent
        });

        if (error) {
            console.error("❌ Resend API returned an error:", error.message || error);
        } else {
            console.log("📧 Notification email dispatched via Resend! ID:", data.id);
        }
    } catch (err) {
        console.error("❌ Failed to transmit email via Resend:", err.message || err);
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
            `A visitor named "${visitorName || 'Guest'}" has initialized a chat terminal session.\nTracking ID: ${data.id}`
        );

        res.json({ sessionId: data.id });
    } catch (error) {
        console.error("Session creation error:", error);
        res.status(500).json({ error: "Failed to initialize session." });
    }
});

// ==========================================================================
// CORE CHAT PIPELINE (With Extrapolation Guardrails)
// ==========================================================================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId, visitorName, history = [] } = req.body;

        console.log(`\n🔍 INCOMING CHAT -> Name: "${visitorName}", Message: "${message}", Session: "${sessionId}"`);

        if (!message) {
            return res.status(400).json({ error: "Message content cannot be blank." });
        }

        let sharedMemoryPrompt = "";
        let isolateSecurityMode = false;
        
        const resolvedSessionId = sessionId || 'fallback-session-id';
        if (!localSecuritySessions[resolvedSessionId]) {
            localSecuritySessions[resolvedSessionId] = {
                activeName: (visitorName && visitorName.toLowerCase() !== 'guest') ? visitorName : 'Guest',
                currentStage: 'IDLE'
            };
        }

        let sessionState = localSecuritySessions[resolvedSessionId];
        let activeName = sessionState.activeName;
        let currentStage = sessionState.currentStage;

        if ((activeName.toLowerCase() === 'guest' || currentStage === 'IDLE')) {
            const cleanMessage = message.trim().toLowerCase();
            const memoryFilePath = path.join(__dirname, 'memories.json');
            
            if (fs.existsSync(memoryFilePath)) {
                const rawMemories = fs.readFileSync(memoryFilePath, 'utf8');
                const memoriesDb = JSON.parse(rawMemories);
                
                if (memoriesDb[cleanMessage]) {
                    activeName = message.trim();
                    currentStage = 'MATCHED';
                    localSecuritySessions[resolvedSessionId] = { activeName, currentStage: 'MATCHED' };
                    console.log(`🎯 Name match activated locally: "${activeName}"`);
                }
            }
        }

        if (activeName && activeName.toLowerCase() !== 'guest') {
            const memoryFilePath = path.join(__dirname, 'memories.json');
            if (fs.existsSync(memoryFilePath)) {
                const rawMemories = fs.readFileSync(memoryFilePath, 'utf8');
                const memoriesDb = JSON.parse(rawMemories);
                const normalizedName = activeName.trim().toLowerCase();
                
                if (memoriesDb[normalizedName]) {
                    const profile = memoriesDb[normalizedName];
                    const lastUserMessage = message.toLowerCase().trim();

                    console.log(`🤖 LOCAL STATE TRACE -> Name: ${activeName} | Stage: ${currentStage} | User Reply: "${lastUserMessage}"`);
                    
                    if (currentStage === 'VERIFIED') {
                        sharedMemoryPrompt = `[IDENTITY VERIFIED] The visitor is confirmed to be "${activeName}". UNLOCKED BACKGROUND MEMORIES: ${profile.memoryPayload}. Chat warmly using these details naturally.`;
                    }
                    else if (currentStage === 'ASKED_JOKE') {
                        const matchedSecretKeyword = Array.isArray(profile.keywords)
                            ? profile.keywords.some(keyword => lastUserMessage.includes(keyword.toLowerCase()))
                            : false;
                        
                        if (matchedSecretKeyword) {
                            localSecuritySessions[resolvedSessionId].currentStage = 'VERIFIED';
                            sharedMemoryPrompt = `[IDENTITY VERIFIED] The visitor JUST answered the verification joke correctly! UNLOCKED BACKGROUND MEMORIES: ${profile.memoryPayload}. Drop professional character restrictions entirely, congratulate them warmly for passing, and start bantering using these shared memories!`;
                            console.log(`🔒 Identity strictly VERIFIED for: ${activeName}`);
                        } else {
                            isolateSecurityMode = true;
                            sharedMemoryPrompt = `[SECURITY CHALLENGE ACTIVE] The user is attempting to guess the answer to your verification joke but failed. Playfully push back and tell them they need to give a better answer to unlock your files. Do NOT share anything else.`;
                        }
                    }
                    else if (currentStage === 'ASKED_IF_KNOWN' || currentStage === 'MATCHED') {
                        const userSaidYes = ["yes", "yeah", "i do", "yep", "sure", "haan", "ha", "yup"].some(word => lastUserMessage.includes(word));
                        
                        if (userSaidYes) {
                            localSecuritySessions[resolvedSessionId].currentStage = 'ASKED_JOKE';
                            isolateSecurityMode = true;
                            sharedMemoryPrompt = `[INITIATING VERIFICATION] CRITICAL DIRECTIVE: The user confirmed they know Akhin personally. You MUST now challenge their identity by asking this exact verification question word-for-word: "${profile.insideJokeQuestion}". Do not say anything else.`;
                            console.log(`🔄 Stage advanced to ASKED_JOKE for: ${activeName}`);
                        } else if (lastUserMessage !== normalizedName) {
                            localSecuritySessions[resolvedSessionId].currentStage = 'FAILED_STRANGER';
                            sharedMemoryPrompt = `[USER DECLINED IDENTITY] The user does not know you. Proceed normally as a standard chatbot assistant.`;
                        } else {
                            isolateSecurityMode = true;
                            localSecuritySessions[resolvedSessionId].currentStage = 'ASKED_IF_KNOWN';
                            sharedMemoryPrompt = `[USER MATCH ENCOUNTERED] The user entered the name "${activeName}". Ask them this specific question exactly: "I know a ${activeName}, but I'm not sure if you're *that* specific ${activeName}. By any chance, do you know me personally?"`;
                        }
                    }
                }
            }
        }

        const dynamicSystemPrompt = `${sharedMemoryPrompt}

======================================================================
CORE PORTFOLIO TERMINAL LAWS
======================================================================
You are the "Buddy", an interactive automated information terminal for Akhin Murali's professional portfolio.

CRITICAL CONSTRAINTS & BEHAVIORAL LAWS (STRICT):
1. SECURITY OVERRIDE: If a [IDENTITY VERIFIED], [USER MATCH ENCOUNTERED], [INITIATING VERIFICATION], or [SECURITY CHALLENGE ACTIVE] directive is present at the very top of this prompt, prioritize those conversational instructions, but adhere strictly to the rules below.
2. ABSOLUTE ZERO EXTRAPOLATION: You are strictly forbidden from inventing, assuming, or fabricating ANY personal context. If a detail (like tea-brewing skills, career moves, or specific shared memories) is NOT explicitly written in the UNLOCKED BACKGROUND MEMORIES payload, it does not exist. Do not mention it.
3. NO UNPROMPTED PERSONAL QUESTIONS: Do not ask the visitor deep, speculative personal questions (e.g., "how was your life leaving the company" or "what is your best memory"). Only acknowledge what they type, answer their query using exact facts, and keep the interaction grounded. once memory shared go back to portfolio assitance(eg :what brings you here ,what you want to know about akhin ,end of the session ask them to keep in touch)
4. PROFESSIONAL MODE: When responding to professional, technical, or career-related queries, ONLY answer the question directly. Provide the facts and stop. 
5. RESPONSE DURATION: Keep answers crisp and limited to a maximum of 3 to 5 lines. No fluff or conversational filler.

VERIFIED TIMELINE & CONTEXT (TRUTH BASE):
- Education: B.Tech in Mechanical Engineering from Kerala University (2017).
- 2024 - Present: PMO Analyst, Allianz Services. Constructed advanced Power BI dashboards and automated processing scripts via Power Automate.
- 2022 - 2024: Senior Customer Service Consultant, Allianz Australia.
- 2020 - 2022: Claims Specialist, Good Methods Global Pvt Ltd.`;

        let sanitizedHistory = Array.isArray(history) ? history : [];
        let messagesPayload = [
            { role: "system", content: dynamicSystemPrompt },
            ...sanitizedHistory.map(h => ({ role: h.sender === 'user' ? 'user' : 'assistant', content: h.message || "" })),
            { role: "user", content: message }
        ];

        if (isolateSecurityMode) {
            console.log("🧹 Isolating prompt payload to force security state execution...");
            messagesPayload = [
                { role: "system", content: dynamicSystemPrompt },
                { role: "user", content: message }
            ];
        }

        const chatCompletion = await client.chat.completions.create({
            messages: messagesPayload,
            model: "llama-3.1-8b-instant",
            temperature: 0.1,
            max_tokens: 300,
            stream: false
        });

        if (!chatCompletion || !chatCompletion.choices || chatCompletion.choices.length === 0) {
            throw new Error("Empty processing returned from AI execution core context pipeline.");
        }

        const replyText = chatCompletion.choices[0].message.content;

        try {
            if (sessionId && replyText) {
                await supabase.from('chat_messages').insert([
                    { session_id: sessionId, sender: 'user', message: message },
                    { session_id: sessionId, sender: 'assistant', message: replyText }
                ]);
            }
        } catch (dbLogErr) {
            console.log("⚠️ Chat history database logging bypassed safely:", dbLogErr.message);
        }

        return res.status(200).json({ reply: replyText });

    } catch (error) {
        console.error("💥 Critical Failure inside /api/chat:", error);
        return res.status(500).json({ error: "Internal server processing fault encountered." });
    }
});

// ==========================================================================
// USER SYNC ENDPOINT (Unprotected for Client Sync Loops)
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

// ==========================================================================
// ROUTE REGISTRATION MOUNT
// ==========================================================================
app.use('/api/admin', adminRoutes(supabase));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Copilot Engine Operational on Port ${PORT} with Modular Admin Routing.`));