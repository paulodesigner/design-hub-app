// Design Hub — processo principal.
//
// Papel: ser a ponte entre a interface (renderer) e o Claude Agent SDK, que roda
// o mesmo motor do Claude Code apontado para a pasta do Hub.
//
// O modelo mental: uma CONVERSA é um assunto (um projeto, uma dúvida), não um
// agente. Quem atende é o Hub, e ele convoca os agentes que fizerem sentido —
// eles entram na conversa como membros e trabalham à vista de todos.
//
// Regras duras deste arquivo:
//   1. O SDK só roda aqui (Node). O renderer nunca toca no SDK.
//   2. Nenhuma ferramenta de escrita executa sem o usuário aprovar na tela.
//   3. O caminho do Hub é do usuário — nunca chutamos um caminho de produção.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Sem isto, `npm start` guarda os dados em `.../Electron` e o app empacotado em
// `.../Design Hub`: duas pastas, dois históricos, e a conversa "some" quando se
// troca de um para o outro. Precisa vir antes de qualquer `getPath('userData')`.
app.setName('Design Hub')

// ── Ferramentas que rodam sem perguntar ────────────────────────────────────
// Só entra aqui o que LÊ. Tudo que escreve, executa comando ou sai para a
// internet passa pela aprovação do usuário — é a promessa de segurança do app.
const SEM_PERGUNTAR = new Set([
  'Read',
  'Grep',
  'Glob',
  'NotebookRead',
  'TodoWrite',
  'Task',
  'ToolSearch',
])

// Lista de reserva, usada enquanto o SDK não devolveu a lista real de modelos.
// Rótulos curtos de propósito: o seletor vive numa barra apertada.
const MODELOS_PADRAO = [
  { value: '', displayName: 'Modelo padrão' },
  { value: 'claude-opus-5', displayName: 'Opus 5' },
  { value: 'claude-sonnet-5', displayName: 'Sonnet 5' },
  { value: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
]

// ── O que cada agente precisa para funcionar AQUI ──────────────────────────
// Medido, não suposto: os conectores da claude.ai APARECEM na lista de
// servidores, mas param em `pending`/`needs-auth` e nunca entregam ferramenta
// nenhuma ao modelo — eles vivem na sessão do navegador, não aqui. Um agente
// que depende deles falharia no meio da conversa sem explicar. Dizemos antes.
//
// `essencial: true` = sem isso o agente não faz o trabalho dele.
// `essencial: false` = ele funciona, só perde uma capacidade.

// Ler e ESCREVER no Figma são capacidades diferentes: a REST API (que o
// conector local usa) lê o arquivo, mas não desenha no canvas. Só o conector
// oficial da claude.ai escreve — e ele não entrega ferramentas aqui.
const CONECTORES = {
  figmaLeitura: {
    nome: 'Figma (leitura)',
    comoDetectar: (amb) => amb.ferramentas.some((t) => /^mcp__figma__/.test(t)),
  },
  figmaEscrita: {
    nome: 'Figma (desenhar)',
    comoDetectar: (amb) =>
      amb.ferramentas.some((t) => /^mcp__.*figma.*__(use_figma|create_new_file|generate)/i.test(t)),
  },
  notion: { nome: 'Notion', comoDetectar: (amb) => amb.ferramentas.some((t) => /notion/i.test(t)) },
  calendario: {
    nome: 'Google Calendar',
    comoDetectar: (amb) => amb.ferramentas.some((t) => /calendar/i.test(t)),
  },
  mobbin: { nome: 'Mobbin', comoDetectar: (amb) => amb.ferramentas.some((t) => /mobbin/i.test(t)) },
}

const REQUISITOS = {
  'codigo-ao-figma': [{ id: 'figmaEscrita', essencial: true }],
  'figma-ao-codigo': [{ id: 'figmaLeitura', essencial: true }],
  'mapa-do-design-system': [{ id: 'figmaLeitura', essencial: true }],
  'leitor-de-comentarios': [{ id: 'figmaLeitura', essencial: true }],
  'agenda-da-sprint': [
    { id: 'notion', essencial: true },
    { id: 'calendario', essencial: true },
  ],
  'estudio-de-design': [{ id: 'mobbin', essencial: false }],
  'regras-de-negocio': [{ id: 'notion', essencial: false }],
}

// ── Conectores que o APP liga sozinho ───────────────────────────────────────
// Os conectores da claude.ai vivem na sessão do navegador e nunca entregam
// ferramentas aqui (aparecem como `pending`/`needs-auth` e ficam nisso). O que
// funciona é subir servidores MCP locais, com credenciais que já existem na
// máquina. O segredo vai pelo `env` do processo filho — nunca para o disco do
// Hub, que é um repositório git.

function segredoLocal(caminhoRelativo) {
  try {
    const t = fs.readFileSync(path.join(require('node:os').homedir(), caminhoRelativo), 'utf8').trim()
    return t || null
  } catch {
    return null
  }
}

function conectoresLocais() {
  const servidores = {}

  const tokenFigma = segredoLocal('.config/ebp/figma_token')
  if (tokenFigma) {
    // Dois cuidados de empacotamento, ambos descobertos testando o .dmg:
    //   1. Os atalhos de `node_modules/.bin` não sobrevivem ao asar — apontamos
    //      direto para o arquivo do pacote.
    //   2. A máquina de quem instala pode não ter `node` no PATH (a minha não
    //      tem). Usamos o Node que já vem dentro do Electron: o próprio
    //      executável do app, em modo Node.
    const script = path
      .join(__dirname, 'node_modules', 'figma-developer-mcp', 'dist', 'bin.js')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

    if (fs.existsSync(script)) {
      servidores.figma = {
        type: 'stdio',
        command: process.execPath,
        args: [script, '--stdio'],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          FIGMA_API_KEY: tokenFigma,
        },
        // Sem isto o init sai antes de o servidor conectar e as ferramentas
        // nunca entram no prompt do primeiro turno.
        alwaysLoad: true,
      }
    }
  }

  return servidores
}

let janela = null
let modelosConhecidos = MODELOS_PADRAO
let ambienteCache = null

// ── Onde o app guarda as coisas ─────────────────────────────────────────────

const pastaDados = () => app.getPath('userData')
const arqConfig = () => path.join(pastaDados(), 'configuracao.json')
const arqConversas = () => path.join(pastaDados(), 'conversas.json')
const arqFio = (id) => path.join(pastaDados(), 'fios', `${id}.json`)

function lerJSON(caminho, padrao) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'))
  } catch {
    return padrao
  }
}

function gravarJSON(caminho, dados) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2))
}

const lerConfig = () => lerJSON(arqConfig(), {})
const gravarConfig = (d) => gravarJSON(arqConfig(), d)

// ── Onde fica o Hub ─────────────────────────────────────────────────────────

// Marcas do Hub, não de "uma pasta qualquer com agentes". Qualquer projeto pode
// ter um `.claude/agents/`; só o Hub tem o `memoria/agentes.md` que descreve o
// elenco. Sem esta segunda marca, o próprio projeto do app se identificaria
// como Hub quando morasse ao lado de um `.claude`.
function ehHubValido(caminho) {
  if (!caminho) return false
  try {
    if (!fs.statSync(path.join(caminho, '.claude', 'agents')).isDirectory()) return false
  } catch {
    return false
  }
  return (
    fs.existsSync(path.join(caminho, 'memoria', 'agentes.md')) ||
    fs.existsSync(path.join(caminho, 'CLAUDE.md'))
  )
}

// Em desenvolvimento o app mora dentro do Hub, então a pasta-mãe é o palpite
// certo. Empacotado isso não vale — aí depende da escolha guardada.
function descobrirHub() {
  const salvo = lerConfig().hub
  if (ehHubValido(salvo)) return salvo
  const vizinho = path.resolve(__dirname, '..')
  if (ehHubValido(vizinho)) return vizinho
  return null
}

// ── O elenco: agentes lidos do disco ────────────────────────────────────────
// Mais rápido e mais barato que perguntar ao modelo — o frontmatter dos
// arquivos `.claude/agents/*.md` já traz a descrição de quando usar cada um.

function lerElenco(hub) {
  const pasta = path.join(hub, '.claude', 'agents')
  let arquivos = []
  try {
    arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  return arquivos
    .map((arquivo) => {
      const slug = arquivo.replace(/\.md$/, '')
      let descricao = ''
      try {
        const bruto = fs.readFileSync(path.join(pasta, arquivo), 'utf8')
        const frente = bruto.match(/^---\n([\s\S]*?)\n---/)
        if (frente) {
          const linha = frente[1].match(/^description:\s*([\s\S]+?)(?=\n\w+:|$)/m)
          if (linha) descricao = linha[1].trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ')
        }
      } catch {
        /* um agente ilegível não pode derrubar a lista inteira */
      }
      // A descrição de agente é longa; para o prompt basta a primeira ideia.
      const curta = descricao.split(/(?<=\.)\s/).slice(0, 2).join(' ').slice(0, 320)
      return { slug, descricao: curta }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug, 'pt-BR'))
}

// ── Sonda do ambiente ───────────────────────────────────────────────────────
// Abre uma sessão, lê o handshake (`system/init`) e ABORTA antes de qualquer
// chamada ao modelo. Medido: ~1s e custo zero — o init é o aperto de mão do
// processo, não uma inferência. É assim que sabemos, sem cobrar nada, quais
// ferramentas existem de verdade nesta máquina.

async function sondarAmbiente(hub) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const controle = new AbortController()
  const amb = {
    ferramentas: [],
    servidoresMcp: [],
    modelo: null,
    autenticacao: null,
    agentesDoMotor: [],
    sondadoEm: new Date().toISOString(),
  }

  try {
    const q = query({
      prompt: 'ping',
      options: {
        cwd: hub,
        settingSources: ['user', 'project', 'local'],
        abortController: controle,
        mcpServers: conectoresLocais(),
      },
    })
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        amb.ferramentas = m.tools || []
        amb.servidoresMcp = m.mcp_servers || []
        amb.modelo = m.model
        amb.autenticacao = m.apiKeySource
        amb.agentesDoMotor = m.agents || []
        controle.abort()
        break
      }
    }
  } catch {
    // Abortar levanta — é o caminho esperado, não um erro.
  }

  ambienteCache = amb
  return amb
}

// Traduz a sonda em "este agente funciona aqui?".
function avaliarProntidao(amb, slugs) {
  const disponivel = {}
  for (const [id, c] of Object.entries(CONECTORES)) {
    disponivel[id] = amb ? Boolean(c.comoDetectar(amb)) : false
  }

  const porAgente = {}
  for (const slug of slugs) {
    const req = REQUISITOS[slug] || []
    const faltando = req.filter((r) => !disponivel[r.id])
    const bloqueio = faltando.filter((r) => r.essencial)
    porAgente[slug] = {
      estado: bloqueio.length ? 'bloqueado' : faltando.length ? 'limitado' : 'pronto',
      faltando: faltando.map((r) => ({
        id: r.id,
        nome: CONECTORES[r.id].nome,
        essencial: r.essencial,
      })),
    }
  }

  return {
    conectores: Object.entries(CONECTORES).map(([id, c]) => ({
      id,
      nome: c.nome,
      ligado: disponivel[id],
    })),
    porAgente,
    prontos: Object.values(porAgente).filter((a) => a.estado === 'pronto').length,
    bloqueados: Object.values(porAgente).filter((a) => a.estado === 'bloqueado').length,
  }
}

ipcMain.handle('hub:prontidao', async (_e, { revalidar } = {}) => {
  const hub = descobrirHub()
  if (!hub) return { ok: false }
  const amb = revalidar || !ambienteCache ? await sondarAmbiente(hub) : ambienteCache
  const slugs = lerElenco(hub).map((a) => a.slug)
  return { ok: true, ambiente: amb, ...avaliarProntidao(amb, slugs) }
})

// ── Conversas ───────────────────────────────────────────────────────────────
// Uma conversa = { id, nome, membros (null = todos), modelo, sessionId, custo,
//                  criadaEm, mexidaEm, arquivada }
// O fio (as mensagens) mora em arquivo separado para a lista abrir rápido.

function lerConversas() {
  return lerJSON(arqConversas(), [])
}

function gravarConversas(lista) {
  gravarJSON(arqConversas(), lista)
}

function acharConversa(id) {
  return lerConversas().find((c) => c.id === id) || null
}

function salvarConversa(conversa) {
  const lista = lerConversas()
  const i = lista.findIndex((c) => c.id === conversa.id)
  if (i >= 0) lista[i] = conversa
  else lista.unshift(conversa)
  gravarConversas(lista)
}

function novoId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// Nome automático a partir da primeira frase, no formato de canal.
function apelidar(texto) {
  const limpo = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira os acentos separados pelo NFD
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 4)
    .join('-')
  return limpo || 'conversa'
}

// ── Sessões em andamento ────────────────────────────────────────────────────

const emAndamento = new Map() // idConversa -> { abortar() }
const permissoesPendentes = new Map() // id -> resolve

function avisar(conversa, evento, dados) {
  if (janela && !janela.isDestroyed()) {
    janela.webContents.send('agente:evento', { conversa, evento, ...dados })
  }
}

async function pedirPermissao(idConversa, nomeFerramenta, entrada, agente) {
  const id = `${idConversa}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve) => {
    permissoesPendentes.set(id, resolve)
    avisar(idConversa, 'permissao', { id, ferramenta: nomeFerramenta, entrada, agente })
  })
}

ipcMain.on('permissao:responder', (_e, { id, aprovado }) => {
  const resolve = permissoesPendentes.get(id)
  if (!resolve) return
  permissoesPendentes.delete(id)
  resolve(Boolean(aprovado))
})

// ── A instrução que transforma o Hub em anfitrião da conversa ───────────────

function montarInstrucao(elenco, membros) {
  const podem = membros ? elenco.filter((a) => membros.includes(a.slug)) : elenco
  const linhas = podem.map((a) => `- @${a.slug} — ${a.descricao}`).join('\n')

  return `Você é o **Hub**, anfitrião de uma conversa em grupo do Design Hub.
Quem fala com você é designer de produto, não desenvolvedor: responda em
português do Brasil, sem jargão, uma coisa de cada vez.

## Quem está nesta conversa

${linhas}
${membros ? '\nSomente estes agentes participam desta conversa. Não acione nenhum outro.' : ''}

## Como conduzir

1. **Menção manda.** Se a pessoa escrever @slug, acione exatamente aquele agente
   pela ferramenta Task (subagent_type = o slug), sem discutir a escolha.
2. **Sem menção, decida você.** Se o pedido é claramente o papel de um dos
   membros, acione-o. Se envolve dois papéis (ex.: a regra do sistema E o
   desenho da tela), acione os dois — em paralelo, numa só mensagem.
3. **Nem tudo precisa de agente.** Conversa, pergunta rápida, dúvida sobre o
   próprio Hub: responda você mesmo, sem delegar.
4. **Antes de acionar, diga em uma linha quem você vai chamar e por quê.** A
   pessoa está vendo a conversa acontecer e precisa entender o encaminhamento.
5. **Depois que os agentes voltarem, feche.** Uma síntese curta do que ficou
   decidido e do que ainda falta. Não repita o que eles já escreveram.`
}

// ── O envio de uma mensagem ─────────────────────────────────────────────────

ipcMain.handle('conversa:enviar', async (_e, { id, texto, ...dadosExtra }) => {
  const hub = descobrirHub()
  if (!hub) return { ok: false, erro: 'Hub não configurado.' }
  if (emAndamento.has(id)) return { ok: false, erro: 'Esta conversa já está trabalhando.' }

  const conversa = acharConversa(id)
  if (!conversa) return { ok: false, erro: 'Conversa não encontrada.' }

  // Import dinâmico: o SDK é ESM e este arquivo é CommonJS.
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  const elenco = lerElenco(hub)
  const controle = new AbortController()
  emAndamento.set(id, { abortar: () => controle.abort() })

  const opcoes = {
    cwd: hub,
    // 'project' é obrigatório para o CLAUDE.md do Hub entrar em contexto.
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    // Sem isso, um subagente só aparece como contador de ferramentas. Com isso,
    // a fala dele chega inteira e a conversa mostra os agentes trabalhando.
    forwardSubagentText: true,
    agentProgressSummaries: true,
    abortController: controle,
    mcpServers: conectoresLocais(),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: montarInstrucao(elenco, conversa.membros),
    },
    canUseTool: async (nomeFerramenta, entrada) => {
      if (SEM_PERGUNTAR.has(nomeFerramenta)) return { behavior: 'allow', updatedInput: entrada }
      const aprovado = await pedirPermissao(id, nomeFerramenta, entrada)
      return aprovado
        ? { behavior: 'allow', updatedInput: entrada }
        : { behavior: 'deny', message: 'A pessoa não autorizou esta ação.' }
    },
  }

  if (conversa.modelo) opcoes.model = conversa.modelo
  if (conversa.sessionId) opcoes.resume = conversa.sessionId

  // Manual (padrão) · Plano (descreve antes de agir) · Aceitar edições.
  // Em 'plan' o motor não executa nada — é o modo de pensar junto.
  if (conversa.modo && conversa.modo !== 'default') opcoes.permissionMode = conversa.modo

  avisar(id, 'inicio', {})

  // Um Task em andamento vira um bloco de agente na tela; o mapa liga o
  // tool_use_id do Task ao slug do agente para rotular as falas seguintes.
  const tarefas = new Map()

  try {
    // Anexos viram contexto explícito no início do pedido — mais previsível
    // que depender do modelo adivinhar que deve abrir um arquivo citado.
    const anexos = Array.isArray(dadosExtra?.anexos) ? dadosExtra.anexos : []
    const pedido = anexos.length
      ? `Arquivos anexados a esta mensagem (leia-os antes de responder):\n${anexos
          .map((a) => `- ${a}`)
          .join('\n')}\n\n${texto}`
      : texto

    const q = query({ prompt: pedido, options: opcoes })

    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        conversa.sessionId = m.session_id
        avisar(id, 'pronto', { modelo: m.model, autenticacao: m.apiKeySource })
        // A lista real de modelos só existe com um processo vivo — aproveita.
        q.supportedModels()
          .then((lista) => {
            if (Array.isArray(lista) && lista.length) {
              modelosConhecidos = [MODELOS_PADRAO[0], ...lista]
              avisar(id, 'modelos', { modelos: modelosConhecidos })
            }
          })
          .catch(() => {})
        continue
      }

      // Texto saindo token a token. Vale para o Hub E para os subagentes: sem
      // isso o agente fica mudo enquanto trabalha, que é a "pausa inexplicada"
      // — o pior sintoma de espera numa interface de agente.
      if (m.type === 'stream_event') {
        const ev = m.event
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          if (m.parent_tool_use_id) {
            avisar(id, 'agente-digitando', {
              tarefaId: m.parent_tool_use_id,
              pedaco: ev.delta.text,
            })
          } else {
            avisar(id, 'texto', { pedaco: ev.delta.text })
          }
        }
        continue
      }

      if (m.type === 'assistant') {
        const deAgente = Boolean(m.parent_tool_use_id)
        for (const bloco of m.message?.content || []) {
          if (bloco.type === 'tool_use') {
            if (bloco.name === 'Task') {
              const slug = bloco.input?.subagent_type || 'agente'
              tarefas.set(bloco.id, slug)
              avisar(id, 'agente-entrou', {
                tarefaId: bloco.id,
                agente: slug,
                descricao: bloco.input?.description || '',
                entrouEm: Date.now(),
              })
            } else {
              avisar(id, 'ferramenta', {
                ferramentaId: bloco.id,
                nome: bloco.name,
                entrada: bloco.input,
                tarefaId: m.parent_tool_use_id || null,
              })
            }
          } else if (bloco.type === 'text' && deAgente && bloco.text.trim()) {
            avisar(id, 'agente-falou', {
              tarefaId: m.parent_tool_use_id,
              agente: m.subagent_type || tarefas.get(m.parent_tool_use_id) || 'agente',
              texto: bloco.text,
            })
          }
        }
        continue
      }

      // Resultado de ferramenta volta como mensagem de usuário sintética.
      if (m.type === 'user' && Array.isArray(m.message?.content)) {
        for (const bloco of m.message.content) {
          if (bloco.type !== 'tool_result') continue
          if (tarefas.has(bloco.tool_use_id)) {
            avisar(id, 'agente-saiu', {
              tarefaId: bloco.tool_use_id,
              erro: Boolean(bloco.is_error),
            })
          } else {
            avisar(id, 'ferramenta-fim', {
              ferramentaId: bloco.tool_use_id,
              erro: Boolean(bloco.is_error),
            })
          }
        }
        continue
      }

      if (m.type === 'result') {
        conversa.custo = (conversa.custo || 0) + (m.total_cost_usd || 0)
        conversa.mexidaEm = new Date().toISOString()
        salvarConversa(conversa)
        // Quanto da janela de contexto o turno consumiu. Serve para o
        // indicador do composer avisar antes de a conversa ficar pesada.
        const u = m.usage || {}
        const usados =
          (u.input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0)
        conversa.contexto = { usados, teto: 1000000 }

        avisar(id, 'fim', {
          erro: m.subtype !== 'success',
          resultado: m.subtype === 'success' ? m.result : m.subtype,
          custoTotal: conversa.custo,
          duracaoMs: m.duration_ms,
          contexto: conversa.contexto,
        })
      }
    }

    conversa.mexidaEm = new Date().toISOString()
    salvarConversa(conversa)
    return { ok: true }
  } catch (erro) {
    const abortado = controle.signal.aborted
    salvarConversa(conversa)
    avisar(id, 'fim', {
      erro: !abortado,
      interrompido: abortado,
      resultado: abortado ? 'interrompido' : String(erro?.message || erro),
      custoTotal: conversa.custo || 0,
    })
    return { ok: false, erro: String(erro?.message || erro) }
  } finally {
    emAndamento.delete(id)
    // Permissão pendente de um turno morto travaria o próximo envio.
    for (const [pid, resolve] of permissoesPendentes) {
      if (pid.startsWith(`${id}:`)) {
        permissoesPendentes.delete(pid)
        resolve(false)
      }
    }
  }
})

ipcMain.handle('conversa:parar', (_e, { id }) => {
  emAndamento.get(id)?.abortar()
  return { ok: true }
})

// ── CRUD das conversas ──────────────────────────────────────────────────────

ipcMain.handle('conversas:listar', () => ({
  conversas: lerConversas(),
  modelos: modelosConhecidos,
}))

ipcMain.handle('conversas:criar', (_e, { nome, membros } = {}) => {
  const conversa = {
    id: novoId(),
    nome: nome || 'nova-conversa',
    nomeAutomatico: !nome,
    membros: membros || null, // null = todos os agentes podem entrar
    modelo: lerConfig().modeloPadrao || '',
    sessionId: null,
    custo: 0,
    criadaEm: new Date().toISOString(),
    mexidaEm: new Date().toISOString(),
    arquivada: false,
  }
  salvarConversa(conversa)
  gravarJSON(arqFio(conversa.id), [])
  return { ok: true, conversa }
})

ipcMain.handle('conversas:abrir', (_e, { id }) => {
  const conversa = acharConversa(id)
  if (!conversa) return { ok: false }
  return { ok: true, conversa, fio: lerJSON(arqFio(id), []) }
})

// O renderer é dono do fio na tela; ele devolve a versão salvável.
ipcMain.handle('conversas:gravar-fio', (_e, { id, fio }) => {
  gravarJSON(arqFio(id), fio)
  return { ok: true }
})

ipcMain.handle('conversas:atualizar', (_e, { id, mudancas }) => {
  const conversa = acharConversa(id)
  if (!conversa) return { ok: false }
  Object.assign(conversa, mudancas, { mexidaEm: new Date().toISOString() })
  salvarConversa(conversa)
  if (mudancas.modelo !== undefined) {
    gravarConfig({ ...lerConfig(), modeloPadrao: mudancas.modelo })
  }
  return { ok: true, conversa }
})

// "Nova conversa" com o mesmo assunto: zera a sessão, mantém nome e membros.
ipcMain.handle('conversas:reiniciar', (_e, { id }) => {
  const conversa = acharConversa(id)
  if (!conversa) return { ok: false }
  conversa.sessionId = null
  conversa.custo = 0
  salvarConversa(conversa)
  gravarJSON(arqFio(id), [])
  return { ok: true, conversa }
})

ipcMain.handle('conversas:excluir', (_e, { id }) => {
  gravarConversas(lerConversas().filter((c) => c.id !== id))
  try {
    fs.unlinkSync(arqFio(id))
  } catch {
    /* fio já pode não existir */
  }
  return { ok: true }
})

// ── Estado do Hub, visto pela interface ─────────────────────────────────────

ipcMain.handle('hub:estado', () => {
  const hub = descobrirHub()
  return {
    ok: Boolean(hub),
    caminho: hub,
    elenco: hub ? lerElenco(hub) : [],
    modelos: modelosConhecidos,
  }
})

ipcMain.handle('hub:escolher', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Onde fica a pasta do Hub de Design?',
    message: 'Escolha a pasta que contém .claude/ e CLAUDE.md',
    properties: ['openDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) return { ok: false }
  const escolhido = r.filePaths[0]
  if (!ehHubValido(escolhido)) {
    return { ok: false, erro: 'Essa pasta não tem .claude/agents dentro.' }
  }
  gravarConfig({ ...lerConfig(), hub: escolhido })
  return { ok: true, caminho: escolhido, elenco: lerElenco(escolhido) }
})

ipcMain.handle('hub:anexar', async () => {
  const hub = descobrirHub()
  const r = await dialog.showOpenDialog(janela, {
    title: 'Anexar à conversa',
    defaultPath: hub || undefined,
    properties: ['openFile', 'multiSelections'],
  })
  if (r.canceled) return { ok: false }
  // Caminho relativo quando o arquivo está dentro do Hub: fica legível na tela
  // e é o que os agentes esperam ver.
  const caminhos = r.filePaths.map((c) =>
    hub && c.startsWith(hub + path.sep) ? path.relative(hub, c) : c,
  )
  return { ok: true, caminhos }
})

ipcMain.handle('hub:abrir-pasta', () => {
  const hub = descobrirHub()
  if (hub) shell.openPath(hub)
  return { ok: Boolean(hub) }
})

// ── Achar o Hub sozinho ─────────────────────────────────────────────────────
// Em vez de mandar a pessoa caçar a pasta num seletor de arquivos, procuramos
// nos lugares onde ela provavelmente está. Só pedimos ajuda se não acharmos.

function procurarHub() {
  const casa = require('node:os').homedir()
  const raizes = [
    casa,
    path.join(casa, 'Desktop'),
    path.join(casa, 'Documents'),
    path.join(casa, 'Developer'),
    path.join(casa, 'Projects'),
    path.join(casa, 'dev'),
    path.join(casa, 'code'),
  ]

  const achados = []
  for (const raiz of raizes) {
    let entradas = []
    try {
      entradas = fs.readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }
    for (const e of entradas) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const candidato = path.join(raiz, e.name)
      if (ehHubValido(candidato)) achados.push(candidato)
      // Uma pasta a mais de profundidade: o Hub costuma ficar dentro de uma
      // pasta-guarda-chuva ("Design System/VS Code").
      let netos = []
      try {
        netos = fs.readdirSync(candidato, { withFileTypes: true }).filter((n) => n.isDirectory())
      } catch {
        continue
      }
      for (const n of netos) {
        if (n.name.startsWith('.') || n.name === 'node_modules') continue
        const fundo = path.join(candidato, n.name)
        if (ehHubValido(fundo)) achados.push(fundo)
      }
    }
  }
  return [...new Set(achados)]
}

ipcMain.handle('hub:procurar', () => {
  const achados = procurarHub()
  if (achados.length === 1) {
    gravarConfig({ ...lerConfig(), hub: achados[0] })
    return { ok: true, caminho: achados[0], elenco: lerElenco(achados[0]) }
  }
  return { ok: false, achados }
})

ipcMain.handle('hub:usar', (_e, { caminho }) => {
  if (!ehHubValido(caminho)) return { ok: false, erro: 'Essa pasta não tem .claude/agents dentro.' }
  gravarConfig({ ...lerConfig(), hub: caminho })
  return { ok: true, caminho, elenco: lerElenco(caminho) }
})

// ── Baixar o Hub, sem terminal ──────────────────────────────────────────────
// O segundo passo de terminal que sobrava. O `git clone` roda daqui, com a
// credencial que a pessoa já tem configurada no Mac.

const REPO_HUB = 'https://github.com/Educbank/design-system-code-to-figma.git'

ipcMain.handle('hub:clonar', async () => {
  const { spawnSync } = require('node:child_process')
  const destino = path.join(require('node:os').homedir(), 'Documents', 'Design Hub')

  if (ehHubValido(destino)) {
    gravarConfig({ ...lerConfig(), hub: destino })
    return { ok: true, caminho: destino, jaExistia: true, elenco: lerElenco(destino) }
  }
  if (fs.existsSync(destino)) {
    return { ok: false, erro: `Já existe algo em ${destino} que não é o Hub.` }
  }

  // Sem credencial de leitura no repositório, `clone` fica pendurado esperando
  // usuário e senha no terminal — que é justamente o que queremos evitar.
  const alcance = spawnSync('git', ['ls-remote', '--exit-code', '-h', REPO_HUB], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  })
  if (alcance.status !== 0) {
    return { ok: false, semAcesso: true, repo: REPO_HUB }
  }

  const r = spawnSync('git', ['clone', '--depth', '1', REPO_HUB, destino], {
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (r.status !== 0 || !ehHubValido(destino)) {
    return { ok: false, erro: (r.stderr || 'não consegui baixar').split('\n').slice(-2).join(' ') }
  }

  gravarConfig({ ...lerConfig(), hub: destino })
  return { ok: true, caminho: destino, elenco: lerElenco(destino) }
})

// ── Manter o Hub fresco ─────────────────────────────────────────────────────
// Puxa o que o time publicou, em segundo plano, e devolve o que MUDOU para o
// Hub anunciar na conversa. Fast-forward only: nunca cria conflito nem merge.

function git(hub, args) {
  const { spawnSync } = require('node:child_process')
  const r = spawnSync('git', args, { cwd: hub, encoding: 'utf8', timeout: 25000 })
  return { ok: r.status === 0, saida: (r.stdout || '').trim(), erro: (r.stderr || '').trim() }
}

ipcMain.handle('hub:sincronizar', () => {
  const hub = descobrirHub()
  if (!hub) return { ok: false }
  if (!git(hub, ['rev-parse', '--git-dir']).ok) return { ok: false, semGit: true }

  const antes = new Set(lerElenco(hub).map((a) => a.slug))
  const sujo = git(hub, ['status', '--porcelain']).saida
  // Com trabalho não salvo, puxar pode dar dor de cabeça. Melhor não mexer.
  if (sujo) return { ok: false, sujo: true }

  const pull = git(hub, ['pull', '--ff-only'])
  if (!pull.ok) return { ok: false, erro: pull.erro.split('\n')[0] }

  const depois = lerElenco(hub)
  const novos = depois.filter((a) => !antes.has(a.slug)).map((a) => a.slug)
  const semNovidade = /Already up to date|Já atualizado/i.test(pull.saida)
  return { ok: true, novos, atualizou: !semNovidade }
})

// ── Janela ──────────────────────────────────────────────────────────────────

function criarJanela() {
  janela = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 580,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: '#F8F8F8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  janela.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  janela.once('ready-to-show', () => janela.show())

  // Link externo abre no navegador, nunca dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  criarJanela()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
