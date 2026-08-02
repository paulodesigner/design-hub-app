// Markdown → HTML, mínimo e seguro.
//
// Por que não uma biblioteca: a CSP do app proíbe script externo, e o que a
// gente precisa renderizar é sempre o mesmo punhado de coisas (título, lista,
// código, tabela, link). O texto é SEMPRE escapado antes de virar HTML — nada
// que o modelo escrever pode injetar marcação.

function escapar(t) {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Transformações que valem dentro de uma linha já escapada.
function inline(t) {
  return t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

function linhaDeTabela(linha) {
  return linha
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

export function marcacao(bruto) {
  const linhas = escapar(bruto).split('\n')
  const saida = []
  let i = 0

  // Acumuladores de parágrafo — só viram <p> quando o bloco fecha.
  let paragrafo = []
  const fecharParagrafo = () => {
    if (paragrafo.length) {
      saida.push(`<p>${inline(paragrafo.join(' '))}</p>`)
      paragrafo = []
    }
  }

  while (i < linhas.length) {
    const linha = linhas[i]

    // Bloco de código cercado — nada dentro dele é interpretado.
    const cerca = linha.match(/^\s*```(\w*)\s*$/)
    if (cerca) {
      fecharParagrafo()
      const corpo = []
      i++
      while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) {
        corpo.push(linhas[i])
        i++
      }
      i++ // consome a cerca de fechamento
      saida.push(`<pre><code>${corpo.join('\n')}</code></pre>`)
      continue
    }

    // Linha em branco fecha o parágrafo.
    if (!linha.trim()) {
      fecharParagrafo()
      i++
      continue
    }

    // Régua.
    if (/^\s*([-*_]\s*){3,}$/.test(linha)) {
      fecharParagrafo()
      saida.push('<hr />')
      i++
      continue
    }

    // Título.
    const titulo = linha.match(/^(#{1,3})\s+(.*)$/)
    if (titulo) {
      fecharParagrafo()
      const n = titulo[1].length
      saida.push(`<h${n}>${inline(titulo[2])}</h${n}>`)
      i++
      continue
    }

    // Tabela: cabeçalho + separador + linhas.
    // O separador tem barras internas (`|---|---|`), então elas entram na classe.
    if (/^\s*\|.*\|\s*$/.test(linha) && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || '')) {
      fecharParagrafo()
      const cabeca = linhaDeTabela(linha)
      i += 2
      const corpo = []
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) {
        corpo.push(linhaDeTabela(linhas[i]))
        i++
      }
      const th = cabeca.map((c) => `<th>${inline(c)}</th>`).join('')
      const tr = corpo
        .map((l) => `<tr>${l.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')
      saida.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`)
      continue
    }

    // Citação.
    if (/^\s*&gt;\s?/.test(linha)) {
      fecharParagrafo()
      const corpo = []
      while (i < linhas.length && /^\s*&gt;\s?/.test(linhas[i])) {
        corpo.push(linhas[i].replace(/^\s*&gt;\s?/, ''))
        i++
      }
      saida.push(`<blockquote>${inline(corpo.join(' '))}</blockquote>`)
      continue
    }

    // Listas (não numerada e numerada). Itens de várias linhas são juntados.
    const marcador = linha.match(/^\s*([-*+]|\d+\.)\s+(.*)$/)
    if (marcador) {
      fecharParagrafo()
      const numerada = /\d/.test(marcador[1])
      const itens = []
      while (i < linhas.length) {
        const m = linhas[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/)
        if (m && /\d/.test(m[1]) === numerada) {
          itens.push(m[2])
          i++
          // Um título, uma cerca de código ou uma tabela encerram a lista mesmo
          // sem linha em branco antes — senão viram texto do último item.
        } else if (itens.length && linhas[i].trim() && !/^\s*(#{1,3}\s|```|\|)/.test(linhas[i])) {
          itens[itens.length - 1] += ' ' + linhas[i].trim()
          i++
        } else {
          break
        }
      }
      const li = itens.map((t) => `<li>${inline(t)}</li>`).join('')
      saida.push(numerada ? `<ol>${li}</ol>` : `<ul>${li}</ul>`)
      continue
    }

    paragrafo.push(linha.trim())
    i++
  }

  fecharParagrafo()
  return saida.join('\n')
}
