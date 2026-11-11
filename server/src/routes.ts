import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { prisma, databaseConfigured } from './db.js';
import { clearAuthCookie, optionalAuth, requireAuth, requireOwner, setAuthCookie, signToken } from './auth.js';
import { env } from './env.js';
import { findChatGptMove, findStockfishMove, IntegrationUnavailable } from './ai.js';

export const router = Router();
router.use(optionalAuth);

const registerSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[\p{L}\p{N}_-]+$/u), email: z.string().trim().email().max(254), password: z.string().min(8).max(72) });
const loginSchema = z.object({ identity: z.string().trim().min(3).max(254), password: z.string().min(1).max(72) });
const pieceSchema = z.object({ name: z.string().trim().min(1).max(32), symbol: z.string().trim().min(1).max(4), color: z.enum(['white', 'black', 'both']).default('both'), description: z.string().max(300).default(''), rules: z.object({ moves: z.array(z.object({ dx: z.number().int().min(-8).max(8), dy: z.number().int().min(-8).max(8), range: z.number().int().min(1).max(8), jump: z.boolean().default(false), captureOnly: z.boolean().default(false) })).min(1).max(24) }) });

function publicUser(user: { id: string; username: string; email?: string | null; role: string; guest: boolean }) {
  return { id: user.id, username: user.username, email: user.email || undefined, role: user.role, guest: user.guest };
}
function issueSession(res: Parameters<typeof setAuthCookie>[0], user: ReturnType<typeof publicUser>) {
  setAuthCookie(res, signToken(user));
}
function dbRequired(res: import('express').Response) {
  if (!databaseConfigured) { res.status(503).json({ error: 'PostgreSQL ainda não foi configurado. Defina DATABASE_URL e execute as migrações.' }); return false; }
  return true;
}

router.get('/health', async (_req, res) => {
  let database = 'not-configured';
  if (databaseConfigured) {
    try { await prisma.$queryRaw`SELECT 1`; database = 'connected'; }
    catch { database = 'disconnected'; }
  }
  res.json({ status: 'ok', service: 'chess-realm-api', database, integrations: { openai: Boolean(env.openAiKey), stockfish: Boolean(env.stockfishPath) }, timestamp: new Date().toISOString() });
});

router.post('/auth/register', async (req, res) => {
  if (!dbRequired(res)) return;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Dados de cadastro inválidos.', details: parsed.error.flatten() });
  const { username, email, password } = parsed.data;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const normalizedEmail = email.toLowerCase();
    const role = env.ownerEmail && normalizedEmail === env.ownerEmail ? 'OWNER' : 'USER';
    const user = await prisma.user.create({ data: { username, email: normalizedEmail, passwordHash, role } });
    issueSession(res, publicUser(user));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('Unique constraint') ? 'Esse e-mail ou nome de usuário já está em uso.' : 'Não foi possível criar a conta.';
    res.status(409).json({ error: message });
  }
});

router.post('/auth/login', async (req, res) => {
  if (!dbRequired(res)) return;
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe usuário/e-mail e senha.' });
  const identity = parsed.data.identity;
  const user = await prisma.user.findFirst({ where: { OR: [{ email: identity.toLowerCase() }, { username: identity }] } });
  if (!user || !user.passwordHash || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Credenciais incorretas.' });
  if (user.suspended) return res.status(403).json({ error: 'Esta conta está suspensa.' });
  const role = env.ownerEmail && user.email?.toLowerCase() === env.ownerEmail ? 'OWNER' : user.role;
  if (role !== user.role) await prisma.user.update({ where: { id: user.id }, data: { role } });
  const safe = { ...user, role };
  issueSession(res, publicUser(safe));
  res.json({ user: publicUser(safe) });
});

router.post('/auth/guest', (req, res) => {
  const supplied = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const username = supplied.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20) || `Visitante${Math.floor(1000 + Math.random() * 9000)}`;
  if (username.length < 3) return res.status(400).json({ error: 'O apelido precisa ter pelo menos 3 caracteres.' });
  const user = { id: `guest_${randomUUID()}`, username, role: 'GUEST', guest: true };
  issueSession(res, user);
  res.status(201).json({ user });
});

router.get('/auth/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  if (req.user.guest) return res.json({ user: req.user });
  if (!databaseConfigured) return res.json({ user: req.user });
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || user.suspended) return res.status(401).json({ user: null });
  res.json({ user: publicUser(user) });
});

router.post('/auth/logout', (_req, res) => { clearAuthCookie(res); res.json({ ok: true }); });
router.patch('/profile/username', requireAuth, async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(3).max(20).regex(/^[\p{L}\p{N}_-]+$/u) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Apelido inválido.' });
  if (req.user!.guest) {
    const user = { ...req.user!, username: parsed.data.username };
    issueSession(res, user);
    return res.json({ user });
  }
  if (!dbRequired(res)) return;
  try {
    const updated = await prisma.user.update({ where: { id: req.user!.id }, data: { username: parsed.data.username } });
    const safe = publicUser(updated); issueSession(res, safe); res.json({ user: safe });
  } catch { res.status(409).json({ error: 'Esse apelido já está em uso.' }); }
});

router.get('/settings', requireAuth, async (req, res) => {
  if (req.user!.guest || !databaseConfigured) return res.json({ settings: {} });
  const saved = await prisma.userSettings.findUnique({ where: { userId: req.user!.id } });
  res.json({ settings: saved?.data || {} });
});
router.put('/settings', requireAuth, async (req, res) => {
  const data = z.record(z.any()).safeParse(req.body?.settings);
  if (!data.success) return res.status(400).json({ error: 'Configurações inválidas.' });
  if (req.user!.guest || !databaseConfigured) return res.json({ settings: data.data, persisted: false });
  const saved = await prisma.userSettings.upsert({ where: { userId: req.user!.id }, create: { userId: req.user!.id, data: data.data }, update: { data: data.data } });
  res.json({ settings: saved.data, persisted: true });
});

router.get('/pieces', requireAuth, async (req, res) => {
  if (req.user!.guest || !databaseConfigured) return res.json({ pieces: [] });
  const pieces = await prisma.customPiece.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
  res.json({ pieces });
});
router.post('/pieces', requireAuth, async (req, res) => {
  const parsed = pieceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Peça inválida.', details: parsed.error.flatten() });
  if (req.user!.guest || !databaseConfigured) return res.status(503).json({ error: 'Salvar peças permanentemente exige uma conta e PostgreSQL configurado.' });
  const piece = await prisma.customPiece.create({ data: { ...parsed.data, userId: req.user!.id } });
  res.status(201).json({ piece });
});
router.delete('/pieces/:id', requireAuth, async (req, res) => {
  if (req.user!.guest || !databaseConfigured) return res.status(503).json({ error: 'Esta ação exige uma conta e PostgreSQL.' });
  const removed = await prisma.customPiece.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.json({ deleted: removed.count === 1 });
});

router.get('/boards', requireAuth, async (req, res) => {
  if (req.user!.guest || !databaseConfigured) return res.json({ boards: [] });
  const boards = await prisma.customBoard.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
  res.json({ boards });
});
router.post('/boards', requireAuth, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(40), rows: z.number().int().min(4).max(12), columns: z.number().int().min(4).max(12), layout: z.array(z.any()).max(144) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Configuração de tabuleiro inválida.' });
  if (req.user!.guest || !databaseConfigured) return res.status(503).json({ error: 'Salvar tabuleiros exige uma conta e PostgreSQL.' });
  const board = await prisma.customBoard.create({ data: { ...parsed.data, userId: req.user!.id } });
  res.status(201).json({ board });
});

router.post('/ai/stockfish', requireAuth, async (req, res) => {
  const parsed = z.object({ fen: z.string().min(10).max(200), depth: z.number().int().min(1).max(20).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Posição FEN inválida.' });
  try { const move = await findStockfishMove(parsed.data.fen, parsed.data.depth); res.json({ move }); }
  catch (error) { const status = error instanceof IntegrationUnavailable ? 503 : 422; res.status(status).json({ error: error instanceof Error ? error.message : 'Erro na IA.' }); }
});
router.post('/ai/chatgpt', requireAuth, async (req, res) => {
  const parsed = z.object({ fen: z.string().min(10).max(200), pgn: z.string().max(20000).optional(), style: z.string().max(100).optional(), personality: z.string().max(120).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Dados da partida inválidos.' });
  try { const result = await findChatGptMove(parsed.data); res.json(result); }
  catch (error) { const status = error instanceof IntegrationUnavailable ? 503 : 422; res.status(status).json({ error: error instanceof Error ? error.message : 'Erro na integração ChatGPT.' }); }
});

router.get('/matches', requireAuth, async (req, res) => {
  if (req.user!.guest || !databaseConfigured) return res.json({ matches: [] });
  const matches = await prisma.match.findMany({ where: { OR: [{ whiteId: req.user!.id }, { blackId: req.user!.id }] }, orderBy: { startedAt: 'desc' }, take: 50 });
  res.json({ matches });
});

router.get('/admin/stats', requireOwner, async (_req, res) => {
  if (!dbRequired(res)) return;
  const [users, matches, activeMatches, recent] = await Promise.all([
    prisma.user.count(), prisma.match.count(), prisma.match.count({ where: { endedAt: null } }), prisma.match.findMany({ orderBy: { startedAt: 'desc' }, take: 8 }),
  ]);
  res.json({ users, matches, activeMatches, onlineUsers: 0, recent });
});
router.get('/admin/users', requireOwner, async (req, res) => {
  if (!dbRequired(res)) return;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '';
  const users = await prisma.user.findMany({ where: q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}, select: { id: true, username: true, email: true, role: true, guest: true, suspended: true, createdAt: true }, take: 100, orderBy: { createdAt: 'desc' } });
  res.json({ users });
});
router.patch('/admin/users/:id', requireOwner, async (req, res) => {
  if (!dbRequired(res)) return;
  const parsed = z.object({ username: z.string().trim().min(3).max(20).optional(), suspended: z.boolean().optional(), role: z.enum(['USER', 'ADMIN']).optional() }).refine((v) => Object.keys(v).length > 0).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Alteração inválida.' });
  if (req.params.id === req.user!.id && parsed.data.suspended) return res.status(400).json({ error: 'O proprietário não pode suspender a própria conta.' });
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target || target.role === 'OWNER') return res.status(404).json({ error: 'Usuário não encontrado ou protegido.' });
  const user = await prisma.user.update({ where: { id: target.id }, data: parsed.data });
  res.json({ user: publicUser(user), suspended: user.suspended });
});
router.get('/admin/announcements', requireOwner, async (_req, res) => {
  if (!dbRequired(res)) return;
  res.json({ announcements: await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } }) });
});
router.post('/admin/announcements', requireOwner, async (req, res) => {
  if (!dbRequired(res)) return;
  const parsed = z.object({ title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(1000), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Anúncio inválido.' });
  res.status(201).json({ announcement: await prisma.announcement.create({ data: parsed.data }) });
});

// Server-side validation helper used by tests and integrations.
export function validateMove(fen: string, from: string, to: string, promotion?: string) {
  const chess = new Chess(fen);
  return chess.move({ from, to, promotion: (promotion || 'q') as 'q' | 'r' | 'b' | 'n' });
}
