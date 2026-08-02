# CLAUDE.md — Design Hub (o app)

Este é o **app**, não o Hub. Um Electron de macOS que roda os agentes do **Hub
de Design** num chat, para o time usar sem terminal e sem VS Code.

**Leia [`memoria/estado-atual.md`](memoria/estado-atual.md) no início de toda
sessão** — é onde está o que já foi feito e onde paramos.

## A regra que organiza tudo

**O app é casca. O Hub é o motor.**

Nada de agente é implementado aqui. O app usa o **Claude Agent SDK**, que roda o
mesmo motor do Claude Code apontado para a pasta do Hub (`../VS Code/`), e lê de
lá `.claude/agents/`, `.claude/skills/`, `CLAUDE.md` e `memoria/`. Melhorar um
agente é mexer no Hub, nunca aqui.

Consequência prática: **o Hub é read-only para este projeto.** Se um agente
precisa mudar, a mudança é lá.

## O modelo mental do produto

Uma **conversa é um assunto**, não um agente. Quem atende é o **Hub**, e ele
convoca os agentes que fizerem sentido — eles entram como membros e trabalham à
vista de todos. `@slug` no composer força um agente específico.

## Regras duras do código

1. **O SDK só roda no processo principal** (`main.js`). O renderer não tem Node,
   não tem filesystem, não tem SDK — só fala com `window.hub` (`preload.js`).
2. **Nada que escreve executa sem autorização na tela.** A lista fechada do que
   dispensa aprovação é `SEM_PERGUNTAR`, em `main.js`. Ampliar essa lista é
   decisão de produto, não de implementação.
3. **Segredo nunca vai para disco versionado.** Tokens de conector viajam pelo
   `env` do processo filho (ver `conectoresLocais()`), jamais para o `.mcp.json`
   do Hub, que é um repositório git.
4. **O fio da conversa é DADOS, não DOM.** É isso que permite salvar e reabrir.
   O desenho é sempre derivado do array de itens.
5. **Cor e tipografia saem dos tokens do DS** (`renderer/estilo.css`, bloco do
   topo). Nenhum hex solto fora dali.
6. **Voz de designer:** quem usa é designer, não dev. Sem jargão na interface.

## O que só o `.dmg` revela

Empacotar é um ambiente diferente, e já quebrou três vezes o que funcionava em
desenvolvimento: binário dentro do `app.asar` não executa (`asarUnpack`),
atalhos de `node_modules/.bin` não sobrevivem, e **`node` pode não existir no
PATH** da máquina (usar `process.execPath` + `ELECTRON_RUN_AS_NODE=1`).

**Toda mudança que toque em processo filho precisa ser testada no `.dmg`, não só
com `npm start`.**

## Como testar

Não existe teste unitário aqui. O que pega bug de verdade é um **teste de fumaça
que sobe a janela real e encena a conversa**, afirmando sobre o DOM e capturando
PNG por `webContents.capturePage()` (o app fotografando a si mesmo — dispensa
permissão de gravação de tela do sistema).

Rodar com `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron <arquivo>` —
a variável está setada neste ambiente e faz o Electron virar Node puro.

## Auto-aprendizado (passo final de toda tarefa)

Concluiu algo ou levou uma correção? Destile em lição acionável e registre em
[`memoria/aprendizados.md`](memoria/aprendizados.md); atualize
[`memoria/estado-atual.md`](memoria/estado-atual.md). Concluir sem registrar,
quando houve aprendizado, é tarefa incompleta.
