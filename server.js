const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


const usersDB = {}; 
const rooms = {};   
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
  
    if (!username || !password || username.trim().length < 3 || password.length < 4) {
        return res.status(400).json({ message: 'Username (min 3 chars) & Password (min 4 chars) required.' });
    }
    
    const cleanUsername = username.trim().toLowerCase();
    if (usersDB[cleanUsername]) {
        return res.status(400).json({ message: 'User already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    usersDB[cleanUsername] = hashedPassword;
    return res.status(201).json({ message: 'Registration successful! You can now login.' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Please provide both username and password.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const userHash = usersDB[cleanUsername];

    if (!userHash) {
        return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const isPasswordValid = await bcrypt.compare(password, userHash);
    if (!isPasswordValid) {
        return res.status(400).json({ message: 'Invalid credentials.' });
    }

    return res.status(200).json({ message: 'Login successful!', username: cleanUsername });
});

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('join-room', ({ roomId, username }) => {
       
        if (!roomId || !username) return;

        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username;

        if (!rooms[roomId]) rooms[roomId] = {};
        rooms[roomId][socket.id] = username;

      
        socket.to(roomId).emit('user-connected', { peerId: socket.id, username });

        const existingUsers = Object.keys(rooms[roomId])
            .filter(id => id !== socket.id)
            .map(id => ({ peerId: id, username: rooms[roomId][id] }));
            
        socket.emit('existing-users', existingUsers);
    });

    socket.on('signal', ({ targetId, signalData }) => {
        io.to(targetId).emit('signal', {
            senderId: socket.id,
            signalData
        });
    });

    socket.on('send-message', (messageText) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('receive-message', {
            sender: socket.username,
            text: messageText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    socket.on('send-file', (fileData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('receive-file', {
            sender: socket.username,
            fileName: fileData.fileName,
            fileType: fileData.fileType,
            fileRaw: fileData.fileRaw
        });
    });

    socket.on('draw-stroke', (drawData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('draw-stroke', drawData);
    });

    socket.on('clear-canvas', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('clear-canvas');
    });

   
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            delete rooms[roomId][socket.id];
            if (Object.keys(rooms[roomId]).length === 0) {
                delete rooms[roomId];
            }
            io.to(roomId).emit('user-disconnected', { peerId: socket.id, username: socket.username });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ConnectMeet Server running on http://localhost:${PORT}`));