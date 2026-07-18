// ==========================================================================
// CORE UI BINDINGS & STATE MANAGEMENT
// ==========================================================================
const copilotNode = document.getElementById('copilotNode');
const copilotHeader = document.getElementById('copilotHeader');
const toggleIcon = document.getElementById('toggleIcon');
const logStream = document.getElementById('logStream');
const userInputField = document.getElementById('userInputField');
const submitLogBtn = document.getElementById('submitLogBtn');

const BACKEND_URL = 'http://localhost:5000/api';

// Persistent State
let currentSessionId = null; 
let liveHumanOverrideActive = false;
let visitorName = 'Guest';
let conversationHistory = []; // Track conversation state locally

// ==========================================================================
// SESSION CREATION
// ==========================================================================
async function initializeSession(nameForSession) {
    try {
        const response = await fetch(`${BACKEND_URL}/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorName: nameForSession || 'Guest' })
        });
        const data = await response.json();
        if (data.sessionId) {
            currentSessionId = data.sessionId;
        }
    } catch (error) {
        console.error('Session initialization failed:', error);
    }
}

// ==========================================================================
// AUTOMATED INITIALIZATION & GREETING PIPELINE
// ==========================================================================
window.addEventListener('DOMContentLoaded', async () => {
    localStorage.removeItem('chatSessionId');
    liveHumanOverrideActive = false;
    logStream.innerHTML = '';
    conversationHistory = [];

    console.log("🔄 Reset: New anonymous guest environment prepared.");

    await initializeSession('Guest');

    setTimeout(() => {
        copilotNode.classList.add('expanded');
        toggleIcon.className = "fa-solid fa-chevron-down";

        const greetingBox = document.createElement('div');
        greetingBox.className = 'incoming-bubble';
        greetingBox.textContent = "Welcome! Before we get started, what should I call you?";
        logStream.appendChild(greetingBox);
        logStream.scrollTop = logStream.scrollHeight;
    }, 1000);
});

// ==========================================================================
// INTERFACE COLLAPSE/EXPAND LOGIC
// ==========================================================================
copilotHeader.addEventListener('click', () => {
    copilotNode.classList.toggle('expanded');
    toggleIcon.className = copilotNode.classList.contains('expanded')
        ? "fa-solid fa-chevron-down"
        : "fa-solid fa-chevron-up";
});

// ==========================================================================
// CENTRAL QUERY EXECUTION PIPELINE
// ==========================================================================
async function handleQuerySubmission() {
    const textValue = userInputField.value.trim();
    if (!textValue) return;

    // Capture visitor name if it's the initial interaction
    if (visitorName === 'Guest' && conversationHistory.length === 0) {
        visitorName = textValue;
    }

    // Render outgoing user bubble
    const userBox = document.createElement('div');
    userBox.className = 'outgoing-bubble';
    userBox.textContent = textValue;
    logStream.appendChild(userBox);
    userInputField.value = '';
    logStream.scrollTop = logStream.scrollHeight;

    // Render processing indicator
    const systemBox = document.createElement('div');
    systemBox.className = 'incoming-bubble';
    systemBox.textContent = liveHumanOverrideActive ? "Typing..." : "Analyzing parameters...";
    logStream.appendChild(systemBox);
    logStream.scrollTop = logStream.scrollHeight;

    if (!currentSessionId) {
        await initializeSession(visitorName);
    }

    try {
        const response = await fetch(`${BACKEND_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: textValue,
                sessionId: currentSessionId,
                visitorName: visitorName,
                history: conversationHistory // Send the context history down the pipeline
            })
        });

        const data = await response.json();

        // Human takeover check
        if (data.humanActive) {
            if (!liveHumanOverrideActive) {
                liveHumanOverrideActive = true;
                systemBox.textContent = "⚡ System Copilot disconnected. Akhin Murali is taking over this channel live...";
                const onlineIndicator = copilotHeader.querySelector('.online-indicator');
                if (onlineIndicator) onlineIndicator.style.background = "#ff0055";
            } else {
                systemBox.remove();
            }
            return;
        }

        // Push user message to history stack
        conversationHistory.push({ sender: 'user', message: textValue });

        // FIX: Extract data.reply instead of data.response
        systemBox.textContent = "";
        const targetText = data.reply || "No payload connection returned.";

        // Push assistant response to history stack
        conversationHistory.push({ sender: 'assistant', message: targetText });

        // Typewriter render
        let charIndex = 0;
        function writeCharacter() {
            if (charIndex < targetText.length) {
                systemBox.textContent += targetText.charAt(charIndex);
                charIndex++;
                logStream.scrollTop = logStream.scrollHeight;
                setTimeout(writeCharacter, 12);
            }
        }
        writeCharacter();

    } catch (error) {
        console.error('System Connectivity Interrupted:', error);
        systemBox.textContent = "Log Error: Request pipeline timeout. Ensure backend endpoint is active.";
    }
}

// ==========================================================================
// BACKGROUND LIVE TIMELINE SYNC (POLLING LOOP)
// ==========================================================================
async function syncLiveChatTimeline() {
    if (!currentSessionId) return;

    try {
        const response = await fetch(`${BACKEND_URL}/chat/sync?sessionId=${currentSessionId}`);
        if (!response.ok) return;
        const data = await response.json();

        if (data.humanActive && !liveHumanOverrideActive) {
            liveHumanOverrideActive = true;

            document.querySelectorAll('.incoming-bubble').forEach(b => {
                if (b.textContent === "Analyzing parameters..." || b.textContent === "Typing...") {
                    b.textContent = "⚡ System Copilot disconnected. Akhin Murali is taking over this channel live...";
                }
            });

            const onlineIndicator = copilotHeader.querySelector('.online-indicator');
            if (onlineIndicator) onlineIndicator.style.background = "#ff0055";

        } else if (!data.humanActive && liveHumanOverrideActive) {
            liveHumanOverrideActive = false;
            const onlineIndicator = copilotHeader.querySelector('.online-indicator');
            if (onlineIndicator) onlineIndicator.style.background = "#238636";
        }

        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(msg => {
                if (msg.sender === 'me') {
                    const existingBubbles = Array.from(logStream.querySelectorAll('.incoming-bubble'));
                    const alreadyRendered = existingBubbles.some(b => b.textContent === msg.message);

                    if (!alreadyRendered) {
                        const liveBox = document.createElement('div');
                        liveBox.className = 'incoming-bubble';
                        liveBox.style.borderLeft = "3px solid #ff0055";
                        liveBox.textContent = msg.message;
                        logStream.appendChild(liveBox);
                        logStream.scrollTop = logStream.scrollHeight;
                        
                        // Append admin takeover text into local context histories 
                        conversationHistory.push({ sender: 'assistant', message: msg.message });
                    }
                }
            });
        }
    } catch (error) {
        console.error('Timeline stream synchronization interrupted:', error);
    }
}

setInterval(syncLiveChatTimeline, 2000);

// ==========================================================================
// ACTION TARGET OBSERVERS
// ==========================================================================
submitLogBtn.addEventListener('click', handleQuerySubmission);
userInputField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleQuerySubmission();
});