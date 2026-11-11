import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';
import { env } from './env.js';

export class IntegrationUnavailable extends Error {}

export async function findStockfishMove(fen: string, depth = 12): Promise<string> {
  if (!env.stockfishPath) throw new IntegrationUnavailable('Stockfish não configurado. Defina STOCKFISH_PATH com o caminho do executável no servidor.');
  const chess = new Chess(fen);
  if (chess.isGameOver()) throw new Error('A partida já terminou.');

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(env.stockfishPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const finish = (error?: Error, move?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(move!);
    };
    const timer = setTimeout(() => finish(new Error('Stockfish não respondeu dentro do limite de tempo.')), 15000);
    child.on('error', () => finish(new IntegrationUnavailable('Não foi possível iniciar o executável Stockfish configurado.')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      const found = output.match(/(?:^|\n)bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (found) {
        const move = found[1];
        try {
          const legal = chess.moves({ verbose: true }).find((candidate) => candidate.from + candidate.to + (candidate.promotion || '') === move);
          if (!legal) return finish(new Error('Stockfish retornou uma jogada inválida.'));
          finish(undefined, move);
        } catch (error) { finish(error as Error); }
      }
    });
    child.stderr.on('data', () => undefined);
    child.stdin.write('uci\n');
    child.stdin.write('isready\n');
    child.stdin.write(`position fen ${fen}\n`);
    child.stdin.write(`go depth ${Math.max(1, Math.min(20, Math.floor(depth)))}\n`);
  });
}

export async function findChatGptMove(input: { fen: string; pgn?: string; style?: string; personality?: string }) {
  if (!env.openAiKey) throw new IntegrationUnavailable('Integração ChatGPT indisponível: configure OPENAI_API_KEY no servidor.');
  const chess = new Chess(input.fen);
  const legalMoves = chess.moves({ verbose: true }).map((move) => ({
    uci: move.from + move.to + (move.promotion || ''), san: move.san, from: move.from, to: move.to,
  }));
  if (!legalMoves.length) throw new Error('Não existem jogadas legais nesta posição.');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openAiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.openAiModel,
      max_output_tokens: 120,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: `Você é um adversário de xadrez. Responda apenas um objeto JSON com a propriedade \"move\", contendo uma jogada UCI que esteja na lista legal. Estilo: ${input.style || 'equilibrado'}. Personalidade: ${input.personality || 'rival respeitoso'}. Não invente jogadas.` }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ fen: input.fen, pgn: input.pgn || '', legalMoves }) }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'chess_move',
          strict: true,
          schema: {
            type: 'object',
            properties: { move: { type: 'string' } },
            required: ['move'],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI retornou HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const content = data.output?.flatMap((item) => item.content || []).find((part) => part.type === 'output_text')?.text || '{}';
  let parsed: { move?: string };
  try { parsed = JSON.parse(content) as { move?: string }; }
  catch { throw new Error('A resposta da IA não veio em JSON válido.'); }
  const move = legalMoves.find((candidate) => candidate.uci === parsed.move);
  if (!move) throw new Error('A IA sugeriu uma jogada que não está entre as jogadas legais.');
  return { move: move.uci, san: move.san, legalMoves };
}
