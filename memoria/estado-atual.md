# Estado atual — Design Hub (o app)

## 2026-08-02 — Projeto separado do Hub
- Saiu de `VS Code/design-hub/` para **`Design System/design-hub/`**, como os
  projetos-irmãos. Git **local**, sem remoto — por decisão do Paulo.
- Junto com a mudança, `ehHubValido()` ficou mais exigente: além de
  `.claude/agents/`, pede `memoria/agentes.md` **ou** `CLAUDE.md`. Sem isso, uma
  pasta qualquer com agentes (inclusive este projeto) se passaria pelo Hub.
- O caminho do Hub agora vive na configuração do app
  (`~/Library/Application Support/Design Hub/configuracao.json`), já que a
  heurística "a pasta-mãe é o Hub" deixou de valer.

## O que o app faz hoje

**Conversa é assunto, agente é membro.** Você cria `#matricula-em-lote`; quem
atende é o **Hub**, que diz quem vai chamar e aciona os agentes que fizerem
sentido — cada um num bloco próprio, falando em tempo real, com relógio de tempo
decorrido. `@slug` força um agente. Menções, membros por conversa, histórico
salvo em disco, tema claro/escuro nos tokens do DS.

**Composer** (equivalente ao do Claude Code, com código nosso): modos de
permissão (Manual · Plano · Aceita edições), menu `/` com 7 comandos, anexar
arquivo, indicador de contexto, ditado por voz, seletor de modelo.

**Segurança:** read-only por padrão; escrever, rodar comando ou sair para a
internet para num cartão de autorização que mostra o payload e diz qual agente
pediu.

## Prontidão dos agentes (medida, não suposta)

**9 de 13 prontos · 2 bloqueados · 2 limitados.**

- O app sobe sozinho o `figma-developer-mcp` quando existe
  `~/.config/ebp/figma_token`, e isso destravou **Figma→Código**, **Mapa do DS**
  e **Leitor de Comentários**.
- Bloqueados: **Código→Figma** (desenhar no canvas só pelo conector oficial da
  claude.ai, que não roda headless) e **Agenda da Sprint** (Notion + Calendar).
- Os conectores da claude.ai **aparecem** na lista de servidores mas param em
  `pending`/`needs-auth` e nunca entregam ferramenta ao modelo.

## O que falta

1. **Notion e Google Calendar** — os servidores MCP existem
   (`@notionhq/notion-mcp-server` é oficial), mas dependem de credencial que não
   existe na máquina. Precisa do Paulo criando a integração.
2. **Desenhar no Figma** — sem saída pelo caminho local.
3. **Login sem terminal** — o SDK tem OAuth embutido mas não expõe API pública.
   É o último passo entre o usuário e "só abrir e conversar".
4. **Assinatura Apple** (US$ 99/ano) para o `.dmg` instalar sem o aviso do
   Gatekeeper.
5. **Multiusuário** — colocar outra pessoa na mesma conversa exige servidor.
