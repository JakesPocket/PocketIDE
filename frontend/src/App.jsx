import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import { io } from 'socket.io-client';
import './App.css';
import Chat from './Chat';

function App() {
  const xtermRef = useRef(null);
  const termRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    termRef.current = new Terminal({
      cursorBlink: true,
      fontSize: 16,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
      },
    });
    termRef.current.open(xtermRef.current);
    termRef.current.focus();
    termRef.current.resize(80, 24);

    const socketUrl = 'https://organic-space-bassoon-6v9prvrqx9qc5xx5-3000.app.github.dev/';
    socketRef.current = io(socketUrl, {
      transports: ['websocket']
    });

    // Log connection status directly to the terminal
    socketRef.current.on('connect', () => {
      termRef.current.writeln('\x1b[32m[Socket.io] Connected\x1b[0m');
    });
    socketRef.current.on('connect_error', (err) => {
      termRef.current.writeln(`\x1b[31m[Socket.io] Connect error to: ${socketUrl} | ${err.message}\x1b[0m`);
    });

    socketRef.current.on('output', (data) => {
      termRef.current.write(data);
    });

    termRef.current.onData((data) => {
      socketRef.current.emit('input', data);
    });

    return () => {
      if (termRef.current) {
        termRef.current.dispose();
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div
        ref={xtermRef}
        style={{ flex: 1, background: '#1e1e1e' }}
      ></div>
      <div style={{ width: 400, borderLeft: '1px solid #eee', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
        <Chat />
      </div>
    </div>
  );
}

export default App;
