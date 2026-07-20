/**
 * Akhin Murali - Portfolio Engine Architecture
 * Production Realtime Intercept Chat Interface (Zero-Server-Load Edition)
 */

const BACKEND_URL = "https://portfolio-196a.onrender.com";

let SUPABASE_URL = "";
let SUPABASE_ANON_KEY = "";
let supabaseClient = null;

let conversationHistory = [];
const MAX_HISTORY_DEPTH = 6;
let isWaitingForResponse = false;
let isLiveHumanOverride = false;
let sessionId = null;          
let visitorName = "Guest";     
let renderedMessageIds = new Set();

const TEASER_PHRASES = [
    "🤖 System Status: Unsupervised. Talk to me.",
    "⚡ Click here to initiate Human Takeover protocol.",
    "🧠 Ask me how many cups of coffee built this site.",
    "👾 Warning: I know where the secret features are hidden.",
    "📂 Type 'resume' to see if I can break Akhin's firewall."
];

// --- 2. LOCAL FAQ INTERCEPTOR MATRIX (Updated with Notice Rule) ---
const LOCAL_FAQ_REGISTRY = {
    contact: "You can reach Akhin directly via email at akhinmurali@gmail.com. Note: during working hours it will be difficult to respond immediately, but if you don't find any response in a minute, please contact via email.You can also type in the chat to talk to me so the agent can connect me if I'm available.",
    email: "Akhin's professional email is akhinmurali@gmail.com. ",
    stack: "Akhin builds automation pipelines using JavaScript, Node.js, Express, Python, Google Gemini frameworks, and ServiceNow interfaces.",
    resume: "You can view Akhin's detailed roles and achievements by clicking the 'Explore My Work History' button right here on the main page.",
    projects: "His core builds include a Smart Digital Front Desk with live human takeover, an AI Resource Planner, and a PMO Automation Tool Suite.",
    allianz: "At Allianz, Akhin worked as a PMO Analyst focusing on project tracking tools and automated reporting scripts."
};

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

    if (automationSection) automationSection.style.display = 'none';
    if (experienceSection) experienceSection.style.display = 'none';
    if (capabilitiesSection) capabilitiesSection.style.display = 'none';

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

    if (btnProjects) btnProjects.addEventListener('click', () => toggleWorkspaceSection('projects'));
    if (btnExperience) btnExperience.addEventListener('click', () => toggleWorkspaceSection('experience'));

    if (userInputField && submitLogBtn) {
        submitLogBtn.addEventListener('click', processUserSubmission);
        userInputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') processUserSubmission();
        });
    }

    initializeTeaserEngine();
    initializeBackendSession();
});

async function initializeBackendSession() {
    try {
        const configResponse = await fetch(`${BACKEND_URL}/api/config`);
        const config = await configResponse.json();
        
        SUPABASE_URL = config.supabaseUrl;
        SUPABASE_ANON_KEY = config.supabaseAnonKey;
        
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const response = await fetch(`${BACKEND_URL}/api/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorName })
        });
        
        if (response.ok) {
            const data = await response.json();
            sessionId = data.sessionId;
            console.log(`📡 Handshake secure. WebSockets online. Session ID: ${sessionId}`);
            setupRealtimeListeners();
        }
    } catch (err) {
        console.warn("⚠️ Server cold-starting. Transitioning chat connection to autonomous fallback tracking mode.", err);
    }
}

function setupRealtimeListeners() {
    if (!sessionId || !supabaseClient) return;

    supabaseClient
        .channel('public:chat_messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
            const msg = payload.new;
            if (msg.session_id === sessionId && msg.sender === 'me') {
                if (!renderedMessageIds.has(msg.id)) {
                    renderedMessageIds.add(msg.id);
                    appendMessageBubble('incoming', `<strong>[Live Akhin]:</strong> ${msg.message}`);
                }
            }
        })
        .subscribe();

    supabaseClient
        .channel('public:chat_sessions')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_sessions' }, payload => {
            const updatedSession = payload.new;
            if (updatedSession.id === sessionId) {
                handleTakeoverUIStateChange(updatedSession.is_human_agent);
            }
        })
        .subscribe();
}

// 🛠️ FIXED STRUCTURAL SYNTAX CRASH HERE
function handleTakeoverUIStateChange(isHumanActive) {
    const headerTitleNode = document.querySelector('#chatHeader h4');
    
    if (isHumanActive) {
        isLiveHumanOverride = true;
        if (headerTitleNode) headerTitleNode.innerHTML = "💬 Chatting with Akhin (Live)";
    } else {
        isLiveHumanOverride = false;
        if (headerTitleNode) headerTitleNode.innerHTML = "🤖 Portfolio Copilot";
    }
}

function initializeTeaserEngine() {
    const teaserNode = document.getElementById('chatTeaser');
    const textNode = document.getElementById('teaserText');
    if (!teaserNode || !textNode) return;

    let currentIdx = 0;
    textNode.textContent = TEASER_PHRASES[0];

    setTimeout(() => {
        const copilotNode = document.getElementById('copilotNode');
        if (copilotNode && !copilotNode.classList.contains('expanded')) {
            teaserNode.classList.add('teaser-visible');
        }
    }, 2000);

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
    if (teaserNode) teaserNode.classList.remove('teaser-visible');
}

function closeChatWindow() {
    const copilotNode = document.getElementById('copilotNode');
    const toggleIcon = document.getElementById('toggleIcon');
    const teaserNode = document.getElementById('chatTeaser');
    
    if (copilotNode) copilotNode.classList.remove('expanded');
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
            setTimeout(() => { automationSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
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
            setTimeout(() => { experienceSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
        }
    }
}

async function processUserSubmission() {
    const inputField = document.getElementById('userInputField');
    const logStream = document.getElementById('logStream');
    
    if (!inputField || !logStream || isWaitingForResponse) return;

    const rawQuery = inputField.value.trim();
    if (!rawQuery) return;

    const clearQuery = rawQuery.toLowerCase();
    if (clearQuery.startsWith("my name is ") || clearQuery.startsWith("i am ")) {
        const structuralWords = rawQuery.split(" ");
        visitorName = structuralWords[structuralWords.length - 1].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
    }

    appendMessageBubble('outgoing', rawQuery);
    inputField.value = '';
    setChatLoadingState(true);

    if (isLiveHumanOverride) {
        try {
            await fetch(`${BACKEND_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: rawQuery, sessionId, visitorName })
            });
        } catch (e) {
            console.error("Manual override transmission failed:", e);
        } finally {
            setChatLoadingState(false);
        }
        return;
    }

    const matchedResponse = checkLocalFaqIntercept(rawQuery);
    if (matchedResponse) {
        setTimeout(() => {
            appendMessageBubble('incoming', matchedResponse);
            setChatLoadingState(false);
        }, 600);
        return;
    }

    conversationHistory.push({ sender: 'user', message: rawQuery });
    if (conversationHistory.length > MAX_HISTORY_DEPTH) conversationHistory.shift(); 

    const typingIndicator = createTypingIndicator();
    logStream.appendChild(typingIndicator);
    logStream.scrollTop = logStream.scrollHeight;

    try {
        const timeoutId = setTimeout(() => {
            appendMessageBubble('incoming', "⏰ Server Update: Render's free tier takes about 30 seconds to fully boot up on the first request. Hang tight!");
        }, 4500);

        const response = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: rawQuery,
                sessionId: sessionId,
                visitorName: visitorName,
                history: conversationHistory
            })
        });
        
        clearTimeout(timeoutId);
        typingIndicator.remove();

        if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
        
        const data = await response.json();
        if (data.sessionId) sessionId = data.sessionId;

        if (data.humanActive) {
            isLiveHumanOverride = true;
            handleTakeoverUIStateChange(true);
        }

        if (data.reply) {
            conversationHistory.push({ sender: 'assistant', message: data.reply });
            appendMessageBubble('incoming', data.reply);
        }
    } catch (error) {
        if (typingIndicator) typingIndicator.remove();
        appendMessageBubble('incoming', "⚠️ Server Offline: Try asking about my <strong>projects</strong>, <strong>stack</strong>, or <strong>experience</strong>!");
    } finally {
        setChatLoadingState(false);
    }
}

function checkLocalFaqIntercept(query) {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('email') || lowerQuery.includes('contact') || lowerQuery.includes('reach')) return LOCAL_FAQ_REGISTRY.contact;
    if (lowerQuery.includes('stack') || lowerQuery.includes('code') || lowerQuery.includes('languages')) return LOCAL_FAQ_REGISTRY.stack;
    if (lowerQuery.includes('resume') || lowerQuery.includes('experience') || lowerQuery.includes('history')) return LOCAL_FAQ_REGISTRY.resume;
    if (lowerQuery.includes('project') || lowerQuery.includes('build')) return LOCAL_FAQ_REGISTRY.projects;
    if (lowerQuery.includes('allianz') || lowerQuery.includes('good methods')) return LOCAL_FAQ_REGISTRY.allianz;
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