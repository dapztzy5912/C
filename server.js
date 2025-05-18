const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active game rooms
const gameRooms = {};

// Function to generate a random room code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Handle socket connections
io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    // Create a new game room
    socket.on('createRoom', (playerName) => {
        let roomCode;
        
        // Generate a unique room code
        do {
            roomCode = generateRoomCode();
        } while (gameRooms[roomCode]);
        
        // Create the room
        gameRooms[roomCode] = {
            player1: socket.id,
            player2: null,
            player1Name: playerName || 'Player 1',
            player2Name: null,
            player1Choice: null,
            player2Choice: null,
            gameActive: true
        };
        
        // Join the socket to the room
        socket.join(roomCode);
        
        // Send room code back to the client
        socket.emit('roomCreated', roomCode);
        console.log(`Room created: ${roomCode} by player ${socket.id} (${playerName})`);
    });

    // Join an existing game room
    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;
        
        // Check if room exists and is not full
        if (!gameRooms[roomCode]) {
            socket.emit('roomError', 'Room not found');
            return;
        }
        
        if (gameRooms[roomCode].player2) {
            socket.emit('roomError', 'Room is full');
            return;
        }
        
        // Join the room
        gameRooms[roomCode].player2 = socket.id;
        gameRooms[roomCode].player2Name = playerName || 'Player 2';
        socket.join(roomCode);
        
        // Inform both players that the game can start
        socket.emit('roomJoined', {
            roomCode: roomCode,
            player1Name: gameRooms[roomCode].player1Name
        });
        io.to(gameRooms[roomCode].player1).emit('opponentJoined', playerName);
        
        console.log(`Player ${socket.id} (${playerName}) joined room ${roomCode}`);
    });

    // Handle player choice
    socket.on('playerChoice', (data) => {
        const { roomCode, choice } = data;
        
        // Validate roomCode
        if (!gameRooms[roomCode]) {
            return;
        }
        
        const room = gameRooms[roomCode];
        
        // Determine which player made the choice and store it
        if (socket.id === room.player1) {
            room.player1Choice = choice;
            // Notify player 2 that player 1 has made a choice
            if (room.player2) {
                io.to(room.player2).emit('opponentMadeChoice');
            }
        } else if (socket.id === room.player2) {
            room.player2Choice = choice;
            // Notify player 1 that player 2 has made a choice
            io.to(room.player1).emit('opponentMadeChoice');
        }
        
        // Check if both players have made their choices
        if (room.player1Choice && room.player2Choice) {
            determineWinner(roomCode);
        }
    });

    // Handle rematch request
    socket.on('playAgain', (roomCode) => {
        if (!gameRooms[roomCode]) return;
        
        // Reset choices
        gameRooms[roomCode].player1Choice = null;
        gameRooms[roomCode].player2Choice = null;
        
        // Notify both players
        io.to(roomCode).emit('gameReset');
    });

    // Handle player disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Find and clean up any rooms this player was in
        for (const roomCode in gameRooms) {
            const room = gameRooms[roomCode];
            
            if (room.player1 === socket.id) {
                // Notify player 2 if they exist
                if (room.player2) {
                    io.to(room.player2).emit('opponentLeft');
                }
                delete gameRooms[roomCode];
                console.log(`Room ${roomCode} deleted because player 1 left`);
            } else if (room.player2 === socket.id) {
                // Notify player 1
                io.to(room.player1).emit('opponentLeft');
                room.player2 = null;
                room.player2Name = null;
                room.player2Choice = null;
                console.log(`Player 2 left room ${roomCode}`);
            }
        }
    });

    // Leave room intentionally
    socket.on('leaveRoom', (roomCode) => {
        if (!gameRooms[roomCode]) return;
        
        const room = gameRooms[roomCode];
        
        if (room.player1 === socket.id) {
            // Player 1 is leaving, notify player 2 if they exist
            if (room.player2) {
                io.to(room.player2).emit('opponentLeft');
            }
            delete gameRooms[roomCode];
            console.log(`Room ${roomCode} deleted because player 1 left`);
        } else if (room.player2 === socket.id) {
            // Player 2 is leaving, notify player 1
            io.to(room.player1).emit('opponentLeft');
            room.player2 = null;
            room.player2Name = null;
            room.player2Choice = null;
            console.log(`Player 2 left room ${roomCode}`);
        }
        
        socket.leave(roomCode);
    });
});

// Determine the winner and notify both players
function determineWinner(roomCode) {
    const room = gameRooms[roomCode];
    const player1Choice = room.player1Choice;
    const player2Choice = room.player2Choice;
    
    // Determine the result
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
    
    // Send results to both players
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

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
