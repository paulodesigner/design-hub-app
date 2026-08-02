// Design Hub — interface.
//
// Este arquivo não sabe nada sobre o Claude. Ele fala com `window.hub` (o
// preload) e desenha o que volta.
//
// O fio da conversa é modelado como DADOS (um array de itens), não como DOM.
// É isso que permite salvar a conversa em disco e reabrir depois — o desenho é
// sempre derivado dos dados, nunca o contrário.

import { marcacao } from './marcacao.js'

// ── Como cada agente aparece ────────────────────────────────────────────
// O slug bate com o arquivo em `<hub>/.claude/agents/`. Quem não estiver
// aqui ainda funciona: cai no visual genérico.

const ELENCO = {
  anfitriao: { emoji: '👋', nome: 'Anfitrião', faz: 'te situa e aponta o caminho' },
  'estudio-de-design': { emoji: '🎨', nome: 'Estúdio de Design', faz: 'desenha telas, fluxos, copy e análise heurística' },
  'codigo-ao-figma': { emoji: '🧬', nome: 'Do Código ao Figma', faz: 'replica o componente do código no Figma, 1:1' },
  'figma-ao-codigo': { emoji: '⚙️', nome: 'Do Figma ao Código', faz: 'transforma a tela do Figma em código de produção' },
  'codigo-ao-video': { emoji: '🎬', nome: 'Do Código ao Vídeo', faz: 'grava o fluxo do app em vídeo com narração' },
  'regras-de-negocio': { emoji: '📐', nome: 'Regras de Negócio', faz: 'descobre as regras reais no código, com arquivo:linha' },
  'mapa-do-design-system': { emoji: '🗺️', nome: 'Mapa do Design System', faz: 'mantém fresco o mapa de reuso do DS' },
  'documentacao-do-ds': { emoji: '📚', nome: 'Documentação do DS', faz: 'documenta componente no padrão dos grandes DS' },
  'construtor-do-storybook': { emoji: '🧱', nome: 'Construtor do Storybook', faz: 'constrói e mantém o Storybook do DS' },
  'leitor-de-comentarios': { emoji: '💬', nome: 'Leitor de Comentários', faz: 'lê os comentários do Figma e prioriza' },
  'agenda-da-sprint': { emoji: '📅', nome: 'Agenda da Sprint', faz: 'da Planning para os blocos de foco no calendário' },
  'relatorio-de-atividades': { emoji: '📊', nome: 'Relatório de Atividades', faz: 'consolida o que foi feito na semana' },
  'publicador-seguro': { emoji: '🔐', nome: 'Publicador Seguro', faz: 'publica material online protegido por senha' },
}

const HUB = { emoji: '🐝', nome: 'Hub' }
const quem = (slug) => ELENCO[slug] || { emoji: '🤖', nome: slug, faz: '' }

// O que a tela de entrada anuncia. Curto de propósito: é vitrine, não catálogo.
const VITRINE = [
  'estudio-de-design',
  'regras-de-negocio',
  'documentacao-do-ds',
  'codigo-ao-video',
  'agenda-da-sprint',
]

// ── Como cada ferramenta aparece ────────────────────────────────────────

const FERRAMENTAS = {
  Read: { icone: '📖', nome: 'Leu', campo: 'file_path' },
  Write: { icone: '✏️', nome: 'Escreveu', campo: 'file_path' },
  Edit: { icone: '✏️', nome: 'Editou', campo: 'file_path' },
  NotebookEdit: { icone: '✏️', nome: 'Editou notebook', campo: 'notebook_path' },
  Grep: { icone: '🔎', nome: 'Buscou', campo: 'pattern' },
  Glob: { icone: '🗂', nome: 'Listou', campo: 'pattern' },
  Bash: { icone: '⌨️', nome: 'Rodou', campo: 'command' },
  WebFetch: { icone: '🌐', nome: 'Abriu', campo: 'url' },
  WebSearch: { icone: '🌐', nome: 'Pesquisou', campo: 'query' },
  TodoWrite: { icone: '✅', nome: 'Organizou o plano', campo: null },
  Skill: { icone: '🧩', nome: 'Usou a skill', campo: 'command' },
}

function descreverFerramenta(nome, entrada) {
  if (nome.startsWith('mcp__')) {
    const p = nome.split('__')
    return { icone: '🔌', nome: p[1] || 'Conector', alvo: p.slice(2).join(' · ') }
  }
  const def = FERRAMENTAS[nome] || { icone: '🛠', nome, campo: null }
  let alvo = def.campo && entrada?.[def.campo] != null ? String(entrada[def.campo]) : ''
  alvo = alvo.replace(/\s+/g, ' ').trim()
  if (alvo.length > 110) alvo = alvo.slice(0, 109) + '…'
  return { icone: def.icone, nome: def.nome, alvo }
}

// Como o Hub se comporta antes de mexer em alguma coisa. É a mesma ideia dos
// modos do Claude Code, com o nome em português e a consequência explicada.
const MODOS = [
  {
    id: 'default',
    nome: 'Manual',
    diz: 'Pergunta antes de escrever arquivo ou rodar comando.',
    tom: 'seguro',
  },
  {
    id: 'plan',
    nome: 'Plano',
    diz: 'Descreve o que faria e espera você aprovar. Não executa nada.',
    tom: 'plano',
  },
  {
    id: 'acceptEdits',
    nome: 'Aceita edições',
    diz: 'Escreve arquivos sem perguntar. Comandos continuam pedindo autorização.',
    tom: 'solto',
  },
]
const modoAtual = () => MODOS.find((m) => m.id === (estado.atual?.modo || 'default')) || MODOS[0]

const EXPLICACAO_PERMISSAO = {
  Write: 'quer criar ou sobrescrever um arquivo',
  Edit: 'quer alterar um arquivo',
  NotebookEdit: 'quer alterar um notebook',
  Bash: 'quer rodar um comando no seu computador',
  WebFetch: 'quer abrir um endereço na internet',
  WebSearch: 'quer pesquisar na internet',
}

// ── Estado ──────────────────────────────────────────────────────────────

const estado = {
  hubOk: false,
  caminhoHub: null,
  agentesNoDisco: [], // [{slug, descricao}] lidos do Hub
  prontidao: null, // { conectores[], porAgente{}, prontos, bloqueados }
  modelos: [],
  conversas: [],
  atual: null, // objeto conversa
  fio: [], // itens do fio da conversa atual
  nos: [], // nós DOM, paralelos a `fio`
  ocupada: false,
  anexos: [], // caminhos anexados à próxima mensagem
  ditando: false,
  correndo: null, // item de texto do Hub sendo escrito agora
  buffer: '',
  agendado: false,
}

const $ = (id) => document.getElementById(id)
const criar = (tag, classe, texto) => {
  const el = document.createElement(tag)
  if (classe) el.className = classe
  if (texto != null) el.textContent = texto
  return el
}

const elFio = $('fio')
const elRolagem = $('rolagem')
const elEntrada = $('entrada')

function decorrido(desde) {
  const s = Math.max(0, Math.round((Date.now() - desde) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`
}

// Um relógio só para a página inteira, em vez de um por bloco de agente.
setInterval(() => {
  for (const selo of document.querySelectorAll('.agente__estado[data-desde]')) {
    selo.textContent = `trabalhando · ${decorrido(Number(selo.dataset.desde))}`
  }
}, 1000)

// ── Rolagem ─────────────────────────────────────────────────────────────

const coladoNoFim = () =>
  elRolagem.scrollHeight - elRolagem.scrollTop - elRolagem.clientHeight < 140

function irAoFim(forcar = false) {
  if (forcar || coladoNoFim()) {
    requestAnimationFrame(() => {
      elRolagem.scrollTop = elRolagem.scrollHeight
    })
  }
}

// ── Desenho de um item do fio ───────────────────────────────────────────

function desenharAtividade(a) {
  const d = descreverFerramenta(a.nome, a.entrada)
  const cartao = criar('div', 'atividade')
  cartao.dataset.estado = a.estado || 'rodando'

  const linha = criar('button', 'atividade__linha')
  linha.type = 'button'
  linha.appendChild(criar('span', 'atividade__icone', d.icone))
  linha.appendChild(criar('span', 'atividade__nome', d.nome))
  linha.appendChild(criar('span', 'atividade__alvo', d.alvo))
  const selo = criar('span', 'atividade__selo')
  selo.textContent = a.estado === 'ok' ? 'ok' : a.estado === 'erro' ? 'falhou' : '···'
  linha.appendChild(selo)
  cartao.appendChild(linha)

  const detalhe = criar('pre', 'atividade__detalhe', JSON.stringify(a.entrada, null, 2))
  cartao.appendChild(detalhe)
  linha.addEventListener('click', () => {
    cartao.dataset.aberto = cartao.dataset.aberto === 'sim' ? 'nao' : 'sim'
  })
  return cartao
}

function desenharItem(item, indice) {
  // ── A pessoa
  if (item.tipo === 'pessoa') {
    const bloco = criar('div', 'msg msg--pessoa')
    const balao = criar('div', 'msg__balao', item.texto)
    if (item.anexos?.length) {
      const linha = criar('div', 'msg__anexos')
      for (const a of item.anexos) {
        const f = criar('span', 'anexo anexo--lido', a.split('/').pop())
        f.title = a
        linha.appendChild(f)
      }
      balao.appendChild(linha)
    }
    bloco.appendChild(balao)
    return bloco
  }

  // ── O Hub
  if (item.tipo === 'hub') {
    const bloco = criar('div', 'msg msg--fala')
    const cabeca = criar('div', 'msg__quem')
    cabeca.appendChild(criar('span', 'msg__avatar', HUB.emoji))
    cabeca.appendChild(criar('span', 'msg__rotulo', HUB.nome))
    bloco.appendChild(cabeca)
    const corpo = criar('div', 'corrido')
    if (item.escrevendo) corpo.classList.add('digitando')
    corpo.innerHTML = marcacao(item.texto || '')
    bloco.appendChild(corpo)
    return bloco
  }

  // ── Um agente que entrou na conversa
  if (item.tipo === 'agente') {
    const q = quem(item.slug)
    const bloco = criar('div', 'agente')
    bloco.dataset.estado = item.estado || 'rodando'

    const cabeca = criar('div', 'agente__cabeca')
    cabeca.appendChild(criar('span', 'agente__avatar', q.emoji))
    const nomes = criar('div', 'agente__nomes')
    nomes.appendChild(criar('span', 'agente__nome', q.nome))
    if (item.descricao) nomes.appendChild(criar('span', 'agente__tarefa', item.descricao))
    cabeca.appendChild(nomes)

    const estadoSelo = criar('span', 'agente__estado')
    if (item.estado === 'ok') estadoSelo.textContent = 'terminou'
    else if (item.estado === 'erro') estadoSelo.textContent = 'falhou'
    else {
      // Espera sem número é espera longa. O relógio corrente transforma tempo
      // morto em progresso visível, mesmo quando ainda não há texto.
      estadoSelo.textContent = 'trabalhando'
      if (item.entrouEm) {
        estadoSelo.dataset.desde = String(item.entrouEm)
        estadoSelo.textContent = `trabalhando · ${decorrido(item.entrouEm)}`
      }
    }
    cabeca.appendChild(estadoSelo)
    bloco.appendChild(cabeca)

    const corpo = criar('div', 'agente__corpo')
    for (const a of item.atividades || []) corpo.appendChild(desenharAtividade(a))
    const dito = (item.texto || '') + (item.parcial || '')
    if (dito) {
      const fala = criar('div', 'corrido')
      if (item.parcial) fala.classList.add('digitando')
      fala.innerHTML = marcacao(dito)
      corpo.appendChild(fala)
    }
    bloco.appendChild(corpo)
    return bloco
  }

  // ── Ferramenta do próprio Hub (fora de agente)
  if (item.tipo === 'ferramenta') return desenharAtividade(item)

  // ── Pedido de autorização
  if (item.tipo === 'permissao') {
    const cartao = criar('div', 'permissao')
    if (item.decisao) cartao.dataset.resolvida = item.decisao
    cartao.appendChild(criar('p', 'permissao__titulo', 'Precisa da sua autorização'))
    cartao.appendChild(
      criar(
        'p',
        'permissao__texto',
        `${item.agente ? quem(item.agente).nome : 'O Hub'} ${
          EXPLICACAO_PERMISSAO[item.ferramenta] || `quer usar a ferramenta ${item.ferramenta}`
        }.`,
      ),
    )
    cartao.appendChild(criar('code', 'permissao__alvo', JSON.stringify(item.entrada, null, 2)))

    const acoes = criar('div', 'permissao__acoes')
    const sim = criar('button', 'btn btn--cheio', 'Permitir')
    const nao = criar('button', 'btn btn--vazio', 'Agora não')
    sim.type = nao.type = 'button'
    acoes.appendChild(sim)
    acoes.appendChild(nao)
    cartao.appendChild(acoes)

    const veredito = criar('p', 'permissao__veredito')
    veredito.textContent =
      item.decisao === 'permitida'
        ? '✓ Você permitiu.'
        : item.decisao === 'negada'
          ? '✕ Você não permitiu — seguiram sem isso.'
          : ''
    cartao.appendChild(veredito)

    const decidir = (aprovado) => {
      item.decisao = aprovado ? 'permitida' : 'negada'
      window.hub.responderPermissao(item.id, aprovado)
      atualizarItem(indice)
    }
    sim.addEventListener('click', () => decidir(true))
    nao.addEventListener('click', () => decidir(false))
    return cartao
  }

  // ── Aviso
  const aviso = criar('div', 'aviso' + (item.erro ? ' aviso--erro' : ''), item.texto)
  return aviso
}

function acrescentar(item) {
  const perto = coladoNoFim()
  estado.fio.push(item)
  const no = desenharItem(item, estado.fio.length - 1)
  estado.nos.push(no)
  elFio.appendChild(no)
  if (perto) irAoFim()
  return estado.fio.length - 1
}

function atualizarItem(indice) {
  const item = estado.fio[indice]
  const antigo = estado.nos[indice]
  if (!item || !antigo) return
  const perto = coladoNoFim()
  const novo = desenharItem(item, indice)
  antigo.replaceWith(novo)
  estado.nos[indice] = novo
  if (perto) irAoFim()
}

function redesenharFio() {
  elFio.innerHTML = ''
  estado.nos = estado.fio.map((item, i) => {
    const no = desenharItem(item, i)
    elFio.appendChild(no)
    return no
  })
}

// Guardar o fio sem o que é só de tela.
function gravarFio() {
  if (!estado.atual) return
  const limpo = estado.fio.map((i) => ({ ...i, escrevendo: false }))
  window.hub.gravarFio(estado.atual.id, limpo)
}

// ── Barra lateral ───────────────────────────────────────────────────────

function desenharLado(filtro = '') {
  const lista = $('listaConversas')
  lista.innerHTML = ''
  const alvo = filtro.trim().toLowerCase()
  const visiveis = estado.conversas.filter((c) => !alvo || c.nome.toLowerCase().includes(alvo))

  if (!visiveis.length) {
    lista.appendChild(
      criar('p', 'lado__vazio', alvo ? 'Nada com esse nome.' : 'Nenhuma conversa ainda.'),
    )
    return
  }

  lista.appendChild(criar('div', 'grupo', 'Conversas'))
  for (const c of visiveis) {
    const b = criar('button', 'conversa-item')
    b.type = 'button'
    b.setAttribute('aria-current', String(estado.atual?.id === c.id))
    b.appendChild(criar('span', 'conversa-item__cerquilha', '#'))
    b.appendChild(criar('span', 'conversa-item__nome', c.nome))
    if (estado.ocupada && estado.atual?.id === c.id) {
      b.appendChild(criar('span', 'conversa-item__ponto'))
    }
    b.addEventListener('click', () => abrirConversa(c.id))
    lista.appendChild(b)
  }
}

// ── Membros ─────────────────────────────────────────────────────────────

function membrosDaAtual() {
  const todos = estado.agentesNoDisco.map((a) => a.slug)
  return estado.atual?.membros || todos
}

// ── Prontidão ───────────────────────────────────────────────────────────
// A regra que vale aqui: nunca deixar o app parecer capaz de algo que ele não
// consegue fazer nesta máquina. É mais barato avisar antes do que falhar no
// meio da conversa.

function estadoDoAgente(slug) {
  return estado.prontidao?.porAgente?.[slug] || { estado: 'pronto', faltando: [] }
}

function motivoDoBloqueio(slug) {
  const { faltando } = estadoDoAgente(slug)
  const nomes = faltando.map((f) => f.nome)
  if (!nomes.length) return ''
  const lista = nomes.length === 1 ? nomes[0] : nomes.slice(0, -1).join(', ') + ' e ' + nomes.at(-1)
  return `precisa de ${lista}`
}

function desenharProntidao() {
  const caixa = $('prontidao')
  if (!estado.prontidao) return void (caixa.hidden = true)
  caixa.hidden = false

  const chips = $('prontidaoChips')
  chips.innerHTML = ''
  for (const c of estado.prontidao.conectores) {
    const chip = criar('span', 'chip')
    chip.dataset.ligado = c.ligado ? 'sim' : 'nao'
    chip.appendChild(criar('span', 'chip__ponto'))
    chip.appendChild(criar('span', null, c.nome))
    chip.title = c.ligado
      ? `${c.nome} está disponível aqui.`
      : `${c.nome} não está disponível neste app — os agentes que dependem dele ficam indisponíveis.`
    chips.appendChild(chip)
  }

  const total = estado.agentesNoDisco.length
  const { prontos, bloqueados } = estado.prontidao
  $('prontidaoResumo').textContent = bloqueados
    ? `${prontos} de ${total} agentes prontos para trabalhar agora · ${bloqueados} esperando conector`
    : `Os ${total} agentes estão prontos para trabalhar.`
}

async function carregarProntidao(revalidar = false) {
  const r = await window.hub.prontidao(revalidar)
  if (!r.ok) return
  estado.prontidao = r
  desenharProntidao()
  desenharVitrine() // a vitrine depende de quem está pronto
  desenharMembros()
}

function desenharMembros() {
  const todos = estado.agentesNoDisco.map((a) => a.slug)
  const atuais = membrosDaAtual()
  // Com todos liberados, uma pilha de 5 emojis escolhidos por ordem alfabética
  // sugeriria que SÓ aqueles participam. Nesse caso o texto basta.
  const pilha = $('membrosPilha')
  pilha.innerHTML = ''
  const restrito = atuais.length < todos.length
  if (restrito) {
    for (const slug of atuais.slice(0, 6)) {
      pilha.appendChild(criar('span', 'membros__ficha', quem(slug).emoji))
    }
  }
  $('membrosTexto').textContent = restrito
    ? `${atuais.length} de ${todos.length} agentes`
    : `todos os ${todos.length} agentes podem entrar`
  $('membrosTexto').style.marginLeft = restrito ? '' : '0'

  const painel = $('painelLista')
  painel.innerHTML = ''
  for (const a of estado.agentesNoDisco) {
    const q = quem(a.slug)
    const linha = criar('label', 'membro')
    const caixa = document.createElement('input')
    caixa.type = 'checkbox'
    caixa.checked = atuais.includes(a.slug)
    caixa.addEventListener('change', async () => {
      const marcados = [...painel.querySelectorAll('input:checked')].map(
        (i) => i.closest('.membro').dataset.slug,
      )
      const novos = marcados.length >= todos.length ? null : marcados
      await window.hub.atualizar(estado.atual.id, { membros: novos })
      estado.atual.membros = novos
      desenharMembros()
    })
    linha.dataset.slug = a.slug
    const pront = estadoDoAgente(a.slug)
    linha.dataset.pronto = pront.estado
    linha.appendChild(caixa)
    linha.appendChild(criar('span', 'membro__emoji', q.emoji))
    const txt = criar('span', 'membro__texto')
    const nome = criar('span', 'membro__nome')
    nome.appendChild(document.createTextNode(q.nome))
    if (pront.estado !== 'pronto') {
      const selo = criar('span', 'selo', pront.estado === 'bloqueado' ? 'indisponível' : 'limitado')
      selo.dataset.tom = pront.estado
      nome.appendChild(selo)
    }
    txt.appendChild(nome)
    txt.appendChild(
      criar(
        'span',
        'membro__faz',
        pront.estado === 'bloqueado' ? motivoDoBloqueio(a.slug) : q.faz || a.descricao || '',
      ),
    )
    linha.appendChild(txt)
    painel.appendChild(linha)
  }
}

// ── Abrir / criar conversa ──────────────────────────────────────────────

async function recarregarLista() {
  const r = await window.hub.listar()
  estado.conversas = r.conversas || []
  if (r.modelos?.length) estado.modelos = r.modelos
  desenharLado($('busca').value)
}

async function abrirConversa(id) {
  const r = await window.hub.abrir(id)
  if (!r.ok) return
  estado.atual = r.conversa
  estado.fio = r.fio || []
  estado.correndo = null
  estado.ocupada = false

  $('telaEntrada').hidden = true
  $('telaConversa').hidden = false
  document.querySelector('.seletor').hidden = false
  $('conversaNomeTexto').textContent = r.conversa.nome
  $('custo').hidden = !(r.conversa.custo > 0)
  if (r.conversa.custo > 0) $('custo').textContent = `≈ US$ ${r.conversa.custo.toFixed(2)}`

  estado.anexos = []
  desenharAnexos()
  desenharModo()
  desenharContexto(r.conversa.contexto)
  fecharMenus()
  desenharMembros()
  desenharSeletorModelo()
  redesenharFio()
  desenharLado($('busca').value)
  atualizarBotoes()
  irAoFim(true)
  elEntrada.focus()
}

async function criarConversa() {
  const r = await window.hub.criar({})
  if (!r.ok) return
  await recarregarLista()
  await abrirConversa(r.conversa.id)
}

function mostrarEntrada() {
  estado.atual = null
  $('telaConversa').hidden = true
  $('telaEntrada').hidden = false
  document.querySelector('.seletor').hidden = true
  desenharLado($('busca').value)
}

// ── Modelo ──────────────────────────────────────────────────────────────

function desenharSeletorModelo() {
  const sel = $('modelo')
  sel.innerHTML = ''
  for (const m of estado.modelos) {
    const op = document.createElement('option')
    op.value = m.value || ''
    op.textContent = m.displayName || m.value
    sel.appendChild(op)
  }
  sel.value = estado.atual?.modelo || ''
}

// ── Envio ───────────────────────────────────────────────────────────────

function ajustarAltura() {
  elEntrada.style.height = 'auto'
  elEntrada.style.height = Math.min(elEntrada.scrollHeight, 200) + 'px'
}

function atualizarBotoes() {
  $('btnEnviar').hidden = estado.ocupada
  $('btnParar').hidden = !estado.ocupada
  $('btnEnviar').disabled = !elEntrada.value.trim() || !estado.hubOk
}

function nota(texto, tom) {
  const el = $('nota')
  el.textContent = texto
  if (tom) el.dataset.tom = tom
  else delete el.dataset.tom
}

async function enviar() {
  const texto = elEntrada.value.trim()
  if (!texto || estado.ocupada || !estado.atual) return
  if (!estado.hubOk) {
    nota('Escolha primeiro a pasta do Hub, no ícone de pasta lá em cima.', 'erro')
    return
  }

  // A primeira mensagem batiza a conversa.
  if (estado.atual.nomeAutomatico && !estado.fio.length) {
    const nome = apelidar(texto)
    await window.hub.atualizar(estado.atual.id, { nome, nomeAutomatico: false })
    estado.atual.nome = nome
    estado.atual.nomeAutomatico = false
    $('conversaNomeTexto').textContent = nome
    await recarregarLista()
  }

  acrescentar({ tipo: 'pessoa', texto, anexos: [...estado.anexos] })

  // Se você chamou alguém que não consegue trabalhar aqui, é melhor saber agora
  // do que depois de esperar o turno inteiro para ver a falha.
  const chamados = [...texto.matchAll(/@([a-z-]+)/gi)].map((m) => m[1])
  const impedidos = chamados.filter((s) => estadoDoAgente(s).estado === 'bloqueado')
  for (const slug of impedidos) {
    acrescentar({
      tipo: 'aviso',
      texto: `${quem(slug).nome} ${motivoDoBloqueio(slug)}, e isso não está disponível neste app. Ele vai tentar, mas provavelmente não consegue concluir.`,
    })
  }

  elEntrada.value = ''
  ajustarAltura()
  esconderMencoes()
  estado.ocupada = true
  atualizarBotoes()
  desenharLado($('busca').value)
  nota('')
  irAoFim(true)

  const anexos = [...estado.anexos]
  estado.anexos = []
  desenharAnexos()
  await window.hub.enviar(estado.atual.id, texto, anexos)
}

function apelidar(texto) {
  const limpo = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 4)
    .join('-')
  return limpo || 'conversa'
}

// ── Menções com @ ───────────────────────────────────────────────────────

let mencaoAtiva = -1

function esconderMencoes() {
  $('mencoes').hidden = true
  mencaoAtiva = -1
}

function mostrarMencoes() {
  const valor = elEntrada.value
  const cursor = elEntrada.selectionStart
  const antes = valor.slice(0, cursor)
  const m = antes.match(/@([a-z-]*)$/i)
  if (!m) return esconderMencoes()

  const termo = m[1].toLowerCase()
  const candidatos = estado.agentesNoDisco
    .filter((a) => membrosDaAtual().includes(a.slug))
    .filter((a) => a.slug.includes(termo) || quem(a.slug).nome.toLowerCase().includes(termo))
    .slice(0, 6)

  if (!candidatos.length) return esconderMencoes()

  const caixa = $('mencoes')
  caixa.innerHTML = ''
  candidatos.forEach((a, i) => {
    const q = quem(a.slug)
    const b = criar('button', 'mencao')
    b.type = 'button'
    b.dataset.slug = a.slug
    if (i === 0) b.dataset.ativa = 'sim'
    b.appendChild(criar('span', 'mencao__emoji', q.emoji))
    b.appendChild(criar('span', 'mencao__nome', q.nome))
    const pront = estadoDoAgente(a.slug)
    if (pront.estado === 'bloqueado') {
      b.dataset.bloqueado = 'sim'
      b.appendChild(criar('span', 'mencao__aviso', motivoDoBloqueio(a.slug)))
    }
    b.appendChild(criar('span', 'mencao__slug', '@' + a.slug))
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      escolherMencao(a.slug)
    })
    caixa.appendChild(b)
  })
  caixa.hidden = false
  mencaoAtiva = 0
}

function escolherMencao(slug) {
  const valor = elEntrada.value
  const cursor = elEntrada.selectionStart
  const antes = valor.slice(0, cursor).replace(/@([a-z-]*)$/i, '@' + slug + ' ')
  elEntrada.value = antes + valor.slice(cursor)
  elEntrada.selectionStart = elEntrada.selectionEnd = antes.length
  esconderMencoes()
  ajustarAltura()
  atualizarBotoes()
  elEntrada.focus()
}

function navegarMencoes(passo) {
  const itens = [...$('mencoes').querySelectorAll('.mencao')]
  if (!itens.length) return
  itens[mencaoAtiva]?.removeAttribute('data-ativa')
  mencaoAtiva = (mencaoAtiva + passo + itens.length) % itens.length
  itens[mencaoAtiva].dataset.ativa = 'sim'
  itens[mencaoAtiva].scrollIntoView({ block: 'nearest' })
}

// ── Eventos vindos do agente ────────────────────────────────────────────

function acharAgente(tarefaId) {
  for (let i = estado.fio.length - 1; i >= 0; i--) {
    if (estado.fio[i].tipo === 'agente' && estado.fio[i].tarefaId === tarefaId) return i
  }
  return -1
}

function escoarTexto() {
  estado.agendado = false
  if (!estado.buffer || estado.correndo == null) return
  const item = estado.fio[estado.correndo]
  item.texto = (item.texto || '') + estado.buffer
  estado.buffer = ''
  atualizarItem(estado.correndo)
}

function fecharTextoCorrente() {
  if (estado.correndo == null) return
  escoarTexto()
  estado.fio[estado.correndo].escrevendo = false
  atualizarItem(estado.correndo)
  estado.correndo = null
}

window.hub.aoReceber((dados) => {
  // Evento de uma conversa que não está na tela: ignora o desenho.
  if (!estado.atual || dados.conversa !== estado.atual.id) return
  const { evento } = dados

  switch (evento) {
    case 'pronto':
      nota(
        dados.autenticacao === 'none'
          ? `${dados.modelo} · conectado pela sua conta do Claude`
          : `${dados.modelo} · ${dados.autenticacao}`,
      )
      break

    case 'modelos':
      estado.modelos = dados.modelos
      desenharSeletorModelo()
      break

    case 'texto': {
      if (estado.correndo == null) {
        estado.correndo = acrescentar({ tipo: 'hub', texto: '', escrevendo: true })
      }
      estado.buffer += dados.pedaco
      if (!estado.agendado) {
        estado.agendado = true
        requestAnimationFrame(escoarTexto)
      }
      break
    }

    case 'agente-entrou':
      fecharTextoCorrente()
      acrescentar({
        tipo: 'agente',
        tarefaId: dados.tarefaId,
        slug: dados.agente,
        descricao: dados.descricao,
        entrouEm: dados.entrouEm || Date.now(),
        texto: '',
        parcial: '',
        atividades: [],
        estado: 'rodando',
      })
      break

    // O agente escrevendo em tempo real. Vai para `parcial`, separado do texto
    // definitivo — quando a mensagem fecha, o parcial é descartado e o texto
    // completo entra no lugar, sem duplicar.
    case 'agente-digitando': {
      const i = acharAgente(dados.tarefaId)
      if (i < 0) break
      const item = estado.fio[i]
      item.parcial = (item.parcial || '') + dados.pedaco
      if (!item.agendado) {
        item.agendado = true
        requestAnimationFrame(() => {
          item.agendado = false
          const j = acharAgente(dados.tarefaId)
          if (j >= 0) atualizarItem(j)
        })
      }
      break
    }

    case 'agente-falou': {
      const i = acharAgente(dados.tarefaId)
      if (i < 0) break
      const item = estado.fio[i]
      item.texto = (item.texto ? item.texto + '\n\n' : '') + dados.texto
      item.parcial = ''
      atualizarItem(i)
      break
    }

    case 'agente-saiu': {
      const i = acharAgente(dados.tarefaId)
      if (i < 0) break
      const item = estado.fio[i]
      item.estado = dados.erro ? 'erro' : 'ok'
      // O que sobrou de parcial sem mensagem fechada ainda é fala válida.
      if (item.parcial) {
        item.texto = (item.texto ? item.texto + '\n\n' : '') + item.parcial
        item.parcial = ''
      }
      atualizarItem(i)
      break
    }

    case 'ferramenta': {
      const nova = {
        id: dados.ferramentaId,
        nome: dados.nome,
        entrada: dados.entrada,
        estado: 'rodando',
      }
      const i = dados.tarefaId != null ? acharAgente(dados.tarefaId) : -1
      if (i >= 0) {
        estado.fio[i].atividades.push(nova)
        atualizarItem(i)
      } else {
        fecharTextoCorrente()
        acrescentar({ tipo: 'ferramenta', ...nova })
      }
      break
    }

    case 'ferramenta-fim': {
      for (let i = estado.fio.length - 1; i >= 0; i--) {
        const it = estado.fio[i]
        if (it.tipo === 'ferramenta' && it.id === dados.ferramentaId) {
          it.estado = dados.erro ? 'erro' : 'ok'
          atualizarItem(i)
          return
        }
        if (it.tipo === 'agente') {
          const a = (it.atividades || []).find((x) => x.id === dados.ferramentaId)
          if (a) {
            a.estado = dados.erro ? 'erro' : 'ok'
            atualizarItem(i)
            return
          }
        }
      }
      break
    }

    case 'permissao':
      fecharTextoCorrente()
      acrescentar({
        tipo: 'permissao',
        id: dados.id,
        ferramenta: dados.ferramenta,
        entrada: dados.entrada,
        agente: dados.agente || null,
        decisao: null,
      })
      irAoFim(true)
      break

    case 'fim': {
      fecharTextoCorrente()
      estado.ocupada = false
      if (dados.interrompido) {
        acrescentar({ tipo: 'aviso', texto: 'Você interrompeu. Pode mandar outra coisa.' })
      } else if (dados.erro) {
        acrescentar({ tipo: 'aviso', texto: `Deu problema: ${dados.resultado}`, erro: true })
      }
      if (dados.contexto) {
        estado.atual.contexto = dados.contexto
        desenharContexto(dados.contexto)
      }
      if (dados.custoTotal > 0) {
        estado.atual.custo = dados.custoTotal
        $('custo').hidden = false
        $('custo').textContent = `≈ US$ ${dados.custoTotal.toFixed(2)}`
      }
      atualizarBotoes()
      desenharLado($('busca').value)
      gravarFio()
      break
    }
  }
})


// ── Barra do composer: modo, comandos, anexos, ditado, contexto ─────────

function desenharModo() {
  const m = modoAtual()
  $('modoNome').textContent = m.nome
  $('modoPonto').dataset.tom = m.tom
  $('btnModo').title = m.diz
}

function abrirMenuModo() {
  const menu = $('menuModo')
  if (!menu.hidden) return void (menu.hidden = true)
  fecharMenus()
  menu.innerHTML = ''
  for (const m of MODOS) {
    const b = criar('button', 'menu__item')
    b.type = 'button'
    if (m.id === modoAtual().id) b.dataset.ativo = 'sim'
    const ponto = criar('span', 'pilula__ponto')
    ponto.dataset.tom = m.tom
    b.appendChild(ponto)
    const txt = criar('span', 'menu__texto')
    txt.appendChild(criar('span', 'menu__nome', m.nome))
    txt.appendChild(criar('span', 'menu__diz', m.diz))
    b.appendChild(txt)
    b.addEventListener('click', async () => {
      await window.hub.atualizar(estado.atual.id, { modo: m.id })
      estado.atual.modo = m.id
      desenharModo()
      menu.hidden = true
      nota(`Modo ${m.nome}: ${m.diz}`)
    })
    menu.appendChild(b)
  }
  menu.hidden = false
}

const COMANDOS = [
  { rotulo: 'Anexar arquivo', dica: 'manda o conteúdo junto com a mensagem', fazer: anexarArquivo },
  { rotulo: 'Quem pode entrar', dica: 'escolhe os agentes desta conversa', fazer: () => $('btnMembros').click() },
  { rotulo: 'Nova conversa', dica: 'começa outro assunto', fazer: criarConversa },
  { rotulo: 'Recomeçar esta', dica: 'apaga o histórico e a memória daqui', fazer: () => $('btnReiniciar').click() },
  { rotulo: 'Trocar de modelo', dica: 'vale da próxima mensagem em diante', fazer: () => $('modelo').focus() },
  { rotulo: 'Conferir conexões', dica: 'revalida o que está ligado nesta máquina', fazer: async () => {
      nota('Conferindo…'); await carregarProntidao(true)
      const p = estado.prontidao
      nota(p ? `${p.prontos} agentes prontos · ${p.bloqueados} esperando conector` : 'não deu para conferir')
    } },
  { rotulo: 'Abrir a pasta do Hub', dica: 'no Finder', fazer: () => window.hub.abrirPasta() },
]

function abrirMenuComandos() {
  const menu = $('menuComandos')
  if (!menu.hidden) return void (menu.hidden = true)
  fecharMenus()
  menu.innerHTML = ''
  for (const c of COMANDOS) {
    const b = criar('button', 'menu__item')
    b.type = 'button'
    const txt = criar('span', 'menu__texto')
    txt.appendChild(criar('span', 'menu__nome', c.rotulo))
    txt.appendChild(criar('span', 'menu__diz', c.dica))
    b.appendChild(txt)
    b.addEventListener('click', () => {
      menu.hidden = true
      c.fazer()
    })
    menu.appendChild(b)
  }
  menu.hidden = false
}

function fecharMenus() {
  $('menuModo').hidden = true
  $('menuComandos').hidden = true
}

// ── Anexos ──────────────────────────────────────────────────────────────

function desenharAnexos() {
  const caixa = $('anexos')
  caixa.innerHTML = ''
  caixa.hidden = !estado.anexos.length
  for (const caminho of estado.anexos) {
    const ficha = criar('span', 'anexo')
    ficha.appendChild(criar('span', 'anexo__nome', caminho.split('/').pop()))
    const x = criar('button', 'anexo__x', '×')
    x.type = 'button'
    x.title = caminho
    x.addEventListener('click', () => {
      estado.anexos = estado.anexos.filter((c) => c !== caminho)
      desenharAnexos()
    })
    ficha.appendChild(x)
    ficha.title = caminho
    caixa.appendChild(ficha)
  }
}

async function anexarArquivo() {
  const r = await window.hub.anexar()
  if (!r.ok) return
  for (const c of r.caminhos) if (!estado.anexos.includes(c)) estado.anexos.push(c)
  desenharAnexos()
  elEntrada.focus()
}

// ── Ditado ──────────────────────────────────────────────────────────────
// O reconhecimento do Chromium manda o áudio para um serviço externo. Como
// aqui se fala de trabalho da empresa, avisamos na primeira vez.

let ouvinte = null

function ditar() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return nota('Este Mac não tem ditado no app. Use o ditado do macOS (Control duas vezes).', 'erro')

  if (estado.ditando) {
    try { ouvinte?.stop() } catch {}
    return
  }

  if (!localStorage.getItem('avisoDitado')) {
    localStorage.setItem('avisoDitado', '1')
    nota('O ditado usa o reconhecimento de fala do sistema — sua voz sai da máquina. Evite dizer dado sensível.')
  }

  ouvinte = new SR()
  ouvinte.lang = 'pt-BR'
  ouvinte.continuous = true
  ouvinte.interimResults = true

  const base = elEntrada.value
  let fechado = ''

  ouvinte.onstart = () => {
    estado.ditando = true
    $('btnMic').setAttribute('aria-pressed', 'true')
  }
  ouvinte.onresult = (e) => {
    let parcial = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) fechado += t
      else parcial += t
    }
    elEntrada.value = (base ? base + ' ' : '') + fechado + parcial
    ajustarAltura()
    atualizarBotoes()
  }
  ouvinte.onerror = (e) => {
    const porque = {
      'not-allowed': 'o microfone não foi autorizado',
      'service-not-allowed': 'o serviço de reconhecimento não está disponível aqui',
      network: 'não deu para alcançar o serviço de reconhecimento',
      'no-speech': 'não ouvi nada',
    }[e.error] || e.error
    nota(`Ditado parou: ${porque}.`, e.error === 'no-speech' ? undefined : 'erro')
  }
  ouvinte.onend = () => {
    estado.ditando = false
    $('btnMic').setAttribute('aria-pressed', 'false')
    elEntrada.focus()
  }

  try { ouvinte.start() } catch { nota('Não consegui abrir o microfone.', 'erro') }
}

// ── Indicador de contexto ───────────────────────────────────────────────

function desenharContexto(ctx) {
  const el = $('contexto')
  if (!ctx?.usados || !ctx.teto) return void (el.hidden = true)
  const pct = Math.min(100, Math.round((ctx.usados / ctx.teto) * 100))
  el.hidden = false
  el.textContent = `contexto ${pct}%`
  el.dataset.nivel = pct >= 80 ? 'alto' : pct >= 50 ? 'medio' : 'baixo'
  el.title =
    `${ctx.usados.toLocaleString('pt-BR')} de ${ctx.teto.toLocaleString('pt-BR')} tokens.` +
    (pct >= 80 ? ' Perto do limite — vale começar outra conversa.' : '')
}

// ── Ligações da interface ───────────────────────────────────────────────

elEntrada.addEventListener('input', () => {
  ajustarAltura()
  atualizarBotoes()
  mostrarMencoes()
})

elEntrada.addEventListener('keydown', (e) => {
  const listaAberta = !$('mencoes').hidden
  if (listaAberta) {
    if (e.key === 'ArrowDown') return e.preventDefault(), navegarMencoes(1)
    if (e.key === 'ArrowUp') return e.preventDefault(), navegarMencoes(-1)
    if (e.key === 'Escape') return esconderMencoes()
    if (e.key === 'Enter' || e.key === 'Tab') {
      const ativa = $('mencoes').querySelector('[data-ativa="sim"]')
      if (ativa) {
        e.preventDefault()
        return escolherMencao(ativa.dataset.slug)
      }
    }
  }
  if (e.key === 'Escape') {
    fecharMenus()
    if (estado.ditando) try { ouvinte?.stop() } catch {}
  }
  // "/" numa linha vazia é atalho para os comandos — como no Claude Code.
  if (e.key === '/' && !elEntrada.value.trim()) {
    e.preventDefault()
    abrirMenuComandos()
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    enviar()
  }
})

elEntrada.addEventListener('blur', () => setTimeout(esconderMencoes, 120))

$('btnEnviar').addEventListener('click', enviar)
$('btnAnexar').addEventListener('click', anexarArquivo)
$('btnComandos').addEventListener('click', abrirMenuComandos)
$('btnModo').addEventListener('click', abrirMenuModo)
$('btnMic').addEventListener('click', ditar)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('#btnModo') && !e.target.closest('#btnComandos')) {
    fecharMenus()
  }
})
$('btnParar').addEventListener('click', () => estado.atual && window.hub.parar(estado.atual.id))
$('btnNova').addEventListener('click', criarConversa)
$('btnComecar').addEventListener('click', criarConversa)
$('busca').addEventListener('input', (e) => desenharLado(e.target.value))

$('btnMembros').addEventListener('click', () => {
  const p = $('painelMembros')
  p.hidden = !p.hidden
  $('btnMembros').setAttribute('aria-expanded', String(!p.hidden))
})
$('btnFecharMembros').addEventListener('click', () => {
  $('painelMembros').hidden = true
  $('btnMembros').setAttribute('aria-expanded', 'false')
})
$('btnTodos').addEventListener('click', async () => {
  await window.hub.atualizar(estado.atual.id, { membros: null })
  estado.atual.membros = null
  desenharMembros()
})
$('btnVerElenco').addEventListener('click', async () => {
  await criarConversa()
  $('btnMembros').click()
})

$('modelo').addEventListener('change', async (e) => {
  if (!estado.atual) return
  const valor = e.target.value
  await window.hub.atualizar(estado.atual.id, { modelo: valor })
  estado.atual.modelo = valor
  nota(
    valor
      ? 'Modelo trocado — vale a partir da próxima mensagem.'
      : 'Voltou para o modelo do seu Claude Code.',
  )
})

$('btnReiniciar').addEventListener('click', async () => {
  if (!estado.atual) return
  await window.hub.reiniciar(estado.atual.id)
  estado.fio = []
  estado.atual.custo = 0
  $('custo').hidden = true
  redesenharFio()
  nota('Conversa recomeçada — os agentes não lembram mais do que veio antes.')
})

$('btnExcluir').addEventListener('click', async () => {
  if (!estado.atual) return
  await window.hub.excluir(estado.atual.id)
  await recarregarLista()
  if (estado.conversas.length) await abrirConversa(estado.conversas[0].id)
  else mostrarEntrada()
})

$('btnTema').addEventListener('click', () => {
  const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro'
  document.documentElement.dataset.tema = novo
  localStorage.setItem('tema', novo)
})

$('btnPasta').addEventListener('click', async () => {
  if (estado.hubOk) return void window.hub.abrirPasta()
  const r = await window.hub.escolher()
  if (r.ok) aplicarHub(r)
  else if (r.erro) nota(r.erro, 'erro')
})

$('estadoHub').addEventListener('click', async () => {
  const r = await window.hub.escolher()
  if (r.ok) aplicarHub(r)
})

// ── Partida ─────────────────────────────────────────────────────────────

// A vitrine só pode prometer o que o app entrega HOJE. Anunciar um agente
// bloqueado é convidar a pessoa para uma porta fechada — o erro mais caro
// que uma tela de boas-vindas pode cometer.
function desenharVitrine() {
  const ul = $('capacidades')
  ul.innerHTML = ''

  const candidatos = estado.agentesNoDisco.length
    ? [...VITRINE, ...estado.agentesNoDisco.map((a) => a.slug)]
    : VITRINE
  const vistos = new Set()
  const mostrar = []
  for (const slug of candidatos) {
    if (vistos.has(slug) || !quem(slug).faz) continue
    if (estadoDoAgente(slug).estado === 'bloqueado') continue
    vistos.add(slug)
    mostrar.push(slug)
    if (mostrar.length === 5) break
  }

  for (const slug of mostrar) {
    const q = quem(slug)
    const li = criar('li', 'capacidade')
    li.appendChild(criar('span', 'capacidade__emoji', q.emoji))
    li.appendChild(criar('span', 'capacidade__texto', q.faz))
    ul.appendChild(li)
  }
}

function aplicarHub(r) {
  estado.hubOk = true
  estado.caminhoHub = r.caminho
  estado.agentesNoDisco = r.elenco || []
  if (r.modelos?.length) estado.modelos = r.modelos
  const pasta = r.caminho.split('/').filter(Boolean).pop()
  $('estadoHub').textContent = `${estado.agentesNoDisco.length} agentes · ${pasta}`
  $('estadoHub').title = `${r.caminho}\n(clique para trocar de pasta)`
  $('entradaNota').textContent = ''
  $('acerto').hidden = true
  $('entradaMiolo').hidden = false
  desenharSeletorModelo()
  atualizarBotoes()
}

// ── Acerto de casa, em forma de conversa ────────────────────────────────
// Nada de tela de configuração: o Hub fala, oferece o que sabe fazer sozinho,
// e só pede ajuda quando realmente precisa.

function falarDoHub(texto, acoes = []) {
  const caixa = $('acerto')
  caixa.hidden = false
  $('entradaMiolo').hidden = true

  // Botões de uma fala anterior não decidem mais nada — desligar evita a
  // sensação de tela travada num "Procurando…" que já terminou.
  for (const b of caixa.querySelectorAll('.acerto__acoes .btn')) b.disabled = true

  const bloco = criar('div', 'acerto__bloco')
  const quemFala = criar('div', 'msg__quem')
  quemFala.appendChild(criar('span', 'msg__avatar', HUB.emoji))
  quemFala.appendChild(criar('span', 'msg__rotulo', HUB.nome))
  bloco.appendChild(quemFala)

  const corpo = criar('div', 'corrido')
  corpo.innerHTML = marcacao(texto)
  bloco.appendChild(corpo)

  if (acoes.length) {
    const linha = criar('div', 'acerto__acoes')
    acoes.forEach((a, i) => {
      const b = criar('button', 'btn ' + (i === 0 ? 'btn--cheio' : 'btn--vazio'), a.rotulo)
      b.type = 'button'
      b.addEventListener('click', () => a.fazer(b))
      linha.appendChild(b)
    })
    bloco.appendChild(linha)
  }

  caixa.appendChild(bloco)
  caixa.scrollTop = caixa.scrollHeight
  return bloco
}

async function acertarCasa() {
  falarDoHub(
    'Oi! Sou o **Hub**. Antes de a gente começar, preciso achar a pasta do Design Hub — é a que tem os agentes dentro.\n\nQuer que eu procure sozinho?',
    [
      {
        rotulo: 'Procurar sozinho',
        fazer: async (botao) => {
          botao.disabled = true
          botao.textContent = 'Procurando…'
          const r = await window.hub.procurar()
          if (r.ok) {
            falarDoHub(`Achei: \`${r.caminho}\`. Pronto, pode conversar.`)
            aplicarHub(r)
            await depoisDeAchar()
            return
          }
          if (r.achados?.length > 1) {
            falarDoHub(
              'Encontrei mais de uma. Qual é a sua?',
              r.achados.slice(0, 4).map((c) => ({
                rotulo: c.split('/').filter(Boolean).slice(-2).join('/'),
                fazer: async () => {
                  const u = await window.hub.usar(c)
                  if (u.ok) {
                    aplicarHub(u)
                    falarDoHub('Pronto. Pode conversar.')
                    await depoisDeAchar()
                  }
                },
              })),
            )
            return
          }
          falarDoHub(
            'Não achei em nenhum lugar comum. Posso **baixar o Hub** pra você agora — vai para a sua pasta Documentos.',
            [
              { rotulo: 'Baixar pra mim', fazer: baixarHub },
              { rotulo: 'Já tenho, vou mostrar', fazer: escolherPasta },
            ],
          )
        },
      },
      { rotulo: 'Eu mostro', fazer: escolherPasta },
    ],
  )
}

async function baixarHub(botao) {
  botao.disabled = true
  botao.textContent = 'Baixando…'
  const r = await window.hub.clonar()
  if (r.ok) {
    aplicarHub(r)
    falarDoHub(
      r.jaExistia
        ? `Achei uma cópia já baixada em \`${r.caminho}\`. Usando ela.`
        : `Pronto — baixei em \`${r.caminho}\`. Pode conversar.`,
    )
    return depoisDeAchar()
  }
  if (r.semAcesso) {
    return falarDoHub(
      `Consegui chegar no repositório, mas seu Mac não tem acesso a ele ainda. Peça acesso a \`${r.repo}\` e volte aqui — quando o acesso existir, eu baixo sozinho.`,
      [{ rotulo: 'Tentar de novo', fazer: baixarHub }],
    )
  }
  falarDoHub(`Não consegui baixar: ${r.erro}`, [
    { rotulo: 'Tentar de novo', fazer: baixarHub },
    { rotulo: 'Mostrar a pasta', fazer: escolherPasta },
  ])
}

async function escolherPasta() {
  const r = await window.hub.escolher()
  if (r.ok) {
    aplicarHub(r)
    falarDoHub('Pronto. Pode conversar.')
    await depoisDeAchar()
  } else if (r.erro) {
    falarDoHub(`Essa não serve: ${r.erro}`, [{ rotulo: 'Tentar outra', fazer: escolherPasta }])
  }
}

async function depoisDeAchar() {
  await recarregarLista()
  await carregarProntidao()
  setTimeout(() => {
    $('acerto').hidden = true
    $('entradaMiolo').hidden = false
  }, 900)
}

// ── Manter o Hub fresco, sem pedir nada ─────────────────────────────────

async function sincronizarEmSilencio() {
  const r = await window.hub.sincronizar()
  if (!r.ok || !r.atualizou) return
  const novos = (r.novos || []).map((s) => quem(s).nome)
  const recado = novos.length
    ? `Chegou coisa nova do time: **${novos.join(', ')}**. Já está disponível aqui.`
    : 'Puxei as novidades do time.'
  if (estado.atual) acrescentar({ tipo: 'aviso', texto: `🐝 ${recado}` })
  else nota(recado)
  // O elenco pode ter mudado — reler antes de desenhar qualquer coisa.
  const e = await window.hub.estado()
  if (e.ok) {
    estado.agentesNoDisco = e.elenco || []
    await carregarProntidao(true)
  }
}

async function iniciar() {
  const tema = localStorage.getItem('tema')
  if (tema) document.documentElement.dataset.tema = tema

  desenharVitrine()

  const r = await window.hub.estado()
  if (!r.ok) {
    // Sem tela de erro: o Hub conversa e resolve.
    $('estadoHub').textContent = 'procurando o Hub…'
    mostrarEntrada()
    return void acertarCasa()
  }

  aplicarHub(r)
  await recarregarLista()
  if (estado.conversas.length) await abrirConversa(estado.conversas[0].id)
  else mostrarEntrada()

  // Em segundo plano, sem travar a abertura: descobrir o que está ligado de
  // verdade e puxar o que o time publicou.
  carregarProntidao()
  sincronizarEmSilencio()
}

iniciar()
