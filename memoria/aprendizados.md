# Aprendizados — Design Hub (o app)

Diário do que quebrou e do que virou regra. Entradas novas no fim.

## Empacotar é outro ambiente — teste sempre no `.dmg`

Três bugs seguidos que **não aparecem** com `npm start`:

1. **`spawn ENOTDIR`** — binário dentro do `app.asar` não é executável (o asar
   não é diretório de verdade). Fix: `asarUnpack`.
2. **Atalhos de `node_modules/.bin` não sobrevivem ao asar** — apontar direto
   para o arquivo do pacote.
3. **`node` pode não existir no PATH** (não existe nesta máquina). Usar o Node
   embutido do Electron: `command: process.execPath` +
   `env: { ELECTRON_RUN_AS_NODE: '1' }`.

**Regra: qualquer mudança que toque em processo filho precisa passar pelo `.dmg`.**

## `ELECTRON_RUN_AS_NODE` está setado neste ambiente

`npx electron arquivo.js` roda como Node puro e `require('electron')` devolve o
shim do npm (`ipcMain` fica `undefined`). Rodar com
`env -u ELECTRON_RUN_AS_NODE`. Pista no stack: `node:electron/js2c/node_init`.

## O screenshot que funciona vem de dentro do app

`screencapture` do sistema falha sem permissão de gravação de tela, mas
`webContents.capturePage()` é **o app fotografando a si mesmo** — não precisa de
permissão nenhuma. O teste que pega bug de verdade sobe a janela real, encena a
conversa por `webContents.send`, afirma sobre o DOM e salva PNG.

## Bugs de CSS que só a captura revelou

- **`display` explícito vence o atributo `hidden`.** Um botão com `display:grid`
  ignora `hidden = true`. Fix: `[hidden] { display: none !important }`.
- **Seletor que depende do ancestral quebra no reuso.** `.msg--fala .msg__quem`
  não valia no bloco de acerto de casa, que reusa `.msg__quem` sem a classe pai.
- **Menu centralizado escapa da janela.** `left: 50% + translateX(-50%)` mandou o
  menu para fora. Ancorar ao conteúdo é mais fácil de acertar e de ler.

## Sonda de custo zero

Abrir uma `query()`, ler o `system/init` e **abortar antes de qualquer
inferência**: ~1s e **US$ 0,00**. O init é o aperto de mão do processo, não uma
chamada ao modelo. É assim que se descobre ferramentas, modelo, autenticação e
agentes disponíveis sem cobrar nada de quem abre o app.

## `alwaysLoad: true` não é otimização, é requisito

Sem ele o MCP sobe sem bloquear, o `init` sai antes de conectar, e as ferramentas
**nunca entram no prompt do turno 1** — o servidor fica eternamente `pending`.

## Antes de desenhar um indicador, meça o estado

Ao implementar "mostrar as conexões", a medição revelou que 4 agentes estavam
quebrados havia semanas, falhando no meio da conversa sem explicar. **A chance de
um indicador revelar que o produto está quebrado é real — e é o melhor que pode
acontecer.**

Corolário: **toda lista de "o que dá pra fazer" tem que ser derivada do que está
disponível**, nunca de uma constante escrita à mão. A vitrine de boas-vindas
anunciava justamente um dos agentes bloqueados.

## "Não aparece" ≠ "aparece e não funciona"

Registrei que o SDK não enxergava os conectores da claude.ai. Impreciso: eles
aparecem (27 servidores) e param em `pending`/`needs-auth`. O efeito era o mesmo,
a descrição não — e distinguir os dois foi o que levou à solução (subir servidor
MCP local).

## Interface pode ser proibida; capacidade quase nunca é

A extensão oficial do VS Code não pode ser embutida (`© Anthropic PBC. All
rights reserved`) nem é portável (webview acoplada ao `acquireVsCodeApi`; roda no
Cursor porque o Cursor é fork do VS Code). **A documentação dela, porém, é uma
especificação excelente** — os modos de permissão, o menu `/`, o indicador de
contexto e o ditado saíram dali, com código nosso.

## Mídia em Electron só funciona em contexto seguro

`navigator.mediaDevices` some numa `data:` URL. O teste de microfone precisa
rodar na página real (`file://`).
