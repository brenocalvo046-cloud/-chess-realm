import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square, type PieceSymbol, type Color } from 'chess.js';
import { io, type Socket } from 'socket.io-client';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, AudioLines, Bell, BookOpen, Bot, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Crown, Gamepad2, Globe2, History,
  LogIn, LogOut, Menu, MessageSquare, Moon, Music2, Pencil, Play, Plus, RotateCcw,
  Save, Settings, Shield, Sparkles, Swords, Trash2, Trophy, User, Users, Volume2, VolumeX,
  WandSparkles, X, Zap,
} from 'lucide-react';
import { api, socketUrl } from './api';

type UserInfo = { id: string; username: string; email?: string; role: string; guest: boolean };
type Mode = 'home' | 'local' | 'online' | 'stockfish' | 'chatgpt' | 'control' | 'sandbox' | 'pieces' | 'settings' | 'profile' | 'history' | 'admin';
type OnlineState = { gameId: string; fen: string; pgn: string; turn: Color; white: { username: string; connected: boolean }; black: { username: string; connected: boolean }; check: boolean; checkmate: boolean; draw: boolean; gameOver: boolean; drawOffer: string | null; result: string | null };
type CustomPiece = { id: string; name: string; symbol: string; color: string; description: string; rules: { moves: { dx: number; dy: number; range: number; jump: boolean; captureOnly: boolean }[] } };

type SettingsState = {
  theme: string; boardLight: string; boardDark: string; masterVolume: number; effectsVolume: number;
  musicVolume: number; muted: boolean; sounds: Record<string, boolean>; musicUrl: string; pieceStyle: string;
  highlightMoves: boolean; coordinates: boolean; animations: boolean;
};
const DEFAULT_SETTINGS: SettingsState = {
  theme: 'midnight', boardLight: '#e8d8bd', boardDark: '#8b6549', masterVolume: 70, effectsVolume: 65,
  musicVolume: 35, muted: false, sounds: { move: true, capture: true, check: true, click: true }, musicUrl: '',
  pieceStyle: 'classic', highlightMoves: true, coordinates: true, animations: true,
};
const PIECES: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};
const GLYPHS: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};
const NAV: { id: Mode; label: string; icon: any; group: string }[] = [
  { id: 'home', label: 'Início', icon: Gamepad2, group: 'JOGAR' },
  { id: 'online', label: 'Online 1v1', icon: Globe2, group: 'JOGAR' },
  { id: 'stockfish', label: 'Contra Stockfish', icon: Bot, group: 'JOGAR' },
  { id: 'chatgpt', label: 'Contra ChatGPT', icon: Sparkles, group: 'JOGAR' },
  { id: 'control', label: 'Controlar a IA', icon: WandSparkles, group: 'JOGAR' },
  { id: 'local', label: 'Local 1v1', icon: Users, group: 'JOGAR' },
  { id: 'sandbox', label: 'Sandbox', icon: Pencil, group: 'PERSONALIZAR' },
  { id: 'pieces', label: 'Peças customizadas', icon: Crown, group: 'PERSONALIZAR' },
  { id: 'history', label: 'Histórico', icon: History, group: 'CONTA' },
  { id: 'profile', label: 'Perfil', icon: User, group: 'CONTA' },
  { id: 'settings', label: 'Configurações', icon: Settings, group: 'CONTA' },
];

function formatClock(seconds: number) {
  const mins = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0');
  const secs = (Math.max(0, seconds) % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}
function getMoveSquares(uci: string) { return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] || 'q') as PieceSymbol }; }
function safeParseSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cr-settings') || '{}') }; }
  catch { return DEFAULT_SETTINGS; }
}

export default function App() {
  const gameRef = useRef(new Chess());
  const socketRef = useRef<Socket | null>(null);
  const onlineGameIdRef = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authOpen, setAuthOpen] = useState(true);
  const [authTab, setAuthTab] = useState<'guest' | 'login' | 'register'>('guest');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('home');
  const [mobileNav, setMobileNav] = useState(false);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [pgn, setPgn] = useState('');
  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [settings, setSettings] = useState<SettingsState>(safeParseSettings);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiColor, setAiColor] = useState<Color>('b');
  const [suggestedMove, setSuggestedMove] = useState<{ uci: string; san?: string } | null>(null);
  const [aiPersonality, setAiPersonality] = useState('rival respeitoso');
  const [aiStyle, setAiStyle] = useState('equilibrado');
  const [selectedAiMove, setSelectedAiMove] = useState('');
  const [timeControl, setTimeControl] = useState(10);
  const [whiteClock, setWhiteClock] = useState(600);
  const [blackClock, setBlackClock] = useState(600);
  const [clockRunning, setClockRunning] = useState(false);
  const [onlineState, setOnlineState] = useState<OnlineState | null>(null);
  const [onlineColor, setOnlineColor] = useState<Color>('w');
  const [onlineStatus, setOnlineStatus] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [createdRoom, setCreatedRoom] = useState('');
  const [sandboxGrid, setSandboxGrid] = useState<(string | null)[][]>(() => Array.from({ length: 8 }, () => Array(8).fill(null)));
  const [sandboxPalette, setSandboxPalette] = useState('wk');
  const [pieceName, setPieceName] = useState('Cavaleiro');
  const [pieceSymbol, setPieceSymbol] = useState('✦');
  const [pieceDescription, setPieceDescription] = useState('');
  const [piecePattern, setPiecePattern] = useState('1,2;2,1');
  const [customPieces, setCustomPieces] = useState<CustomPiece[]>([]);
  const [pieceColor, setPieceColor] = useState('both');
  const [profileName, setProfileName] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [audioPlaying, setAudioPlaying] = useState(false);

  const refreshGame = useCallback(() => {
    setFen(gameRef.current.fen());
    setPgn(gameRef.current.pgn());
    const history = gameRef.current.history({ verbose: true });
    const last = history[history.length - 1];
    setLastMove(last ? [last.from, last.to] : null);
    setSelected(null); setTargets([]);
  }, []);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 4200);
  }, []);

  useEffect(() => {
    api('/auth/me').then((data: any) => { if (data.user) { setUser(data.user); setAuthOpen(false); setProfileName(data.user.username); } else setAuthOpen(true); }).catch(() => setAuthOpen(true));
    api('/health').then(setHealth).catch(() => setHealth({ status: 'offline', database: 'unknown', integrations: {} }));
  }, []);
  useEffect(() => { localStorage.setItem('cr-settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    if (!user) return;
    api('/settings').then((data: any) => { if (data.settings && Object.keys(data.settings).length) setSettings((old) => ({ ...old, ...data.settings })); }).catch(() => undefined);
    api('/pieces').then((data: any) => setCustomPieces(data.pieces || [])).catch(() => undefined);
  }, [user]);
  useEffect(() => {
    if (!clockRunning || mode !== 'local' && mode !== 'stockfish' && mode !== 'chatgpt' && mode !== 'control') return;
    const timer = window.setInterval(() => {
      if (gameRef.current.turn() === 'w') setWhiteClock((n) => Math.max(0, n - 1));
      else setBlackClock((n) => Math.max(0, n - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [clockRunning, mode, fen]);

  const playSound = useCallback((kind: string) => {
    if (settings.muted || settings.masterVolume <= 0 || settings.effectsVolume <= 0 || settings.sounds[kind] === false) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioRef.current) audioRef.current = new AudioContextCtor();
      const context = audioRef.current;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = kind === 'capture' ? 210 : kind === 'check' ? 520 : 340;
      gain.gain.value = Math.max(0.0001, (settings.masterVolume / 100) * (settings.effectsVolume / 100) * 0.045);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.075);
    } catch { /* Áudio opcional; o jogo continua mesmo sem suporte. */ }
  }, [settings]);

  const signIn = async (kind: 'guest' | 'login' | 'register') => {
    setBusy(true);
    try {
      let data: any;
      if (kind === 'guest') data = await api('/auth/guest', { method: 'POST', body: JSON.stringify({ username }) });
      else if (kind === 'login') data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identity: email, password }) });
      else data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
      setUser(data.user); setProfileName(data.user.username); setAuthOpen(false); setPassword('');
      showNotice(`Bem-vindo ao Chess Realm, ${data.user.username}.`);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* local sign-out */ }
    socketRef.current?.disconnect(); socketRef.current = null;
    setUser(null); setAuthOpen(true); setOnlineState(null); onlineGameIdRef.current = null; setMode('home');
  };

  const startGame = (nextMode: Mode) => {
    gameRef.current = new Chess(); refreshGame();
    setMode(nextMode); setClockRunning(true); setWhiteClock(timeControl * 60); setBlackClock(timeControl * 60);
    setSuggestedMove(null); setOnlineState(null); setOnlineStatus(''); onlineGameIdRef.current = null;
    if (nextMode === 'stockfish' || nextMode === 'chatgpt' || nextMode === 'control') {
      setAiColor('b');
      if (nextMode === 'stockfish' && !health?.integrations?.stockfish) showNotice('Stockfish não configurado no servidor. Configure STOCKFISH_PATH para ativar a IA.');
      if (nextMode === 'chatgpt' && !health?.integrations?.openai) showNotice('ChatGPT indisponível até configurar OPENAI_API_KEY no servidor.');
    }
  };

  const requestAiMove = async (asSuggestion = false, explicitUci?: string) => {
    if (mode === 'control' && explicitUci) {
      const move = getMoveSquares(explicitUci);
      try { gameRef.current.move({ from: move.from, to: move.to, promotion: move.promotion }); refreshGame(); playSound('move'); setSuggestedMove(null); }
      catch { showNotice('Essa jogada não é válida nesta posição.'); }
      return;
    }
    if (mode === 'control' && !explicitUci) {
      try {
        const data: any = await api('/ai/stockfish', { method: 'POST', body: JSON.stringify({ fen, depth: 12 }) });
        setSuggestedMove({ uci: data.move, san: data.san });
      } catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível obter uma sugestão.'); }
      return;
    }
    setAiThinking(true);
    try {
      const endpoint = mode === 'chatgpt' ? '/ai/chatgpt' : '/ai/stockfish';
      const data: any = await api(endpoint, { method: 'POST', body: JSON.stringify({ fen, pgn, depth: 12, style: aiStyle, personality: aiPersonality }) });
      const move = getMoveSquares(data.move);
      gameRef.current.move({ from: move.from, to: move.to, promotion: move.promotion });
      refreshGame(); playSound('move');
      if (gameRef.current.isGameOver()) setClockRunning(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Erro ao consultar o adversário.'); }
    finally { setAiThinking(false); }
  };

  const onSquareClick = (square: Square) => {
    if (mode === 'sandbox') {
      const [file, rank] = [square.charCodeAt(0) - 97, 8 - Number(square[1])];
      setSandboxGrid((old) => old.map((row, r) => row.map((cell, c) => r === rank && c === file ? (sandboxPalette === 'erase' ? null : sandboxPalette) : cell)));
      return;
    }
    const isOnline = mode === 'online' && Boolean(onlineState);
    if (isOnline) {
      if (onlineState!.gameOver || gameRef.current.turn() !== onlineColor) return;
    } else if ((mode === 'stockfish' || mode === 'chatgpt' || mode === 'control') && gameRef.current.turn() === aiColor) return;

    if (selected) {
      const candidate = gameRef.current.moves({ square: selected, verbose: true }).find((move) => move.to === square);
      if (candidate) {
        if (isOnline) socketRef.current?.emit('game:move', { gameId: onlineState!.gameId, from: selected, to: square, promotion: 'q' });
        else {
          try {
            const move = gameRef.current.move({ from: selected, to: square, promotion: 'q' });
            playSound(move.captured ? 'capture' : 'move'); refreshGame();
            if (gameRef.current.isCheck()) playSound('check');
            if (gameRef.current.isGameOver()) { setClockRunning(false); return; }
            if (mode === 'stockfish' || mode === 'chatgpt') window.setTimeout(() => void requestAiMove(), 150);
            if (mode === 'control') setSuggestedMove(null);
          } catch { showNotice('Jogada inválida.'); }
        }
        return;
      }
    }
    const piece = gameRef.current.get(square);
    if (piece && piece.color === gameRef.current.turn()) {
      setSelected(square);
      setTargets(gameRef.current.moves({ square, verbose: true }).map((move) => move.to));
    } else { setSelected(null); setTargets([]); }
  };

  const connectSocket = () => {
    if (!user) { setAuthOpen(true); return null; }
    if (socketRef.current?.connected) return socketRef.current;
    const socket = io(socketUrl(), { withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      setOnlineStatus('Conectado ao servidor multiplayer.');
      if (onlineGameIdRef.current) socket.emit('game:reconnect', { gameId: onlineGameIdRef.current });
    });
    socket.on('connect_error', (error) => showNotice(error.message || 'Falha ao conectar ao multiplayer.'));
    socket.on('matchmaking:waiting', (data) => { setOnlineStatus(data.message); setMode('online'); });
    socket.on('matchmaking:cancelled', () => setOnlineStatus('Busca cancelada.'));
    socket.on('room:created', (data) => { setCreatedRoom(data.code); setRoomCode(data.code); setOnlineStatus('Sala criada. Compartilhe o código com seu amigo.'); });
    socket.on('room:joined', () => setOnlineStatus('Seu amigo entrou na sala.'));
    socket.on('game:joined', (data) => {
      onlineGameIdRef.current = data.gameId;
      setOnlineColor(data.color); setOnlineState(data); gameRef.current.load(data.fen); refreshGame(); setMode('online'); setOnlineStatus('Partida online iniciada.'); setClockRunning(false);
    });
    socket.on('game:state', (data) => {
      onlineGameIdRef.current = data.gameId;
      setOnlineState(data);
      try { gameRef.current.load(data.fen); refreshGame(); } catch { /* Ignore out-of-order transient state. */ }
      if (data.gameOver) setClockRunning(false);
    });
    socket.on('game:error', (data) => showNotice(data.message || 'Erro na partida online.'));
    socket.on('game:ended', (data) => { setOnlineStatus(data.result === '1/2-1/2' ? 'Partida terminou empatada.' : `Partida encerrada: ${data.result}`); setClockRunning(false); });
    return socket;
  };
  const joinMatchmaking = () => { const socket = connectSocket(); if (!socket) return; setOnlineStatus('Conectando ao servidor…'); socket.emit('matchmaking:join'); setMode('online'); };
  const createPrivateRoom = () => { const socket = connectSocket(); if (!socket) return; socket.emit('room:create'); setMode('online'); };
  const joinPrivateRoom = () => { const socket = connectSocket(); if (!socket) return; socket.emit('room:join', { code: roomCode }); setMode('online'); };
  const cancelQueue = () => { socketRef.current?.emit('matchmaking:cancel'); setOnlineStatus('Busca cancelada.'); };

  const allMoves = useMemo(() => gameRef.current.moves({ verbose: true }), [fen]);
  const boardRows = gameRef.current.board();
  const gameStatus = gameRef.current.isCheckmate() ? `Xeque-mate — ${gameRef.current.turn() === 'w' ? 'pretas' : 'brancas'} venceram` : gameRef.current.isStalemate() ? 'Empate por afogamento' : gameRef.current.isDraw() ? 'Partida empatada' : gameRef.current.isCheck() ? 'Xeque!' : gameRef.current.turn() === 'w' ? 'Vez das brancas' : 'Vez das pretas';
  const isGame = ['local', 'stockfish', 'chatgpt', 'control', 'online'].includes(mode);
  const canAdmin = user?.role === 'OWNER';

  const navigate = (next: Mode) => {
    setMobileNav(false);
    if (next === 'online') { setMode('online'); if (!onlineGameIdRef.current) setOnlineState(null); setOnlineStatus(''); return; }
    if (next === 'local' || next === 'stockfish' || next === 'chatgpt' || next === 'control') { startGame(next); return; }
    setMode(next);
    if (next === 'history') api('/matches').then((data: any) => setMatches(data.matches || [])).catch((error) => showNotice(error.message));
    if (next === 'admin') loadAdmin();
  };
  const loadAdmin = async () => {
    try {
      const [stats, usersData] = await Promise.all([api('/admin/stats'), api('/admin/users')]);
      setAdminStats(stats); setAdminUsers(usersData.users || []);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Acesso administrativo negado.'); }
  };
  const saveSettings = async () => {
    try { const result: any = await api('/settings', { method: 'PUT', body: JSON.stringify({ settings }) }); showNotice(result.persisted ? 'Configurações salvas na conta.' : 'Salvas neste navegador. Para sincronizar, configure uma conta e o PostgreSQL.'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
  };
  const savePiece = async () => {
    const moves = piecePattern.split(';').map((pair) => pair.trim().split(',').map(Number)).filter((pair) => pair.length === 2 && pair.every((value) => Number.isInteger(value) && value !== 0 && Math.abs(value) <= 8)).map(([dx, dy]) => ({ dx, dy, range: 1, jump: true, captureOnly: false }));
    if (!pieceName.trim() || !pieceSymbol.trim() || !moves.length) { showNotice('Preencha nome, símbolo e ao menos um movimento (ex.: 1,2;2,1).'); return; }
    try {
      const data: any = await api('/pieces', { method: 'POST', body: JSON.stringify({ name: pieceName, symbol: pieceSymbol, color: pieceColor, description: pieceDescription, rules: { moves } }) });
      setCustomPieces((old) => [data.piece, ...old]); showNotice('Peça salva na biblioteca da conta.');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível salvar a peça.'); }
  };
  const saveSandbox = async () => {
    try {
      const data = await api('/boards', { method: 'POST', body: JSON.stringify({ name: `Tabuleiro ${new Date().toLocaleDateString('pt-BR')}`, rows: 8, columns: 8, layout: sandboxGrid.flat() }) });
      showNotice(data ? 'Tabuleiro salvo na conta.' : 'Não foi possível salvar.');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível salvar o tabuleiro.'); }
  };
  const updateProfile = async () => {
    try { const data: any = await api('/profile/username', { method: 'PATCH', body: JSON.stringify({ username: profileName }) }); setUser(data.user); showNotice('Apelido atualizado.'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível atualizar o apelido.'); }
  };
  const toggleUserSuspend = async (target: any) => {
    try { await api(`/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify({ suspended: !target.suspended }) }); setAdminUsers((old) => old.map((item) => item.id === target.id ? { ...item, suspended: !target.suspended } : item)); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Não foi possível alterar o usuário.'); }
  };
  const createAnnouncement = async () => {
    try { await api('/admin/announcements', { method: 'POST', body: JSON.stringify({ title: announcementTitle, body: announcementBody }) }); setAnnouncementTitle(''); setAnnouncementBody(''); showNotice('Anúncio publicado.'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Falha ao publicar anúncio.'); }
  };

  const renderBoard = (isSandbox = false) => (
    <div className={`board-shell ${settings.animations ? 'animated-board' : ''}`}>
      <div className="chessboard" role="grid" aria-label="Tabuleiro de xadrez">
        {(isSandbox ? sandboxGrid : boardRows).map((row: any[], rowIndex: number) => row.map((piece: any, colIndex: number) => {
          const square = `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}` as Square;
          const key = isSandbox ? piece : piece ? `${piece.color}${piece.type}` : '';
          const glyph = isSandbox ? (piece ? GLYPHS[piece] || pieceSymbol : '') : piece ? PIECES[`${piece.color}${piece.type}`] : '';
          const light = (rowIndex + colIndex) % 2 === 0;
          const isTarget = !isSandbox && targets.includes(square);
          const isSelected = !isSandbox && selected === square;
          const isLast = !isSandbox && settings.highlightMoves && Boolean(lastMove?.includes(square));
          const color = isSandbox ? (String(piece || '').startsWith('w') ? 'white-piece' : 'black-piece') : piece?.color === 'w' ? 'white-piece' : 'black-piece';
          return <button key={square} className={`square ${light ? 'light-square' : 'dark-square'} ${isSelected ? 'selected-square' : ''} ${isLast ? 'last-square' : ''}`} style={{ '--light': settings.boardLight, '--dark': settings.boardDark } as React.CSSProperties} onClick={() => onSquareClick(square)} aria-label={square}>
            {settings.coordinates && colIndex === 0 && <span className="rank-label">{8 - rowIndex}</span>}
            {settings.coordinates && rowIndex === 7 && <span className="file-label">{String.fromCharCode(97 + colIndex)}</span>}
            {glyph && <span className={`piece-glyph ${color}`}>{glyph}</span>}
            {isTarget && <span className={piece ? 'capture-indicator' : 'move-indicator'} />}
          </button>;
        }))}
      </div>
    </div>
  );

  const renderGame = () => {
    const activeOnline = mode === 'online' && Boolean(onlineState);
    const whiteName = activeOnline ? onlineState!.white.username : (user?.username || 'Jogador 1');
    const blackName = activeOnline ? onlineState!.black.username : mode === 'local' ? 'Jogador 2' : mode === 'chatgpt' ? 'ChatGPT' : mode === 'control' ? 'IA sob seu controle' : 'Stockfish';
    return <div className="game-layout">
      <div className="game-main">
        <div className="game-topline">
          <button className="back-link" onClick={() => { setMode('home'); setClockRunning(false); }}><ArrowLeft size={16} /> Voltar</button>
          <span className="live-label"><span className="live-dot" /> {activeOnline ? 'MULTIPLAYER' : mode === 'local' ? 'LOCAL 1V1' : mode.toUpperCase()}</span>
          {activeOnline && <span className="room-tag">{onlineState!.gameId.slice(0, 7)}</span>}
        </div>
        <div className="player-strip opponent-strip">
          <div className="avatar opponent-avatar">{(blackName[0] || 'B').toUpperCase()}</div>
          <div><strong>{blackName}</strong><span>{activeOnline ? onlineState!.black.connected ? 'Conectado' : 'Reconectando…' : 'Adversário'}</span></div>
          <div className={`clock ${activeOnline ? '' : gameRef.current.turn() === 'b' ? 'clock-active' : ''}`}>{formatClock(blackClock)}</div>
        </div>
        {renderBoard()}
        <div className="player-strip own-strip">
          <div className="avatar own-avatar">{(whiteName[0] || 'W').toUpperCase()}</div>
          <div><strong>{whiteName} {activeOnline && onlineColor === 'b' ? '(pretas)' : '(brancas)'}</strong><span>{activeOnline ? onlineState!.white.connected ? 'Conectado' : 'Reconectando…' : 'Você'}</span></div>
          <div className={`clock ${!activeOnline && gameRef.current.turn() === 'w' ? 'clock-active' : ''}`}>{formatClock(whiteClock)}</div>
        </div>
        <div className="game-status"><span className={gameRef.current.isCheck() ? 'status-check' : ''}>{activeOnline ? onlineState!.gameOver ? 'Partida encerrada' : onlineState!.check ? 'Xeque!' : onlineState!.turn === 'w' ? 'Vez das brancas' : 'Vez das pretas' : gameStatus}</span><span>{gameRef.current.history().length} jogadas</span></div>
      </div>
      <aside className="game-panel">
        <div className="panel-heading"><div><span className="eyebrow">CHESS REALM</span><h2>{mode === 'local' ? 'Partida local' : mode === 'online' ? 'Partida online' : mode === 'chatgpt' ? 'Desafio ChatGPT' : mode === 'control' ? 'Controle da IA' : 'Desafio Stockfish'}</h2></div><Swords size={20} /></div>
        {mode === 'control' ? <div className="control-box">
          <p className="muted-copy">Escolha uma jogada legal para a IA ou peça uma sugestão para aprovar.</p>
          <button className="primary-button full-button" onClick={() => void requestAiMove(true)} disabled={gameRef.current.turn() !== aiColor}><Sparkles size={16} /> Sugerir jogada</button>
          {suggestedMove && <div className="suggestion-card"><span>Jogada sugerida</span><strong>{suggestedMove.san || suggestedMove.uci}</strong><div className="inline-actions"><button className="primary-button" onClick={() => void requestAiMove(false, suggestedMove.uci)}><Check size={14} /> Aprovar</button><button className="secondary-button" onClick={() => setSuggestedMove(null)}><X size={14} /> Rejeitar</button></div></div>}
          <label className="field-label">Escolher jogada manualmente</label>
          <select className="field" value={selectedAiMove} onChange={(event) => setSelectedAiMove(event.target.value)}><option value="">Selecione uma jogada…</option>{allMoves.map((move: any) => <option key={move.from + move.to + move.san} value={move.from + move.to + (move.promotion || '')}>{move.san} ({move.from} → {move.to})</option>)}</select>
          <button className="secondary-button full-button" disabled={!selectedAiMove || gameRef.current.turn() !== aiColor} onClick={() => { void requestAiMove(false, selectedAiMove); setSelectedAiMove(''); }}>Aplicar jogada escolhida</button>
        </div> : <>
          {(mode === 'chatgpt' || mode === 'stockfish') && <div className="ai-settings-inline"><label className="field-label">Estilo de jogo</label><select className="field" value={aiStyle} onChange={(e) => setAiStyle(e.target.value)}><option>equilibrado</option><option>agressivo</option><option>defensivo</option><option>estratégico</option></select>{mode === 'chatgpt' && <><label className="field-label">Personalidade</label><input className="field" value={aiPersonality} onChange={(e) => setAiPersonality(e.target.value)} /></>}</div>}
          {mode === 'local' && <p className="muted-copy">Dois jogadores no mesmo dispositivo. Alternem as jogadas no mesmo tabuleiro.</p>}
          {mode === 'online' && <div className="online-info"><span className="connection-dot" /> {onlineStatus || 'Conexão ativa'}</div>}
        </>}
        <div className="move-list"><div className="subheading"><span>Movimentos</span><span>{Math.ceil(gameRef.current.history().length / 2)}</span></div>{gameRef.current.history().length ? <div className="moves-grid">{Array.from({ length: Math.ceil(gameRef.current.history().length / 2) }, (_, i) => <div key={i} className="move-row"><span>{i + 1}.</span><b>{gameRef.current.history()[i * 2]}</b><b>{gameRef.current.history()[i * 2 + 1] || '—'}</b></div>)}</div> : <div className="empty-mini">As jogadas aparecerão aqui.</div>}</div>
        <div className="game-actions">
          <button className="secondary-button" onClick={() => { if (activeOnline) socketRef.current?.emit('game:draw:offer', { gameId: onlineState!.gameId }); else { const undone = gameRef.current.undo(); if (undone) refreshGame(); } }}><RotateCcw size={15} /> {activeOnline ? 'Oferecer empate' : 'Desfazer'}</button>
          <button className="danger-button" onClick={() => { if (activeOnline) socketRef.current?.emit('game:resign', { gameId: onlineState!.gameId }); else { setClockRunning(false); showNotice('Partida encerrada.'); } }}>Desistir</button>
          <button className="primary-button full-button" onClick={() => startGame(mode === 'online' ? 'local' : mode)}><RotateCcw size={15} /> Nova partida</button>
        </div>
        {activeOnline && onlineState!.drawOffer && onlineState!.drawOffer !== user?.id && <div className="draw-offer"><span>Seu adversário ofereceu empate.</span><div className="inline-actions"><button className="primary-button" onClick={() => socketRef.current?.emit('game:draw:respond', { gameId: onlineState!.gameId, accept: true })}>Aceitar</button><button className="secondary-button" onClick={() => socketRef.current?.emit('game:draw:respond', { gameId: onlineState!.gameId, accept: false })}>Recusar</button></div></div>}
      </aside>
    </div>;
  };

  const renderHome = () => <div className="page-content">
    <div className="hero-card"><div className="hero-copy"><span className="eyebrow">BEM-VINDO AO TABULEIRO</span><h1>O próximo movimento<br /><em>é seu.</em></h1><p>Jogue com amigos, enfrente inteligências artificiais ou invente suas próprias regras.</p><div className="hero-actions"><button className="primary-button" onClick={() => navigate('online')}><Play size={16} fill="currentColor" /> Jogar online</button><button className="secondary-button" onClick={() => navigate('stockfish')}>Desafiar IA <ArrowRight size={16} /></button></div></div><div className="hero-board-art"><div className="mini-board">{Array.from({ length: 64 }, (_, i) => <span key={i} className={(Math.floor(i / 8) + i % 8) % 2 ? 'mini-dark' : 'mini-light'}>{({ 0: '♜', 3: '♛', 4: '♚', 7: '♜', 8: '♟', 11: '♟', 13: '♟', 16: '♞', 20: '♟', 27: '♙', 35: '♘', 42: '♙', 49: '♙', 56: '♖', 59: '♕', 60: '♔', 63: '♖' } as any)[i] || ''}</span>)}</div></div><div className="hero-glow" /></div>
    <div className="section-title-row"><div><span className="eyebrow">MODOS DE JOGO</span><h2>Escolha seu desafio</h2></div><span className="subtle-count">05 MODOS</span></div>
    <div className="mode-grid">
      <ModeCard icon={<Globe2 />} title="Online 1v1" description="Encontre um adversário ou crie uma sala privada." tag="MULTIPLAYER" onClick={() => navigate('online')} />
      <ModeCard icon={<Bot />} title="Contra Stockfish" description="Enfrente um dos motores de xadrez mais fortes." tag="ENGINE" onClick={() => navigate('stockfish')} />
      <ModeCard icon={<Sparkles />} title="Contra ChatGPT" description="Jogue contra uma IA com personalidade configurável." tag="OPENAI" onClick={() => navigate('chatgpt')} />
      <ModeCard icon={<WandSparkles />} title="Controlar a IA" description="Escolha, aprove ou rejeite os movimentos da IA." tag="EXPERIMENTAL" onClick={() => navigate('control')} />
      <ModeCard icon={<Users />} title="Local 1v1" description="Dois jogadores, um dispositivo e um tabuleiro." tag="PASS-AND-PLAY" onClick={() => navigate('local')} />
      <ModeCard icon={<Pencil />} title="Sandbox custom" description="Monte posições livres com peças personalizadas." tag="CREATIVO" onClick={() => navigate('sandbox')} />
    </div>
    <div className="bottom-feature-grid"><button className="feature-card" onClick={() => navigate('pieces')}><div className="feature-icon purple"><Crown /></div><div><strong>Crie novas peças</strong><span>Monte movimentos e regras experimentais.</span></div><ArrowRight size={17} /></button><button className="feature-card" onClick={() => navigate('settings')}><div className="feature-icon gold"><AudioLines /></div><div><strong>Personalize sua experiência</strong><span>Tabuleiro, sons, música e interface.</span></div><ArrowRight size={17} /></button></div>
  </div>;

  const renderOnlineLobby = () => <div className="page-content narrow-content"><div className="page-heading"><span className="eyebrow">MULTIPLAYER</span><h1>Jogue com alguém.</h1><p>Partidas reais entre jogadores conectados. Nenhum adversário fictício.</p></div><div className="online-cards"><div className="lobby-card"><div className="feature-icon green"><Users /></div><h2>Partida rápida</h2><p>Entre na fila e encontre o próximo jogador disponível.</p><button className="primary-button full-button" onClick={joinMatchmaking}><SearchIcon /> Encontrar adversário</button><button className="text-button" onClick={cancelQueue}>Cancelar busca</button></div><div className="lobby-card"><div className="feature-icon blue"><Plus /></div><h2>Sala privada</h2><p>Crie um código de convite ou entre na sala de um amigo.</p><button className="secondary-button full-button" onClick={createPrivateRoom}><Plus size={16} /> Criar sala</button>{createdRoom && <div className="created-room"><span>Código da sala</span><strong>{createdRoom}</strong><button className="text-button" onClick={() => navigator.clipboard?.writeText(`${location.origin}/play/room/${createdRoom}`).then(() => showNotice('Convite copiado.')).catch(() => showNotice('Código: ' + createdRoom))}>Copiar convite</button></div>}<div className="join-row"><input className="field" placeholder="Código da sala" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} /><button className="primary-button" onClick={joinPrivateRoom}>Entrar</button></div></div></div><div className="server-status"><span className={`status-badge ${health?.status === 'ok' ? 'is-online' : 'is-offline'}`} /><div><strong>Servidor multiplayer</strong><span>{health?.status === 'ok' ? 'API respondendo' : 'Servidor indisponível ou ainda não iniciado'}</span></div><span className="server-detail">{health?.database === 'connected' ? 'PostgreSQL conectado' : 'Banco não conectado'}</span></div></div>;

  const renderSandbox = () => <div className="page-content"><div className="page-heading"><span className="eyebrow">MODO CRIATIVO</span><h1>Custom Sandbox</h1><p>Monte livremente uma posição. Clique em uma peça da paleta e depois em uma casa para colocá-la; selecione Apagar para remover.</p></div><div className="sandbox-layout"><div className="sandbox-board">{renderBoard(true)}</div><aside className="sandbox-panel"><h3>Paleta de peças</h3><div className="palette-grid">{Object.entries(GLYPHS).map(([key, glyph]) => <button key={key} className={`palette-piece ${sandboxPalette === key ? 'palette-active' : ''}`} onClick={() => setSandboxPalette(key)}>{glyph}</button>)}</div><button className={`secondary-button full-button ${sandboxPalette === 'erase' ? 'erase-active' : ''}`} onClick={() => setSandboxPalette('erase')}><Trash2 size={15} /> Apagar peça</button><div className="separator" /><h3>Tabuleiro</h3><button className="secondary-button full-button" onClick={() => setSandboxGrid(Array.from({ length: 8 }, () => Array(8).fill(null)))}><RotateCcw size={15} /> Limpar tabuleiro</button><button className="primary-button full-button" onClick={saveSandbox}><Save size={15} /> Salvar configuração</button><p className="fine-print">A edição de posições está ativa. A execução de partidas com regras não convencionais e convite de amigos ainda precisa do motor de variantes.</p></aside></div></div>;

  const renderPieces = () => <div className="page-content"><div className="page-heading"><span className="eyebrow">OFICINA DE REGRAS</span><h1>Crie uma nova peça.</h1><p>Defina como ela se move usando vetores estruturados, sem executar código arbitrário.</p></div><div className="editor-layout"><section className="settings-card"><h2>Editor de peças</h2><div className="form-grid"><div><label className="field-label">Nome da peça</label><input className="field" value={pieceName} onChange={(e) => setPieceName(e.target.value)} /></div><div><label className="field-label">Símbolo</label><input className="field" maxLength={4} value={pieceSymbol} onChange={(e) => setPieceSymbol(e.target.value)} /></div><div><label className="field-label">Cor permitida</label><select className="field" value={pieceColor} onChange={(e) => setPieceColor(e.target.value)}><option value="both">Brancas e pretas</option><option value="white">Somente brancas</option><option value="black">Somente pretas</option></select></div><div><label className="field-label">Movimentos (dx,dy)</label><input className="field" value={piecePattern} onChange={(e) => setPiecePattern(e.target.value)} placeholder="1,2;2,1" /></div></div><label className="field-label">Descrição</label><textarea className="field textarea" value={pieceDescription} onChange={(e) => setPieceDescription(e.target.value)} placeholder="Descreva a habilidade da peça…" /><div className="rule-help"><strong>Como funciona?</strong><span>Use pares separados por ponto e vírgula. Exemplo: <code>1,2;2,1</code> cria saltos em L. Os movimentos salvos ficam disponíveis como definições estruturadas.</span></div><button className="primary-button" onClick={savePiece}><Save size={16} /> Salvar peça na biblioteca</button></section><section className="settings-card piece-library"><div className="section-title-row"><h2>Minha biblioteca</h2><span className="subtle-count">{customPieces.length} PEÇAS</span></div>{customPieces.length ? customPieces.map((piece) => <div className="piece-list-item" key={piece.id}><div className="custom-glyph">{piece.symbol}</div><div><strong>{piece.name}</strong><span>{piece.description || 'Sem descrição'}</span></div><span className="piece-color-label">{piece.color}</span></div>) : <div className="empty-state"><Crown size={28} /><strong>Nenhuma peça salva</strong><span>Crie uma peça para começar sua biblioteca.</span></div>}</section></div></div>;

  const renderSettings = () => <div className="page-content"><div className="page-heading"><span className="eyebrow">PREFERÊNCIAS</span><h1>Seu tabuleiro, suas regras.</h1><p>As preferências ficam neste navegador e podem sincronizar com a conta quando o banco estiver configurado.</p></div><div className="settings-layout"><section className="settings-card"><div className="settings-card-title"><div className="feature-icon purple"><Moon /></div><div><h2>Aparência</h2><span>Personalize o tabuleiro e a interface.</span></div></div><label className="field-label">Tema do tabuleiro</label><div className="theme-options"><button className={`theme-chip theme-classic ${settings.theme === 'classic' ? 'theme-selected' : ''}`} onClick={() => setSettings((s) => ({ ...s, theme: 'classic', boardLight: '#ead9bd', boardDark: '#9b7653' }))}>Clássico</button><button className={`theme-chip theme-midnight ${settings.theme === 'midnight' ? 'theme-selected' : ''}`} onClick={() => setSettings((s) => ({ ...s, theme: 'midnight', boardLight: '#c5cbd4', boardDark: '#586475' }))}>Midnight</button><button className={`theme-chip theme-forest ${settings.theme === 'forest' ? 'theme-selected' : ''}`} onClick={() => setSettings((s) => ({ ...s, theme: 'forest', boardLight: '#d9e2ce', boardDark: '#71876a' }))}>Forest</button></div><div className="color-row"><div><label className="field-label">Casas claras</label><input type="color" value={settings.boardLight} onChange={(e) => setSettings((s) => ({ ...s, boardLight: e.target.value }))} /></div><div><label className="field-label">Casas escuras</label><input type="color" value={settings.boardDark} onChange={(e) => setSettings((s) => ({ ...s, boardDark: e.target.value }))} /></div></div><ToggleRow label="Realçar últimos movimentos" checked={settings.highlightMoves} onChange={(v) => setSettings((s) => ({ ...s, highlightMoves: v }))} /><ToggleRow label="Coordenadas do tabuleiro" checked={settings.coordinates} onChange={(v) => setSettings((s) => ({ ...s, coordinates: v }))} /><ToggleRow label="Animações" checked={settings.animations} onChange={(v) => setSettings((s) => ({ ...s, animations: v }))} /></section>
      <section className="settings-card"><div className="settings-card-title"><div className="feature-icon gold"><Volume2 /></div><div><h2>Áudio</h2><span>Volume e efeitos sonoros independentes.</span></div></div><ToggleRow label="Silenciar tudo" checked={settings.muted} onChange={(v) => setSettings((s) => ({ ...s, muted: v }))} /><SliderRow label="Volume geral" value={settings.masterVolume} onChange={(v) => setSettings((s) => ({ ...s, masterVolume: v }))} /><SliderRow label="Efeitos sonoros" value={settings.effectsVolume} onChange={(v) => setSettings((s) => ({ ...s, effectsVolume: v }))} /><SliderRow label="Música de fundo" value={settings.musicVolume} onChange={(v) => setSettings((s) => ({ ...s, musicVolume: v }))} /><div className="sound-list"><span className="field-label">Efeitos</span>{[['move', 'Movimento'], ['capture', 'Captura'], ['check', 'Xeque'], ['click', 'Clique']].map(([key, label]) => <ToggleRow key={key} label={label} checked={settings.sounds[key] !== false} onChange={(v) => setSettings((s) => ({ ...s, sounds: { ...s.sounds, [key]: v } }))} compact />)}</div></section>
      <section className="settings-card music-card"><div className="settings-card-title"><div className="feature-icon blue"><Music2 /></div><div><h2>Música personalizada</h2><span>YouTube, Spotify ou áudio direto.</span></div></div><label className="field-label">Link de música</label><input className="field" value={settings.musicUrl} onChange={(e) => setSettings((s) => ({ ...s, musicUrl: e.target.value }))} placeholder="Cole um link do YouTube, Spotify ou .mp3" /><p className="fine-print">Links de streaming abrem em player incorporado quando compatíveis. Não extraímos nem baixamos áudio dessas plataformas.</p>{settings.musicUrl && <MusicPreview url={settings.musicUrl} />}</section></div><button className="primary-button save-settings" onClick={saveSettings}><Save size={16} /> Salvar configurações</button></div>;

  const renderProfile = () => <div className="page-content narrow-content"><div className="page-heading"><span className="eyebrow">SUA CONTA</span><h1>Perfil do jogador.</h1><p>Gerencie seu apelido e veja o tipo de sessão ativa.</p></div><section className="settings-card profile-card"><div className="profile-avatar">{(user?.username[0] || 'P').toUpperCase()}</div><div className="profile-data"><h2>{user?.username}</h2><span>{user?.guest ? 'Conta visitante' : user?.email || 'Conta registrada'}</span><span className="role-chip">{user?.role}</span></div></section><section className="settings-card"><label className="field-label">Apelido público</label><div className="join-row"><input className="field" value={profileName} onChange={(e) => setProfileName(e.target.value)} /><button className="primary-button" onClick={updateProfile}>Salvar</button></div>{user?.guest && <p className="fine-print">Visitantes podem jogar online, mas o apelido da sessão não é uma conta permanente.</p>}</section><button className="danger-button logout-button" onClick={logout}><LogOut size={15} /> Sair da conta</button></div>;

  const renderHistory = () => <div className="page-content"><div className="page-heading"><span className="eyebrow">PARTIDAS</span><h1>Seu histórico.</h1><p>Partidas online finalizadas e salvas no banco de dados.</p></div><div className="settings-card">{matches.length ? <div className="history-table">{matches.map((match) => <div className="history-row" key={match.id}><span>{new Date(match.startedAt).toLocaleDateString('pt-BR')}</span><strong>{match.whiteName} × {match.blackName}</strong><span>{match.result || 'Em andamento'}</span><span>{match.mode}</span></div>)}</div> : <div className="empty-state"><History size={28} /><strong>Nenhuma partida no histórico</strong><span>Partidas online salvas aparecerão aqui. O histórico não inclui partidas locais.</span></div>}</div></div>;

  const renderAdmin = () => <div className="page-content"><div className="page-heading"><span className="eyebrow">OWNER CONSOLE</span><h1>Painel administrativo.</h1><p>Controles sensíveis são validados no backend; esta tela não concede permissões por si só.</p></div>{!canAdmin ? <div className="settings-card"><Shield /><strong>Acesso restrito.</strong><span>Esta área está disponível apenas para o e-mail definido em OWNER_EMAIL.</span></div> : <><div className="stats-grid">{[['Usuários', adminStats?.users ?? '—'], ['Partidas', adminStats?.matches ?? '—'], ['Ativas', adminStats?.activeMatches ?? '—'], ['Online', adminStats?.onlineUsers ?? '—']].map(([title, value]) => <div className="stat-card" key={title}><span>{title}</span><strong>{value}</strong></div>)}</div><section className="settings-card"><div className="section-title-row"><h2>Gerenciar usuários</h2><button className="secondary-button" onClick={loadAdmin}>Atualizar</button></div><input className="field" placeholder="Buscar por usuário ou e-mail" value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') api(`/admin/users?q=${encodeURIComponent(adminSearch)}`).then((data: any) => setAdminUsers(data.users)); }} />{adminUsers.map((target) => <div className="admin-user-row" key={target.id}><div><strong>{target.username}</strong><span>{target.email || 'Visitante'} · {target.role}</span></div><span className={target.suspended ? 'suspended' : 'active-user'}>{target.suspended ? 'Suspenso' : 'Ativo'}</span>{target.role !== 'OWNER' && <button className="secondary-button" onClick={() => toggleUserSuspend(target)}>{target.suspended ? 'Reativar' : 'Suspender'}</button>}</div>)}</section><section className="settings-card"><h2>Publicar anúncio</h2><label className="field-label">Título</label><input className="field" value={announcementTitle} onChange={(e) => setAnnouncementTitle(e.target.value)} /><label className="field-label">Mensagem</label><textarea className="field textarea" value={announcementBody} onChange={(e) => setAnnouncementBody(e.target.value)} /><button className="primary-button" onClick={createAnnouncement}>Publicar</button></section></>}</div>;

  return <div className="app-shell">
    <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)}><Menu /></button><button className="brand" onClick={() => navigate('home')}><span className="brand-mark">♞</span><span>CHESS <b>REALM</b></span></button><div className="topbar-right"><div className="server-indicator"><span className={`live-dot ${health?.status === 'ok' ? '' : 'offline-dot'}`} />{health?.status === 'ok' ? 'Servidor ativo' : 'Servidor offline'}</div><button className="icon-button" title="Notificações"><Bell size={17} /></button><button className="user-pill" onClick={() => navigate('profile')}><span className="user-avatar">{(user?.username?.[0] || '?').toUpperCase()}</span><span>{user?.username || 'Visitante'}</span><ChevronDown size={14} /></button>{canAdmin && <button className="icon-button" title="Admin" onClick={() => navigate('admin')}><Shield size={17} /></button>}</div></header>
    <div className="app-body"><aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="sidebar-user"><span className="avatar side-avatar">{(user?.username?.[0] || 'P').toUpperCase()}</span><div><strong>{user?.username || 'Visitante'}</strong><span>{user?.guest ? 'Modo visitante' : user?.role === 'OWNER' ? 'Proprietário' : 'Jogador'}</span></div><span className="presence-dot" /></div>{['JOGAR', 'PERSONALIZAR', 'CONTA'].map((group) => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{NAV.filter((item) => item.group === group).map((item) => <button key={item.id} className={`nav-item ${mode === item.id ? 'nav-active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={17} /><span>{item.label}</span>{item.id === 'online' && <span className="nav-hot" />}</button>)}</div>)}{canAdmin && <div className="nav-group"><span className="nav-label">SISTEMA</span><button className={`nav-item ${mode === 'admin' ? 'nav-active' : ''}`} onClick={() => navigate('admin')}><Shield size={17} /><span>Administração</span></button></div>}<div className="sidebar-bottom"><div className="server-card"><div><span className="live-dot" /><strong>CHESS REALM</strong></div><span>Online chess platform</span><small>v1.0.0 · {health?.database === 'connected' ? 'DB conectado' : 'DB não configurado'}</small></div><button className="sidebar-logout" onClick={logout}><LogOut size={15} /> Sair</button></div></aside>
      <main className="main-area">{mode === 'home' && renderHome()}{mode === 'online' && !onlineState && renderOnlineLobby()}{isGame && (mode !== 'online' || onlineState) && renderGame()}{mode === 'sandbox' && renderSandbox()}{mode === 'pieces' && renderPieces()}{mode === 'settings' && renderSettings()}{mode === 'profile' && renderProfile()}{mode === 'history' && renderHistory()}{mode === 'admin' && renderAdmin()}</main>
    </div>
    {notice && <div className="toast"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}
    {authOpen && <div className="modal-backdrop"><div className="auth-modal"><button className="modal-close" onClick={() => { if (user) setAuthOpen(false); }}><X size={18} /></button><div className="auth-brand"><span className="brand-mark">♞</span><span>CHESS <b>REALM</b></span></div><span className="eyebrow">SEU PRÓXIMO DESAFIO</span><h1>Entre no jogo.</h1><p>Crie sua conta ou continue como visitante para jogar.</p><div className="auth-tabs"><button className={authTab === 'guest' ? 'auth-tab-active' : ''} onClick={() => setAuthTab('guest')}>Visitante</button><button className={authTab === 'login' ? 'auth-tab-active' : ''} onClick={() => setAuthTab('login')}>Entrar</button><button className={authTab === 'register' ? 'auth-tab-active' : ''} onClick={() => setAuthTab('register')}>Criar conta</button></div>{authTab !== 'login' && <><label className="field-label">Apelido</label><input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Seu nome no tabuleiro" maxLength={20} /></>}{authTab !== 'guest' && <><label className="field-label">E-mail ou login</label><input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" /> <label className="field-label">Senha</label><input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" /></>}{authTab === 'guest' ? <button className="primary-button full-button auth-submit" disabled={busy} onClick={() => signIn('guest')}>Continuar como visitante <ArrowRight size={16} /></button> : <button className="primary-button full-button auth-submit" disabled={busy} onClick={() => signIn(authTab)}>{busy ? 'Aguarde…' : authTab === 'login' ? 'Entrar na conta' : 'Criar minha conta'} <ArrowRight size={16} /></button>}<span className="auth-footnote">Visitantes podem jogar online. Cadastro e histórico permanente exigem PostgreSQL configurado.</span></div></div>}
    {mode === 'online' && onlineStatus.includes('Procurando') && <div className="waiting-overlay"><div className="waiting-card"><div className="spinner" /><h2>Procurando adversário</h2><p>Estamos aguardando outro jogador real entrar na fila.</p><button className="secondary-button" onClick={cancelQueue}>Cancelar busca</button></div></div>}
  </div>;
}

function ModeCard({ icon, title, description, tag, onClick }: { icon: React.ReactNode; title: string; description: string; tag: string; onClick: () => void }) {
  return <button className="mode-card" onClick={onClick}><div className="mode-card-top"><span className="mode-icon">{icon}</span><ArrowRight size={17} /></div><span className="mode-tag">{tag}</span><strong>{title}</strong><span className="mode-description">{description}</span></button>;
}
function ToggleRow({ label, checked, onChange, compact = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; compact?: boolean }) {
  return <div className={`toggle-row ${compact ? 'toggle-compact' : ''}`}><span>{label}</span><button className={`toggle ${checked ? 'toggle-on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}><span /></button></div>;
}
function SliderRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <div className="slider-row"><div><span>{label}</span><b>{value}%</b></div><input type="range" min="0" max="100" value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}
function SearchIcon() { return <Activity size={16} />; }

function MusicPreview({ url }: { url: string }) {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (youtube) return <div className="embed-preview music-embed"><iframe title="Player do YouTube" src={`https://www.youtube-nocookie.com/embed/${youtube[1]}`} allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" /></div>;
  const spotify = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
  if (spotify) return <div className="embed-preview music-embed"><iframe title="Player do Spotify" src={`https://open.spotify.com/embed/${spotify[1]}/${spotify[2]}`} allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture" /></div>;
  return <div className="embed-preview"><audio controls src={url} /></div>;
}
