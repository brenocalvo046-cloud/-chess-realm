import './env.js';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export const databaseConfigured = Boolean(process.env.DATABASE_URL);
