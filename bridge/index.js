const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const cors = require('cors');

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const app = express();
app.use(cors());
app.use(express.json());
// Placeholder chat endpoint
app.post('/api/chat', (req, res) => {
    const { message, aiMode, provider, attachments } = req.body;
    const attachmentCount = Array.isArray(attachments) ? attachments.length : 0;
    const reply = attachmentCount > 0
        ? `AI is thinking..! (received ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''})`
        : 'AI is thinking..!';
    res.json({ reply });
});
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

io.on('connection', (socket) => {
    // Spawn a new shell for each connection
    const shell = pty.spawn('bash', [], {
        name: 'xterm-color',
        cwd: process.env.HOME,
        env: process.env
    });

    // Send shell output to client
    shell.onData((data) => {
        socket.emit('output', data);
    });

    // Receive input from client and send to shell
    socket.on('input', (data) => {
        shell.write(data);
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
        shell.kill();
    });
});

server.timeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 1000;
server.requestTimeout = REQUEST_TIMEOUT_MS + 1000;

server.listen(3000, () => {
    console.log('Bridge API running on port 3000');
});
