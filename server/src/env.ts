import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load a local server/.env first, then the repository-root .env used by this starter.
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../.env') });

const required = ['JWT_SECRET'] as const;
for (const key of required) {
  if (!process.env[key] || process.env[key]!.length < 32) {
    throw new Error(`${key} precisa existir e ter pelo menos 32 caracteres. Copie .env.example e configure o ambiente.`);
  }
}

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET!,
  ownerEmail: (process.env.OWNER_EMAIL || '').trim().toLowerCase(),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  openAiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-6-luna',
  stockfishPath: process.env.STOCKFISH_PATH || '',
  databaseUrl: process.env.DATABASE_URL || '',
};
