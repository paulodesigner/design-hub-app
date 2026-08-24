# Começar aqui — Design Hub (o app) num computador novo

Aplicativo de Mac que roda os **agentes de design num chat** — pra quem não quer abrir terminal nem editor de código.

---

## ⚠️ Leia isto antes de instalar

**Este app é uma casca. Ele não tem agente nenhum dentro.**

Ele procura no seu computador uma pasta que seja um **Hub de Design** e usa o motor de lá. Sem essa pasta, o app abre e não faz nada.

```
   o app (esta casca)  +  a pasta do Hub  +  Node e login do Claude
   ─────────────────      ──────────────     ─────────────────────
   a janela de chat       os agentes         o que faz funcionar
```

**Então instale o Hub primeiro:** https://github.com/paulodesigner/hub-de-design

---

## 1. Preparar a máquina

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node git gh
gh auth login
```

## 2. Baixar o Hub (o motor) — antes do app

```bash
cd ~/Documents
git clone https://github.com/paulodesigner/hub-de-design.git
```
O app varre suas pastas atrás de um Hub válido, então qualquer lugar razoável serve.

## 3. Baixar e rodar o app

```bash
cd ~
git clone https://github.com/paulodesigner/design-hub-app.git
cd design-hub-app
npm install
npm start
```

`npm start` abre o app em modo desenvolvimento. **É assim que se usa no dia a dia** — não precisa gerar instalador.

## 4. Gerar um instalador (opcional)

Se quiser o app na pasta Aplicativos, como qualquer outro programa:

```bash
npm run distribuir
```
Isso cria um `.dmg` em `dist/`. Abra, arraste pra Aplicativos.

> O `.dmg` é gerado **para o tipo do seu processador**. Um instalador feito num Mac com chip Apple não roda num Mac Intel — por isso não faz sentido guardar instalador antigo: gere um novo em cada máquina.

## 5. O login do Claude

O app usa o **Claude Agent SDK**, que precisa de acesso ao Claude. Se você já usa o Claude Code no terminal, a autenticação é a mesma e ele aproveita.

Se ainda não usa:
```bash
npm install -g @anthropic-ai/claude-code
claude          # ele conduz o login na primeira vez
```

---

## Se der errado

| Sintoma | Solução |
|---|---|
| App abre mas não acha agente nenhum | falta clonar o **hub-de-design** (passo 2) |
| "não pode ser aberto porque é de um desenvolvedor não identificado" | clique com o botão direito no app → **Abrir** → Abrir |
| Erro ao instalar dependências | `rm -rf node_modules && npm install` |

---

**A regra do projeto:** o app é casca, o Hub é o motor. **Melhorar um agente é mexer no Hub, nunca aqui.** Detalhe no `CLAUDE.md`.
