import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { env } from './env.js';
import { prisma } from './db.js';
import { router } from './routes.js';
import { configureSocket } from './socket.js';

const app = express();
const server = http.createServer(app);
const allowedOrigins = env.frontendUrl.split(',').map((value) => value.trim()).filter(Boolean);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true, methods: ['GET', 'POST'] },
  pingInterval: 25000, pingTimeout: 20000,
});

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origem não autorizada pelo CORS.'));
}, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', router);
app.get('/', (_req, res) => res.json({ name: 'Chess Realm API', health: '/api/health' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

configureSocket(io);
server.listen(env.port, () => console.log(`Chess Realm API ouvindo na porta ${env.port}`));

async function shutdown() {
  io.close();
  server.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
