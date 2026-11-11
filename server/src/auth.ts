import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { parse as parseCookie, serialize } from 'cookie';
import { env } from './env.js';
import { prisma, databaseConfigured } from './db.js';

export type AuthUser = { id: string; username: string; email?: string; role: string; guest: boolean };
declare global { namespace Express { interface Request { user?: AuthUser } } }

export function signToken(user: AuthUser) {
  return jwt.sign(user, env.jwtSecret, { expiresIn: user.guest ? '7d' : '14d', issuer: 'chess-realm' });
}
export function setAuthCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', serialize('cr_session', token, {
    httpOnly: true, secure: env.nodeEnv === 'production', sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/', maxAge: 60 * 60 * 24 * 14,
  }));
}
export function clearAuthCookie(res: Response) {
  res.setHeader('Set-Cookie', serialize('cr_session', '', { httpOnly: true, secure: env.nodeEnv === 'production', sameSite: env.nodeEnv === 'production' ? 'none' : 'lax', path: '/', maxAge: 0 }));
}
export function readTokenFromRequest(req: Request) {
  const raw = req.headers.cookie || '';
  const cookies = parseCookie(raw);
  return cookies.cr_session;
}
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readTokenFromRequest(req);
    if (token) req.user = jwt.verify(token, env.jwtSecret, { issuer: 'chess-realm' }) as AuthUser;
  } catch { /* Invalid sessions are treated as signed out. */ }
  next();
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  if (!req.user.guest && databaseConfigured) {
    try {
      const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!dbUser || dbUser.suspended) return res.status(401).json({ error: 'Sessão inválida ou conta suspensa.' });
      req.user = { id: dbUser.id, username: dbUser.username, email: dbUser.email || undefined, role: dbUser.role, guest: dbUser.guest };
    } catch { return res.status(503).json({ error: 'Não foi possível validar a conta no banco de dados.' }); }
  }
  next();
}
export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.guest || !env.ownerEmail || req.user.email?.toLowerCase() !== env.ownerEmail) {
    return res.status(403).json({ error: 'Acesso restrito ao proprietário.' });
  }
  if (databaseConfigured) {
    try {
      const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!dbUser || dbUser.suspended || dbUser.role !== 'OWNER' || dbUser.email?.toLowerCase() !== env.ownerEmail) {
        return res.status(403).json({ error: 'Acesso restrito ao proprietário.' });
      }
    } catch { return res.status(503).json({ error: 'Não foi possível validar as permissões administrativas.' }); }
  }
  next();
}
export function socketAuth(cookieHeader?: string): AuthUser | null {
  try {
    const token = parseCookie(cookieHeader || '').cr_session;
    if (!token) return null;
    return jwt.verify(token, env.jwtSecret, { issuer: 'chess-realm' }) as AuthUser;
  } catch { return null; }
}
