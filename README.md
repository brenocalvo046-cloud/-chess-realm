# CHESS REALM

Plataforma de xadrez em React + TypeScript + Vite, com API Node/Express, Socket.IO, Prisma e PostgreSQL.
A interface padrão está em português brasileiro.

## O que já está implementado

- Tabuleiro real com `chess.js`: movimentos legais, seleção de casas, xeque, xeque-mate, empate, histórico SAN e desfazer na partida local.
- Partida local 1v1 no mesmo dispositivo.
- Fluxo de visitante com apelido e sessão em cookie HTTP-only; cadastro/login com hash bcrypt quando PostgreSQL estiver configurado.
- Multiplayer Socket.IO: fila pública sem bots falsos, salas privadas por código, sincronização das jogadas no servidor, oferta de empate e desistência.
- Validação de turno e movimentos legais no servidor, com `chess.js` como estado autoritativo da partida online.
- Repositório de peças customizadas com regras estruturadas por vetores, e salvamento de tabuleiros sandbox.
- Configurações de tabuleiro, efeitos, volumes e música; YouTube/Spotify por player incorporado e áudio direto por URL.
- Rotas de administração protegidas no backend; o papel OWNER é atribuído pelo servidor ao e-mail `OWNER_EMAIL`.
- Endpoint de Stockfish por executável UCI configurado no servidor e endpoint ChatGPT pela Responses API que envia FEN/histórico/jogadas legais e valida a resposta antes de aceitá-la.
- Configuração de deploy separando Vercel (frontend) e Render (API persistente + PostgreSQL).

## Limitações conhecidas desta versão

Esta entrega é uma primeira versão funcional, não a plataforma completa descrita no briefing. Em particular:

- O multiplayer ainda mantém as partidas ativas em memória no processo; reiniciar o servidor encerra as partidas abertas. O histórico é gravado no PostgreSQL ao finalizar.
- A reconexão tem um evento de servidor preparado, mas ainda não existe fluxo completo de reconexão automática na interface.
- Os relógios são locais à interface; os tempos ainda não são sincronizados e validados pelo servidor no multiplayer.
- Stockfish só funciona depois de instalar um executável compatível no host e configurar `STOCKFISH_PATH`. O projeto não inclui um binário.
- ChatGPT só funciona depois de configurar `OPENAI_API_KEY` no backend. A chave nunca deve ir para o frontend.
- O modo “Controlar a IA” oferece aprovação/seleção de movimentos usando a integração Stockfish; ainda não tem explicações conversacionais completas.
- O sandbox atual permite montar e salvar posições 8×8, mas ainda não executa partidas com regras variantes, tabuleiros de dimensões diferentes ou peças customizadas contra amigos.
- A biblioteca de peças salva definições estruturadas; a integração dessas regras com um motor completo de variantes ainda não está concluída.
- A administração implementada cobre estatísticas básicas, busca/suspensão de usuários e anúncios. Moderação completa de salas, feature flags, manutenção e dashboard de atividade ainda não estão implementados.
- Partidas locais, sandbox e preferências locais não são gravadas como histórico de partida no banco.
- O player do YouTube/Spotify é incorporado, mas o volume dele é controlado no próprio player; o controle de volume do Chess Realm se aplica aos efeitos de interface.

Não trate as limitações acima como recursos concluídos. Elas estão descritas para evitar que o projeto seja apresentado como mais completo do que é.

## Requisitos

- Node.js 22 ou compatível com as dependências.
- npm 10+ recomendado.
- PostgreSQL para cadastro, biblioteca persistente, configurações sincronizadas e histórico.
- Stockfish UCI opcional.
- Chave OpenAI opcional.

## Executar localmente (Windows / Linux / macOS)

1. Extraia o projeto e abra o terminal na pasta `chess-realm`.
2. Instale as dependências:

   ```bash
   npm install
   ```

3. Copie `.env.example` para `.env` e defina um segredo forte para `JWT_SECRET`. Exemplo para gerar um segredo:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```

4. Configure `DATABASE_URL` com seu PostgreSQL. Exemplo local:

   ```env
   DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/chess_realm?schema=public"
   ```

5. Execute as migrações e gere o Prisma Client:

   ```bash
   npm run db:migrate
   npm run db:generate
   ```

6. Inicie frontend e backend juntos:

   ```bash
   npm run dev
   ```

- Frontend: http://localhost:5173
- API: http://localhost:4000
- Saúde da API: http://localhost:4000/api/health

Sem PostgreSQL, a interface e o modo visitante/local podem iniciar, mas registro, histórico e persistência de biblioteca/configurações ficam indisponíveis.

## Variáveis de ambiente

| Variável | Onde | Finalidade |
|---|---|---|
| `DATABASE_URL` | Backend | Conexão PostgreSQL |
| `JWT_SECRET` | Backend | Assinatura de sessões; use segredo longo |
| `OWNER_EMAIL` | Backend | E-mail que recebe o papel OWNER no servidor |
| `FRONTEND_URL` | Backend | Origem Vercel permitida no CORS; pode ser uma lista separada por vírgulas |
| `PORT` | Backend | Porta HTTP; Render injeta a porta de execução |
| `NODE_ENV` | Backend | Use `production` no Render |
| `OPENAI_API_KEY` | Backend | Chave opcional para ChatGPT; nunca expor no frontend |
| `OPENAI_MODEL` | Backend | Modelo habilitado na sua conta OpenAI |
| `STOCKFISH_PATH` | Backend | Caminho do executável Stockfish UCI no host |
| `VITE_API_URL` | Frontend | URL pública da API Render, sem `/api` no final |
| `VITE_SOCKET_URL` | Frontend | URL pública do servidor Socket.IO; normalmente a mesma API |

## Build e testes

```bash
npm run build
npm test --workspace @chess-realm/server
```

O build do servidor executa `prisma generate` antes do TypeScript. As verificações incluídas cobrem a posição inicial, jogadas legais, rejeição de jogadas ilegais e xeque-mate. Testes end-to-end de cadastro, banco, navegador e multiplayer exigem um ambiente com dependências instaladas e PostgreSQL disponível.

## GitHub

Na pasta do projeto:

```bash
git init
git add .
git commit -m "Initial Chess Realm project"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/chess-realm.git
git push -u origin main
```

Não adicione `.env` ao Git. O `.gitignore` já o exclui.

## Vercel (frontend)

1. Importe o repositório no Vercel.
2. Defina **Root Directory** como `client`.
3. Framework: Vite (detecção automática).
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Configure:
   - `VITE_API_URL=https://SEU-SERVICO.onrender.com`
   - `VITE_SOCKET_URL=https://SEU-SERVICO.onrender.com`
7. Faça deploy e copie o domínio do frontend.

O `client/vercel.json` já direciona rotas da SPA para `index.html`.

## Render (backend + PostgreSQL)

Há um `render.yaml` na raiz para criar o serviço web e o PostgreSQL pelo Blueprint. Na configuração:

1. Conecte o mesmo repositório ao Render e escolha Blueprint.
2. Preencha `OWNER_EMAIL`.
3. Em `FRONTEND_URL`, coloque a URL HTTPS real do Vercel.
4. Preencha `OPENAI_API_KEY` apenas se for ativar ChatGPT.
5. Após criar o banco, confirme que `DATABASE_URL` aponta para a conexão interna do PostgreSQL do Render.
6. O comando de inicialização do serviço já executa `prisma migrate deploy` antes de iniciar a API. As migrações iniciais estão incluídas em `server/prisma/migrations/`.

A API usa WebSockets e precisa permanecer em um serviço persistente; não a mova para funções serverless do Vercel.

## Ativar integrações de IA

**OpenAI:** defina `OPENAI_API_KEY` e `OPENAI_MODEL` no ambiente do backend. A integração usa a Responses API e saída JSON estruturada; escolha um modelo que esteja habilitado no seu projeto OpenAI. Reinicie o serviço. O endpoint `/api/health` informa se a variável foi detectada, sem expor o segredo.

**Stockfish:** instale um executável Stockfish compatível com UCI no host Render/servidor e defina `STOCKFISH_PATH` para o caminho absoluto. Reinicie o serviço. O endpoint `/api/health` mostra se o caminho foi configurado; isso não substitui um teste real do binário.

## Estrutura

```text
chess-realm/
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   └── vite-env.d.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vercel.json
│   └── vite.config.ts
├── server/
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── ai.ts
│   │   ├── auth.ts
│   │   ├── chess.test.ts
│   │   ├── db.ts
│   │   ├── env.ts
│   │   ├── index.ts
│   │   ├── routes.ts
│   │   └── socket.ts
│   ├── package.json
│   └── tsconfig.json
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── render.yaml
```

## Avisos importantes antes de abrir ao público

- O fluxo de cadastro ainda não verifica a posse do endereço de e-mail. Por isso, **não use a promoção automática por `OWNER_EMAIL` em um cadastro público antes de adicionar verificação de e-mail**. Para um lançamento real, faça o pré-cadastro seguro da conta proprietária ou implemente verificação por e-mail antes de conceder o papel OWNER. As rotas administrativas verificam a sessão e a permissão no backend, mas isso não substitui a prova de posse do e-mail.
- A sessão é mantida por cookie HTTP-only. Em produção, frontend e API devem usar HTTPS e `FRONTEND_URL` deve corresponder exatamente ao domínio publicado.
- Não foi possível instalar as dependências npm neste ambiente. A sintaxe dos arquivos TypeScript/TSX e os formatos JSON/YAML foram verificados, mas o build completo, o Prisma Client, as migrações em banco real e os testes automatizados ainda precisam ser executados depois de `npm install` em um ambiente com acesso ao registry npm.
