import { randomBytes, randomUUID } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { Chess, type Square } from 'chess.js';
import { prisma, databaseConfigured } from './db.js';
import { socketAuth, type AuthUser } from './auth.js';
import { env } from './env.js';

type PlayerSlot = { user: AuthUser; socketId: string | null; connected: boolean };
type LiveGame = {
  id: string; code?: string; chess: Chess; white: PlayerSlot; black: PlayerSlot;
  createdAt: number; drawOffer: string | null; finished: boolean;
};
type QueueEntry = { socketId: string; user: AuthUser };

const games = new Map<string, LiveGame>();
const rooms = new Map<string, { ownerSocketId: string; owner: AuthUser }>();
const queue: QueueEntry[] = [];
const userSockets = new Map<string, string>();

function state(game: LiveGame) {
  return {
    gameId: game.id, code: game.code, fen: game.chess.fen(), pgn: game.chess.pgn(), turn: game.chess.turn(),
    white: { username: game.white.user.username, connected: game.white.connected },
    black: { username: game.black.user.username, connected: game.black.connected },
    check: game.chess.isCheck(), checkmate: game.chess.isCheckmate(), draw: game.chess.isDraw(),
    gameOver: game.chess.isGameOver(), drawOffer: game.drawOffer,
    result: game.chess.isCheckmate() ? (game.chess.turn() === 'w' ? '0-1' : '1-0') : game.chess.isDraw() ? '1/2-1/2' : null,
  };
}
function socketFor(io: Server, slot: PlayerSlot) { return slot.socketId ? io.sockets.sockets.get(slot.socketId) : undefined; }
function notifyState(io: Server, game: LiveGame) { io.to(game.id).emit('game:state', state(game)); }
function findPlayer(game: LiveGame, userId: string) {
  if (game.white.user.id === userId) return 'w';
  if (game.black.user.id === userId) return 'b';
  return null;
}
async function persistFinished(game: LiveGame, result: string) {
  if (!databaseConfigured) return;
  try {
    await prisma.match.create({ data: {
      whiteId: game.white.user.guest ? null : game.white.user.id,
      blackId: game.black.user.guest ? null : game.black.user.id,
      whiteName: game.white.user.username, blackName: game.black.user.username,
      mode: 'ONLINE', result, pgn: game.chess.pgn(), finalFen: game.chess.fen(), endedAt: new Date(),
    } });
  } catch (error) { console.error('Não foi possível salvar o histórico da partida:', error); }
}
function finishIfNeeded(game: LiveGame) {
  if (game.chess.isGameOver() && !game.finished) {
    game.finished = true;
    const result = game.chess.isCheckmate() ? (game.chess.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2';
    void persistFinished(game, result);
  }
}
function attachSocket(io: Server, socket: Socket, game: LiveGame, side: 'w' | 'b') {
  const slot = side === 'w' ? game.white : game.black;
  slot.socketId = socket.id; slot.connected = true;
  socket.join(game.id);
  socket.emit('game:joined', { ...state(game), color: side, gameId: game.id });
  notifyState(io, game);
}
function startGame(io: Server, first: QueueEntry, second: QueueEntry, code?: string) {
  const id = randomUUID();
  const game: LiveGame = {
    id, code, chess: new Chess(),
    white: { user: first.user, socketId: first.socketId, connected: true },
    black: { user: second.user, socketId: second.socketId, connected: true },
    createdAt: Date.now(), drawOffer: null, finished: false,
  };
  games.set(id, game);
  const white = io.sockets.sockets.get(first.socketId);
  const black = io.sockets.sockets.get(second.socketId);
  if (white) { white.join(id); white.emit('game:joined', { ...state(game), color: 'w', gameId: id }); }
  if (black) { black.join(id); black.emit('game:joined', { ...state(game), color: 'b', gameId: id }); }
  notifyState(io, game);
  return game;
}

export function configureSocket(io: Server) {
  io.use(async (socket, next) => {
    const user = socketAuth(socket.handshake.headers.cookie);
    if (!user) return next(new Error('Faça login ou entre como visitante para jogar online.'));
    if (!user.guest && databaseConfigured) {
      try {
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!dbUser || dbUser.suspended) return next(new Error('Esta conta não pode entrar no multiplayer.'));
        socket.data.user = { id: dbUser.id, username: dbUser.username, email: dbUser.email || undefined, role: dbUser.role, guest: dbUser.guest };
      } catch { return next(new Error('Não foi possível validar a conta.')); }
    } else socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    userSockets.set(user.id, socket.id);

    socket.on('matchmaking:join', () => {
      if (queue.some((entry) => entry.user.id === user.id)) return;
      const opponentIndex = queue.findIndex((entry) => entry.user.id !== user.id && io.sockets.sockets.has(entry.socketId));
      if (opponentIndex === -1) {
        queue.push({ socketId: socket.id, user });
        socket.emit('matchmaking:waiting', { message: 'Procurando um adversário real…' });
        return;
      }
      const [opponent] = queue.splice(opponentIndex, 1);
      startGame(io, opponent, { socketId: socket.id, user });
    });

    socket.on('matchmaking:cancel', () => {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].socketId === socket.id) queue.splice(i, 1);
      socket.emit('matchmaking:cancelled');
    });

    socket.on('room:create', () => {
      const code = randomBytes(3).toString('hex').toUpperCase();
      rooms.set(code, { ownerSocketId: socket.id, owner: user });
      socket.emit('room:created', { code, invitePath: `/play/room/${code}` });
    });

    socket.on('room:join', ({ code }: { code?: string }) => {
      const normalized = String(code || '').trim().toUpperCase();
      const room = rooms.get(normalized);
      if (!room) return socket.emit('game:error', { message: 'Sala não encontrada ou convite expirado.' });
      if (room.owner.id === user.id) return socket.emit('game:error', { message: 'Você não pode entrar na própria sala com a mesma conta.' });
      if (!io.sockets.sockets.has(room.ownerSocketId)) return socket.emit('game:error', { message: 'O criador da sala desconectou.' });
      rooms.delete(normalized);
      const game = startGame(io, { socketId: room.ownerSocketId, user: room.owner }, { socketId: socket.id, user }, normalized);
      socket.emit('room:joined', { gameId: game.id, code: normalized });
    });

    socket.on('game:move', ({ gameId, from, to, promotion }: { gameId?: string; from?: string; to?: string; promotion?: string }) => {
      const game = games.get(String(gameId || ''));
      if (!game || game.finished) return socket.emit('game:error', { message: 'Partida não encontrada ou encerrada.' });
      const side = findPlayer(game, user.id);
      if (!side || game.chess.turn() !== side) return socket.emit('game:error', { message: 'Não é sua vez de jogar.' });
      try {
        const move = game.chess.move({ from: from as Square, to: to as Square, promotion: (promotion || 'q') as 'q' | 'r' | 'b' | 'n' });
        if (!move) return socket.emit('game:error', { message: 'Jogada inválida.' });
        game.drawOffer = null;
        finishIfNeeded(game);
        notifyState(io, game);
        io.to(game.id).emit('game:last-move', { from: move.from, to: move.to, san: move.san, flags: move.flags });
      } catch { socket.emit('game:error', { message: 'Jogada ilegal. O servidor manteve a posição anterior.' }); }
    });

    socket.on('game:resign', ({ gameId }: { gameId?: string }) => {
      const game = games.get(String(gameId || ''));
      if (!game || game.finished || !findPlayer(game, user.id)) return;
      game.finished = true;
      const side = findPlayer(game, user.id);
      const result = side === 'w' ? '0-1' : '1-0';
      void persistFinished(game, result);
      io.to(game.id).emit('game:ended', { result, reason: 'resignation' });
    });

    socket.on('game:draw:offer', ({ gameId }: { gameId?: string }) => {
      const game = games.get(String(gameId || ''));
      if (!game || game.finished || !findPlayer(game, user.id)) return;
      game.drawOffer = user.id;
      notifyState(io, game);
    });
    socket.on('game:draw:respond', ({ gameId, accept }: { gameId?: string; accept?: boolean }) => {
      const game = games.get(String(gameId || ''));
      if (!game || game.finished || !findPlayer(game, user.id) || !game.drawOffer || game.drawOffer === user.id) return;
      if (accept) {
        game.finished = true; void persistFinished(game, '1/2-1/2');
        io.to(game.id).emit('game:ended', { result: '1/2-1/2', reason: 'agreement' });
      } else { game.drawOffer = null; notifyState(io, game); }
    });

    socket.on('game:reconnect', ({ gameId }: { gameId?: string }) => {
      const game = games.get(String(gameId || ''));
      if (!game) return socket.emit('game:error', { message: 'A partida não está mais disponível no servidor.' });
      const side = findPlayer(game, user.id);
      if (!side) return socket.emit('game:error', { message: 'Esta conta não participa da partida.' });
      attachSocket(io, socket, game, side);
    });

    socket.on('disconnect', () => {
      if (userSockets.get(user.id) === socket.id) userSockets.delete(user.id);
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].socketId === socket.id) queue.splice(i, 1);
      for (const [code, room] of rooms) if (room.ownerSocketId === socket.id) rooms.delete(code);
      for (const game of games.values()) {
        if (game.white.socketId === socket.id) game.white.connected = false;
        if (game.black.socketId === socket.id) game.black.connected = false;
        if (game.white.socketId === socket.id || game.black.socketId === socket.id) notifyState(io, game);
      }
    });
  });

  setInterval(() => {
    const cutoff = Date.now() - 1000 * 60 * 60 * 8;
    for (const [id, game] of games) if (game.createdAt < cutoff && game.finished) games.delete(id);
  }, 1000 * 60 * 10).unref();
}
