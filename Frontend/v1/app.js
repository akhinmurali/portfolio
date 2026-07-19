/**
 * Akhin Murali - Portfolio Engine Architecture
 * Production Refactored Layout Switcher, Hook Animator, & Chat Interface Controller
 */

// --- 1. GLOBAL STATE DEFINITIONS ---
let conversationHistory = [];
const MAX_HISTORY_DEPTH = 6; // Deepened slightly to let the LLM evaluate context accurately
let isWaitingForResponse = false;
let isLiveHumanOverride = false;
let liveCheckInterval = null;
let sessionId = null;          // Tracks database session identity
let visitorName = "Guest";     // Extracted or explicitly given guest identity

// Teaser Engine States
let teaserInterval = null;
const TEASER_PHRASES = [
    "🤖 System Status: Unsupervised. Talk to me.",
    "⚡ Click here to initiate Human Takeover protocol.",
    "🧠 Ask me how many cups of coffee built this site.",
    "👾 Warning: I know where the secret features are hidden.",
    "📂 Type 'resume' to see if I can break Akhin's firewall."
];

// --- 2. LOCAL FAQ INTERCEPTOR MATRIX (Quota & Server-Off Protection) ---
const LOCAL_FAQ_REGISTRY = {
    contact: "You can reach Akhin directly via email at your-email@domain.com or connect through his LinkedIn profile linked on this page.",
    email: "Akhin's professional email is your-email@domain.com.",
    stack: "Akhin builds automation pipelines using JavaScript, Node.js, Express, Python, Google Gemini frameworks, and ServiceNow interfaces.",
    resume: "You can view Akhin's detailed roles and achievements by clicking the 'Explore My Work History' button right here on the main page.",
    projects: "His core builds include a Smart Digital Front Desk with live human takeover, an AI Resource Planner, and a PMO Automation Tool Suite.",
    allianz: "At Allianz, Akhin worked as a PMO Analyst focusing on project tracking tools and automated reporting scripts, and previously handled motor insurance accounts at Allianz Australia."
};

// --- 3. LIFECYCLE LISTENERS & PROGRAMMATIC INTERACTION BINDINGS ---
document.addEventListener('DOMContentLoaded', () => {
    const copilotNode = document.getElementById('copilotNode');
    const chatHeader = document.getElementById('chatHeader');
    const btnProjects = document.getElementById('btn-projects');
    const btnExperience = document.getElementById('btn-experience');
    const userInputField = document.getElementById('userInputField');
    const submitLogBtn = document.getElementById('submitLogBtn');

    const automationSection = document.getElementById('automation');
    const experienceSection = document.getElementById('experience');
    const capabilitiesSection = document.getElementById('capabilities');

    // FORCE INITIAL HIDDEN STATE (Ensures clean workspace on load)
    if (automationSection) automationSection.style.display = 'none';
    if (experienceSection) experienceSection.style.display = 'none';
    if (capabilitiesSection) capabilitiesSection.style.display = 'none';

    // UNIVERSAL HEAD-END TOGGLE FOR CHAT WINDOW
    if (chatHeader && copilotNode) {
        chatHeader.style.cursor = 'pointer';
        chatHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            if (copilotNode.classList.contains('expanded')) {
                closeChatWindow();
            } else {
                openChatWindow();
            }
        });
    }

    // ALWAYS-WORKING INTERACTIVE BUTTON ROUTERS
    if (btnProjects) {
        btnProjects.addEventListener('click', () => toggleWorkspaceSection('projects'));
    }
    if (btnExperience) {
        btnExperience.addEventListener('click', () => toggleWorkspaceSection('experience'));
    }

    // Direct Listeners for Chat Submission
    if (userInputField && submitLogBtn) {
        submitLogBtn.addEventListener('click', processUserSubmission);
        userInputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') processUserSubmission();
        });
    }

    // INITIALIZE CURIOSITY TEASER ENGINE
    initializeTeaserEngine();

    // BOOTSTRAP BACKEND HANDSHAKE EARLY (Wakes up Render free tier on page load)
    initializeBackendSession();
});

// --- 4. BACKEND HANDSHAKE & INITIALIZATION SYSTEM ---
async function initializeBackendSession() {
    try {
        const response = await fetch('https://portfolio-196a.onrender.com/api/session/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorName })
        });
        
        if (response.ok) {
            const data = await response.json();
            sessionId = data.sessionId;
            console.log(`📡 Backend handshake successful. Assigned Session ID: ${sessionId}`);
        }
    } catch (err) {
        console.warn("⚠️ Server cold-starting. Transitioning chat connection to autonomous fallback tracking mode.", err);
    }
}

// --- 5. INTERFACE VISUAL MOTIONS & TEASER ENGINE ---
function initializeTeaserEngine() {
    const teaserNode = document.getElementById('chatTeaser');
    const textNode = document.getElementById('teaserText');
    if (!teaserNode || !textNode) return;

    let currentIdx = 0;
    textNode.textContent = TEASER_PHRASES[0];

    // Delayed grand entrance for visual pop
    setTimeout(() => {
        const copilotNode = document.getElementById('copilotNode');
        if (copilotNode && !copilotNode.classList.contains('expanded')) {
            teaserNode.classList.add('teaser-visible');
        }
    }, 2000);

    // Phrase Rotator Loop (Runs every 5.5 seconds)
    teaserInterval = setInterval(() => {
        teaserNode.classList.remove('teaser-visible');
        
        setTimeout(() => {
            currentIdx = (currentIdx + 1) % TEASER_PHRASES.length;
            textNode.textContent = TEASER_PHRASES[currentIdx];
            
            const copilotNode = document.getElementById('copilotNode');
            if (copilotNode && !copilotNode.classList.contains('expanded')) {
                teaserNode.classList.add('teaser-visible');
            }
        }, 400); 
    }, 5500);
}

function openChatWindow() {
    const copilotNode = document.getElementById('copilotNode');
    const toggleIcon = document.getElementById('toggleIcon');
    const teaserNode = document.getElementById('chatTeaser');
    
    if (copilotNode) copilotNode.classList.add('expanded');
    if (toggleIcon) toggleIcon.className = "fa-solid fa-chevron-down";
    
    if (teaserNode) {
        teaserNode.classList.remove('teaser-visible');
    }
}

function closeChatWindow() {
    const copilotNode = document.getElementById('copilotNode');
    const toggleIcon = document.getElementById('toggleIcon');
    const teaserNode = document.getElementById('chatTeaser');
    
    if (copilotNode) CustomEvent = copilotNode.classList.remove('expanded');
    if (toggleIcon) toggleIcon.className = "fa-solid fa-message";
    
    if (teaserNode) {
        setTimeout(() => {
            if (copilotNode && !copilotNode.classList.contains('expanded')) {
                teaserNode.classList.add('teaser-visible');
            }
        }, 300);
    }
}

function toggleWorkspaceSection(targetType) {
    const automationSection = document.getElementById('automation');
    const experienceSection = document.getElementById('experience');
    const capabilitiesSection = document.getElementById('capabilities');
    const btnProjects = document.getElementById('btn-projects');
    const btnExperience = document.getElementById('btn-experience');

    if (targetType === 'projects') {
        if (automationSection.style.display === 'block') {
            automationSection.style.display = 'none';
            automationSection.classList.remove('section-revealed');
            btnProjects.classList.remove('node-active');
        } else {
            automationSection.style.display = 'block';
            automationSection.classList.add('section-revealed');
            btnProjects.classList.add('node-active');

            experienceSection.style.display = 'none';
            experienceSection.classList.remove('section-revealed');
            if (capabilitiesSection) {
                capabilitiesSection.style.display = 'none';
                capabilitiesSection.classList.remove('section-revealed');
            }
            btnExperience.classList.remove('node-active');

            setTimeout(() => {
                automationSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
        }
    } 
    else if (targetType === 'experience') {
        if (experienceSection.style.display === 'block') {
            experienceSection.style.display = 'none';
            experienceSection.classList.remove('section-revealed');
            if (capabilitiesSection) {
                capabilitiesSection.style.display = 'none';
                capabilitiesSection.classList.remove('section-revealed');
            }
            btnExperience.classList.remove('node-active');
        } else {
            experienceSection.style.display = 'block';
            experienceSection.classList.add('section-revealed');
            if (capabilitiesSection) {
                capabilitiesSection.style.display = 'block';
                capabilitiesSection.classList.add('section-revealed');
            }
            btnExperience.classList.add('node-active');

            automationSection.style.display = 'none';
            automationSection.classList.remove('section-revealed');
            btnProjects.classList.remove('node-active');

            setTimeout(() => {
                experienceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
        }
    }
}

// --- 6. NETWORK PAYLOAD & CORE CONVERSATION PROCESSING ---
async function processUserSubmission() {
    const inputField = document.getElementById('userInputField');
    const logStream = document.getElementById('logStream');
    
    if (!inputField || !logStream || isWaitingForResponse) return;

    const rawQuery = inputField.value.trim();
    if (!rawQuery) return;

    // INTENT DETECTION: Extract target name dynamically to trigger identity ciphers
    const clearQuery = rawQuery.toLowerCase();
    if (clearQuery.startsWith("my name is ") || clearQuery.startsWith("i am ")) {
        const structuralWords = rawQuery.split(" ");
        visitorName = structuralWords[structuralWords.length - 1].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
        console.log(`🎯 Client visitor tracking state modified to target profile: "${visitorName}"`);
    }

    // If a human takeover is currently active, bypass LLM routes and pipe messages to polling pipeline
    if (isLiveHumanOverride) {
        appendMessageBubble('outgoing', rawQuery);
        inputField.value = '';
        try {
            await fetch('https://portfolio-196a.onrender.com/api/admin/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: rawQuery, sessionId })
            });
        } catch (e) {
            console.error("Direct live submission issue:", e);
        }
        return;
    }

    appendMessageBubble('outgoing', rawQuery);
    inputField.value = '';
    setChatLoadingState(true);

    // Speed Intercept Loop to preserve API quotas
    const matchedResponse = checkLocalFaqIntercept(rawQuery);
    if (matchedResponse) {
        setTimeout(() => {
            appendMessageBubble('incoming', matchedResponse);
            setChatLoadingState(false);
        }, 600);
        return;
    }

    // UPDATE STATE SCHEMA: Matches backend 'sender' and 'message' columns perfectly
    conversationHistory.push({ sender: 'user', message: rawQuery });
    if (conversationHistory.length > MAX_HISTORY_DEPTH) {
        conversationHistory.shift(); 
    }

    const typingIndicator = createTypingIndicator();
    logStream.appendChild(typingIndicator);
    logStream.scrollTop = logStream.scrollHeight;

    try {
        const controller = new AbortController();
        
        // Visual warning alert triggered if free tier takes longer than 4.5 seconds to respond
        const timeoutId = setTimeout(() => {
            appendMessageBubble('incoming', "⏰ Server Update: Yup, it's still rubbing its eyes. Render's free tier takes about 30 seconds to fully boot up on the first request. Hang tight, the gears are turning!");
        }, 4500);

        const response = await fetch('https://portfolio-196a.onrender.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: rawQuery,
                sessionId: sessionId,
                visitorName: visitorName,
                history: conversationHistory
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        typingIndicator.remove();

        if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
        
        const data = await response.json();
        
        // Catch the session ID if it was initialized dynamically on a backend cold-start
        if (data.sessionId) sessionId = data.sessionId;

        conversationHistory.push({ sender: 'assistant', message: data.reply });
        appendMessageBubble('incoming', data.reply);

    } catch (error) {
        if (typingIndicator) typingIndicator.remove();
        console.warn("Server connection offline. Relying on fallback notice.", error);
        appendMessageBubble('incoming', "⚠️ Server Offline: Since the backend isn't running right now, I can't look up custom queries. Try asking about my <strong>projects</strong>, <strong>stack</strong>, or <strong>experience</strong> to test my client-side offline memory!");
    } finally {
        setChatLoadingState(false);
    }
}

// --- 7. UTILITY METHODS & LIVE TRANSCRIPT SYNC PIPELINE ---
function checkLocalFaqIntercept(query) {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('email') || lowerQuery.includes('contact') || lowerQuery.includes('reach')) {
        return LOCAL_FAQ_REGISTRY.contact;
    }
    if (lowerQuery.includes('stack') || lowerQuery.includes('code') || lowerQuery.includes('languages')) {
        return LOCAL_FAQ_REGISTRY.stack;
    }
    if (lowerQuery.includes('resume') || lowerQuery.includes('experience') || lowerQuery.includes('history')) {
        return LOCAL_FAQ_REGISTRY.resume;
    }
    if (lowerQuery.includes('project') || lowerQuery.includes('build')) {
        return LOCAL_FAQ_REGISTRY.projects;
    }
    if (lowerQuery.includes('allianz') || lowerQuery.includes('good methods')) {
        return LOCAL_FAQ_REGISTRY.allianz;
    }
    return null;
}

function appendMessageBubble(type, text) {
    const logStream = document.getElementById('logStream');
    if (!logStream) return;

    const bubble = document.createElement('div');
    bubble.className = `${type}-bubble`;
    bubble.innerHTML = text.replace(/\n/g, '<br>');
    
    logStream.appendChild(bubble);
    logStream.scrollTop = logStream.scrollHeight;
}

function setChatLoadingState(loading) {
    isWaitingForResponse = loading;
    const inputField = document.getElementById('userInputField');
    const submitBtn = document.getElementById('submitLogBtn');

    if (inputField && submitBtn) {
        inputField.disabled = loading;
        submitBtn.disabled = loading;
        if (!loading) inputField.focus();
    }
}

function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'incoming-bubble typing-indicator-node';
    indicator.style.fontStyle = 'italic';
    indicator.style.color = '#888';
    indicator.textContent = 'Processing request...';
    return indicator;
}

// HUMAN INTERVENTION TRACKING SYNC (Polls the unified stateless sync pipeline)
function initializeHumanTakeoverMode() {
    if (isLiveHumanOverride) return;
    isLiveHumanOverride = true;

    appendMessageBubble('incoming', "⚡ Human Intervention Protocol Triggered. System alert dispatched to Akhin's personal control panel. Connecting...");
    
    // Store message offset count locally to prevent rendering duplicated chat logs
    let localRenderedCount = document.getElementById('logStream').children.length;

    liveCheckInterval = setInterval(async () => {
        if (!sessionId) return;
        try {
            const check = await fetch(`https://portfolio-196a.onrender.com/api/chat/sync?sessionId=${sessionId}`);
            const data = await check.json();
            
            if (data.messages && data.messages.length > 0) {
                // Filter down explicitly to messages posted by the administrator panel ('me')
                const adminPayloads = data.messages.filter(m => m.sender === 'me');
                
                if (adminPayloads.length > 0 && document.getElementById('logStream').children.length <= localRenderedCount) {
                    adminPayloads.forEach(msg => {
                        appendMessageBubble('incoming', `[Live Akhin]: ${msg.message}`);
                    });
                    localRenderedCount = document.getElementById('logStream').children.length;
                }
            }

            // Close the live loop gracefully if the human operator turns off override mode
            if (data.humanActive === false && isLiveHumanOverride) {
                clearInterval(liveCheckInterval);
                isLiveHumanOverride = false;
                appendMessageBubble('incoming', "Live connection closed. AI system tracking reassigned to standard copilot routine.");
            }
        } catch (e) {
            console.warn("Sync loop throttling connection check:", e);
        }
    }, 5000); // Checked every 5 seconds to match free-tier efficiency limits
}