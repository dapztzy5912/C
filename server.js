const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

const gameRooms = {};

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    socket.on('createRoom', (playerName) => {
        let roomCode;
        
        do {
            roomCode = generateRoomCode();
        } while (gameRooms[roomCode]);
        
        gameRooms[roomCode] = {
            player1: socket.id,
            player2: null,
            player1Name: playerName || 'Player 1',
            player2Name: null,
            player1Choice: null,
            player2Choice: null,
            gameActive: true
        };
        
        socket.join(roomCode);
        
        socket.emit('roomCreated', roomCode);
        console.log(`Room created: ${roomCode} by player ${socket.id} (${playerName})`);
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;
        
        if (!gameRooms[roomCode]) {
            socket.emit('roomError', 'Room not found');
            return;
        }
        
        if (gameRooms[roomCode].player2) {
            socket.emit('roomError', 'Room is full');
            return;
        }
        
        gameRooms[roomCode].player2 = socket.id;
        gameRooms[roomCode].player2Name = playerName || 'Player 2';
        socket.join(roomCode);
        
        socket.emit('roomJoined', {
            roomCode: roomCode,
            player1Name: gameRooms[roomCode].player1Name
        });
        io.to(gameRooms[roomCode].player1).emit('opponentJoined', playerName);
        
        console.log(`Player ${socket.id} (${playerName}) joined room ${roomCode}`);
    });

    socket.on('playerChoice', (data) => {
        const { roomCode, choice } = data;
        
        if (!gameRooms[roomCode]) {
            return;
        }
        
        const room = gameRooms[roomCode];
        
        if (socket.id === room.player1) {
            room.player1Choice = choice;
            if (room.player2) {
                io.to(room.player2).emit('opponentMadeChoice');
            }
        } else if (socket.id === room.player2) {
            room.player2Choice = choice;
            io.to(room.player1).emit('opponentMadeChoice');
        }
        
        if (room.player1Choice && room.player2Choice) {
            determineWinner(roomCode);
        }
    });

    socket.on('playAgain', (roomCode) => {
        if (!gameRooms[roomCode]) return;
        
        gameRooms[roomCode].player1Choice = null;
        gameRooms[roomCode].player2Choice = null;
        
        io.to(roomCode).emit('gameReset');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        for (const roomCode in gameRooms) {
            const room = gameRooms[roomCode];
            
            if (room.player1 === socket.id) {
                if (room.player2) {
                    io.to(room.player2).emit('opponentLeft');
                }
                delete gameRooms[roomCode];
                console.log(`Room ${roomCode} deleted because player 1 left`);
            } else if (room.player2 === socket.id) {
                io.to(room.player1).emit('opponentLeft');
                room.player2 = null;
                room.player2Name = null;
                room.player2Choice = null;
                console.log(`Player 2 left room ${roomCode}`);
            }
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        if (!gameRooms[roomCode]) return;
        
        const room = gameRooms[roomCode];
        
        if (room.player1 === socket.id) {
            if (room.player2) {
                io.to(room.player2).emit('opponentLeft');
            }
            delete gameRooms[roomCode];
            console.log(`Room ${roomCode} deleted because player 1 left`);
        } else if (room.player2 === socket.id) {
            io.to(room.player1).emit('opponentLeft');
            room.player2 = null;
            room.player2Name = null;
            room.player2Choice = null;
            console.log(`Player 2 left room ${roomCode}`);
        }
        
        socket.leave(roomCode);
    });
});

function determineWinner(roomCode) {
    const room = gameRooms[roomCode];
    const player1Choice = room.player1Choice;
    const player2Choice = room.player2Choice;
    
    let result;
    
    if (player1Choice === player2Choice) {
        result = 'draw';
    } else if (
        (player1Choice === 'rock' && player2Choice === 'scissors') ||
        (player1Choice === 'paper' && player2Choice === 'rock') ||
        (player1Choice === 'scissors' && player2Choice === 'paper')
    ) {
        result = 'player1';
    } else {
        result = 'player2';
    }
    
    io.to(room.player1).emit('gameResult', {
        yourChoice: player1Choice,
        opponentChoice: player2Choice,
        result: result === 'draw' ? 'draw' : (result === 'player1' ? 'win' : 'lose')
    });
    
    io.to(room.player2).emit('gameResult', {
        yourChoice: player2Choice,
        opponentChoice: player1Choice,
        result: result === 'draw' ? 'draw' : (result === 'player2' ? 'win' : 'lose')
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
