
const socket = io();

let currentUser = null;
let currentRoom = null;
let localStream = null;
let screenStream = null;
const peerConnections = {}; 
let isAudioMuted = false;
let isVideoOff = false;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const screens = {
    auth: document.getElementById('auth-screen'),
    room: document.getElementById('room-screen'),
    meeting: document.getElementById('meeting-screen')
};

let isRegisterMode = false;
const authForm = document.getElementById('auth-form');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authTitle = document.querySelector('#auth-screen h2');
const authSubtitle = document.getElementById('auth-subtitle');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');

authToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isRegisterMode = !isRegisterMode;
    authTitle.textContent = isRegisterMode ? 'Register' : 'ConnectMeet';
    authSubtitle.textContent = isRegisterMode ? 'Create a new account' : 'Sign in to your account';
    authBtn.textContent = isRegisterMode ? 'Register' : 'Login';
    document.getElementById('auth-toggle-msg').textContent = isRegisterMode ? 'Already have an account?' : "Don't have an account?";
    authToggleBtn.textContent = isRegisterMode ? 'Login' : 'Register';
    authError.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    const endpoint = isRegisterMode ? '/api/register' : '/api/login';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message);

        if (isRegisterMode) {
            alert(data.message);
            authToggleBtn.click();
        } else {
            currentUser = data.username;
            document.getElementById('display-user').textContent = currentUser;
            showScreen('room');
        }
    } catch (err) {
        authError.textContent = err.message;
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    currentUser = null;
    showScreen('auth');
});

function showScreen(screenName) {
    Object.keys(screens).forEach(key => screens[key].classList.remove('active'));
    screens[screenName].classList.add('active');
}

const roomForm = document.getElementById('room-form');
roomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    currentRoom = document.getElementById('room-id').value.trim();
    if (!currentRoom) return;

    document.getElementById('current-room-display').textContent = currentRoom;
    showScreen('meeting');
    
    resizeCanvas();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
    } catch (err) {
        console.warn('Could not acquire audio/video stream:', err);
        localStream = new MediaStream(); // Fallback empty stream
    }

    socket.emit('join-room', { roomId: currentRoom, username: currentUser });
});

document.getElementById('leave-btn').addEventListener('click', () => {
    location.reload(); // Simple cleanup on room leave
});

socket.on('existing-users', (users) => {
    users.forEach(u => initiatePeerConnection(u.peerId, u.username, true));
});

socket.on('user-connected', ({ peerId, username }) => {
    appendSystemMessage(`${username} joined the room.`);
    initiatePeerConnection(peerId, username, false);
});

function initiatePeerConnection(peerId, peerName, isOfferInitiator) {
    if (peerConnections[peerId]) return;

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[peerId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('signal', { targetId: peerId, signalData: { candidate: e.candidate } });
        }
    };

    pc.ontrack = (e) => {
        if (!document.getElementById(`video-${peerId}`)) {
            createVideoCard(peerId, peerName, e.streams[0]);
        }
    };

    if (isOfferInitiator) {
        pc.onnegotiationneeded = async () => {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('signal', { targetId: peerId, signalData: { sdp: pc.localDescription } });
            } catch (err) {
                console.error(err);
            }
        };
    }
}

socket.on('signal', async ({ senderId, signalData }) => {
    const pc = peerConnections[senderId];

    if (!pc) return;

    try {
        if (signalData.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
            if (signalData.sdp.type === 'offer') {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('signal', { targetId: senderId, signalData: { sdp: pc.localDescription } });
            }
        } else if (signalData.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        }
    } catch (err) {
        console.error('Signaling error:', err);
    }
});

socket.on('user-disconnected', ({ peerId, username }) => {
    appendSystemMessage(`${username} left the room.`);
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    const card = document.getElementById(`card-${peerId}`);
    if (card) card.remove();
});

function createVideoCard(peerId, username, stream) {
    const grid = document.getElementById('video-grid');
    const card = document.createElement('div');
    card.className = 'video-card';
    card.id = `card-${peerId}`;

    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('span');
    label.className = 'video-label';
    label.textContent = username;

    card.appendChild(video);
    card.appendChild(label);
    grid.appendChild(card);
}


const micBtn = document.getElementById('mic-btn');
micBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isAudioMuted = !isAudioMuted;
        audioTrack.enabled = !isAudioMuted;
        micBtn.textContent = isAudioMuted ? '🎙️ Unmute Mic' : '🎤 Mute Mic';
        micBtn.classList.toggle('off', isAudioMuted);
    }
});

const camBtn = document.getElementById('cam-btn');
camBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        isVideoOff = !isVideoOff;
        videoTrack.enabled = !isVideoOff;
        camBtn.textContent = isVideoOff ? '📷 Turn On Cam' : '📷 Turn Off Cam';
        camBtn.classList.toggle('off', isVideoOff);
    }
});

const screenBtn = document.getElementById('screen-btn');
screenBtn.addEventListener('click', async () => {
    try {
        if (!screenStream) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0]
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
            });

            document.getElementById('local-video').srcObject = screenStream;
            screenBtn.textContent = '⏹️ Stop Sharing';
            screenBtn.classList.add('off');

            screenTrack.onended = stopScreenShare;
        } else {
            stopScreenShare();
        }
    } catch (err) {
        console.error("Screen sharing error:", err);
    }
});

function stopScreenShare() {
    if (!screenStream) return;
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;

    const origVideoTrack = localStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(origVideoTrack);
    });

    document.getElementById('local-video').srcObject = localStream;
    screenBtn.textContent = '🖥️ Share Screen';
    screenBtn.classList.remove('off');
}


const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
        socket.emit('send-message', text);
        chatInput.value = '';
    }
});

socket.on('receive-message', (data) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<div class="sender">${data.sender} <span class="time">${data.time}</span></div><div>${escapeHTML(data.text)}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

function appendSystemMessage(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = msg;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

const fileBtn = document.getElementById('file-btn');
const fileInput = document.getElementById('file-input');

fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        alert('File size limit is 2MB for demo.');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        socket.emit('send-file', {
            fileName: file.name,
            fileType: file.type,
            fileRaw: reader.result
        });
        appendFileLink({ sender: 'You', fileName: file.name, fileRaw: reader.result });
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
});

socket.on('receive-file', (data) => {
    appendFileLink(data);
});

function appendFileLink(data) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `
        <div class="sender">${data.sender}</div>
        <div>Shared File:</div>
        <a href="${data.fileRaw}" download="${escapeHTML(data.fileName)}" class="file-link">💾 ${escapeHTML(data.fileName)}</a>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

const wbToggleBtn = document.getElementById('toggle-whiteboard-btn');
const wbContainer = document.getElementById('whiteboard-container');
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const colorInput = document.getElementById('wb-color');
const sizeInput = document.getElementById('wb-size');
const clearBtn = document.getElementById('wb-clear');

let drawing = false;

wbToggleBtn.addEventListener('click', () => {
    wbContainer.classList.toggle('hidden');
    if (!wbContainer.classList.contains('hidden')) {
        resizeCanvas();
    }
});

function resizeCanvas() {
    canvas.width = wbContainer.clientWidth;
    canvas.height = wbContainer.clientHeight - 40; // Exclude top sub-bar
}

window.addEventListener('resize', () => {
    if (!wbContainer.classList.contains('hidden')) resizeCanvas();
});

canvas.addEventListener('mousedown', (e) => startDrawing(e));
canvas.addEventListener('mouseup', () => stopDrawing());
canvas.addEventListener('mousemove', (e) => draw(e));

function startDrawing(e) {
    drawing = true;
    draw(e);
}

function stopDrawing() {
    drawing = false;
    ctx.beginPath();
}

function draw(e) {
    if (!drawing) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const strokeData = {
        x, y,
        color: colorInput.value,
        size: sizeInput.value
    };

    drawLocal(strokeData);
    socket.emit('draw-stroke', strokeData);
}

function drawLocal({ x, y, color, size }) {
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
}

socket.on('draw-stroke', (strokeData) => {
    drawLocal(strokeData);
});

clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear-canvas');
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});