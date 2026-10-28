# Painel de Etapas de Projeto — 1Comodo

Ferramenta interna do escritório **1Comodo** (Arquitetura · Urbanismo · Construção) para
acompanhar em que fase está cada projeto, cronometrar as horas de trabalho por etapa e
avisar automaticamente sobre prazos.

- **Produção:** https://painel-etapas-sc-7mrk.vercel.app
- **Código:** GitHub `Jehmariarocha/painel-etapas-sc` (branch `main`)
- **Hospedagem:** Vercel (deploy automático a cada `git push`)
- **Banco de dados:** Upstash Redis

---

## 1. O que a ferramenta faz

- **Quadro Kanban** das fases de projeto (padrão NBR): **LV, EP, AP, PE, DT** + **Concluído**.
- **Cronômetro de horas** por etapa, com proteções **anti-burla**.
- **Prazos** por etapa, com **alerta automático** (e-mail + Telegram) e **aprovação** para mudar datas.
- **Relatórios** de horas (por projeto, por etapa, por pessoa) com exportação em PDF.
- **Login** com a conta Google do domínio `@1comodo.online`, com dois perfis: **dona** e **equipe**.

---

## 2. Acesso e perfis

- **Login:** entra com a conta Google `@1comodo.online` (não tem senha própria).
- **Perfis (papel):**
  - **`dona`** — a conta definida em `DONO_EMAIL`. Pode tudo: editar a equipe, aprovar
    mudanças de prazo, ver relatórios detalhados.
  - **`equipe`** — qualquer outra conta `@1comodo.online`. Usa o painel, mas tem as travas.

---

## 3. Tecnologia

| Camada | O que usamos |
|---|---|
| Framework | Next.js 16 (App Router + Turbopack) |
| Front | React 19 + Tailwind CSS v4 + TypeScript |
| Banco | Upstash Redis (`@upstash/redis`) |
| Login | Google OAuth (cookie de sessão assinado por HMAC) |
| E-mail | Resend |
| Telegram | Telegram Bot API |
| Deploy | Vercel (Cron Jobs para o alerta diário) |

---

## 4. Funcionalidades em detalhe

### 4.1 Quadro Kanban
- Colunas = fases NBR (LV, EP, AP, PE, DT) + Concluído.
- Arrasta o card entre colunas para mudar a etapa.
- ▶ inicia o cronômetro direto no card; clicar no card abre o projeto.

### 4.2 Cronômetro (horas por etapa) — ANTI-BURLA
- **Quem iniciou:** ao dar play, registra qual pessoa iniciou.
- **Teto de 1 hora por sessão:** o cronômetro pausa sozinho após 1h e pede
  **"Reative"** — assim ninguém deixa rodando e sai (no máximo 1h "solta").
- **Um cronômetro por pessoa:** pessoas diferentes cronometram ao mesmo tempo, mas a
  mesma pessoa não roda dois.
- **Só o dono pausa:** ninguém pausa/conclui/move o cronômetro de outra pessoa (nem a dona).
- **Histórico** por etapa: início/pausa/conclusão, por quem e quando.
- **Aviso de reativar** vai só para a tela da pessoa dona do cronômetro (casado pelo e-mail
  de login) — e há notificação do Windows (quando o navegador permite).

### 4.3 Prazos e aprovação
- Cada etapa tem uma **data de prazo**.
- Etapa **vencida** fica vermelha; etapa a vencer mostra um aviso.
- **Trava de mudança de data:**
  - Etapa **sem prazo** → a equipe pode definir a 1ª data direto.
  - Etapa **com prazo** → a equipe não muda direto; faz um **pedido com justificativa**,
    e só a **dona aprova** (ou recusa). Tudo fica no histórico.

### 4.4 Relatórios (menu "Relatório")
- Matriz **projeto × etapa** com horas trabalhadas, previstas e saldo.
- **Horas por pessoa** (por projeto) — só a dona vê.
- **Registro de horas** (início → fim de cada sessão) — só a dona vê.
- **Exportar PDF**.

### 4.5 Equipe (travada)
- Cadastro de pessoas: nome, função e **e-mail de login** (liga a pessoa à conta Google).
- **Só a dona edita** (garantido no servidor). A equipe só consulta.

### 4.6 Alertas automáticos de prazo
- Um **cron diário (9h da manhã, horário de Brasília)** varre as etapas.
- Janela de alerta: **de 2 dias antes até 2 dias depois** do prazo.
- Envia um resumo por **e-mail** e por **Telegram** (os dois canais, independentes).

---

## 5. Como funciona por dentro (arquitetura)

### 5.1 Arquivos principais
```
src/
  lib/
    tipos.ts          # Modelo de dados (Projeto, Etapa, Pessoa, EventoLog...) + constantes
    painel-logic.ts   # Lógica pura: cronômetro, travarPrazo, horas por pessoa, sessões
    painel.ts         # Acesso ao Redis (salvar/ler projetos e equipe)
    sessao.ts         # Login Google + cookie assinado + papel (dona/equipe)
    chaves.ts         # Separa dados locais (prefixo dev:) dos de produção
    proxy.ts          # Middleware (só /api/auth é público; o resto exige login)
    telegram.ts       # Envio pelo Telegram Bot API
  components/
    Painel.tsx        # Toda a interface (quadro, detalhe, relatório, modais)
  app/
    page.tsx          # Porta de entrada (exige login)
    login/page.tsx    # Tela de login
    api/projetos/     # CRUD de projetos (com a trava de prazo no servidor)
    api/equipe/       # Ler/salvar equipe (salvar só a dona)
    api/importar/     # Importar dados do protótipo
    cron/alerta-prazos/  # O alerta diário (e-mail + Telegram)
    cron/tg-teste/       # Endpoint de teste do Telegram
vercel.json           # Agendamento do cron (0 12 * * * UTC = 9h BRT)
```

### 5.2 Modelo de dados (resumo)
- **Projeto**: id, nome, cliente, responsáveis (pessoas), lista de **Etapas**.
- **Etapa**: código (LV/EP/...), status, segundos trabalhados, horas previstas, prazo (`due`),
  responsável, quem está cronometrando, **histórico (log)** e **pedido de prazo pendente**.
- **Pessoa**: id, nome, função (role), **e-mail de login**.

### 5.3 Onde os dados ficam (Redis)
- Produção usa as chaves `painel:*`.
- Local (desenvolvimento) usa `dev:painel:*` (separado, para não misturar).
- Chaves: `painel:proj_index` (ids), `painel:proj:<id>` (projeto), `painel:equipe` (pessoas).

### 5.4 Travas anti-burla (resumo)
| Trava | Como funciona |
|---|---|
| Teto do cronômetro | Pausa sozinho em 1h; nunca conta além disso |
| Um cronômetro por pessoa | A mesma pessoa não roda dois ao mesmo tempo |
| Só o dono pausa | Ninguém para o cronômetro do outro (nem a dona) |
| Prazo com aprovação | Equipe pede com justificativa; só a dona aprova |
| Equipe travada | Só a dona edita o cadastro de pessoas |
| Registro | Mudanças de prazo e sessões ficam no histórico |

---

## 6. Rodar localmente (desenvolvimento)

```bash
cd painel-etapas-sc
npm run dev
```
Abre em **http://localhost:3004**.

- O local usa um **banco de teste separado** (`dev:painel:*`), então começa diferente da produção.
- Para testar com dados reais, copia-se a produção para o local (feito via script pontual).
- **Importante:** o banco e as configs locais ficam no `.env.local` (não vai para o Git).

> Dica: ao mudar uma **constante** (ex.: o teto do cronômetro), às vezes o recarregamento
> automático não pega — reinicie o `npm run dev` e dê **Ctrl+Shift+R** no navegador.

## 7. Publicar (deploy)

```bash
git add -A
git commit -m "sua mensagem"
git push origin main
```
A Vercel faz o deploy automático. Variáveis de ambiente novas só valem após um **Redeploy**.

---

## 8. Variáveis de ambiente (na Vercel)

| Variável | Para quê |
|---|---|
| `ADMIN_SECRET` | Assina o cookie de sessão |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Conexão com o Upstash Redis |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login com Google |
| `DONO_EMAIL` | Quem é a **dona** (perfil com poderes) |
| `CRON_SECRET` | Protege o disparo do cron pela Vercel |
| `RESEND_API_KEY` | Envio de e-mail |
| `TELEGRAM_BOT_TOKEN` | Bot do Telegram (dos avisos) |
| `TELEGRAM_CHAT_ALERTA` | Chat que recebe o resumo de prazos no Telegram |

---

## 9. Alertas — e-mail e Telegram

### E-mail
- Enviado pelo **Resend**. O remetente de teste (`onboarding@resend.dev`) só entrega no
  e-mail dono da conta Resend (o Gmail pessoal). Por isso, o alerta chega no Gmail e um
  **filtro do Gmail reenvia automático** para o e-mail do escritório.

### Telegram (Fase 3)
- Bot criado no **@BotFather**.
- O resumo de prazos cai automático no chat definido em `TELEGRAM_CHAT_ALERTA`.
- O Telegram só manda para quem **já falou com o bot** antes (opt-in natural).
- Endpoint de teste: `/cron/tg-teste` (lista chats) e `/cron/tg-teste?chat=ID` (envia teste).

---

## 10. Limitações conhecidas

- **WhatsApp em grupo:** o WhatsApp **não permite** que bots/sistemas postem em grupos
  (regra anti-spam dele). Não há jeito oficial. Alternativas: grupo no Telegram (automático)
  ou reencaminhar manualmente do Telegram para o grupo do WhatsApp.
- **Notificação do Windows:** funciona quando o Windows/Chrome permite; não é 100% confiável
  quando o navegador está minimizado por muito tempo (a aba "congela"). O aviso à prova de
  tudo é por servidor (Telegram).
- **Vercel Hobby:** o cron roda **1x por dia**. Avisos em tempo real (ex.: "reative o
  cronômetro" na hora) precisariam de um agendador externo.

---

## 11. Próximos passos (ideias)

1. **Telegram para a equipe toda:** criar um grupo no Telegram e mandar o resumo para o grupo
   (ou por pessoa, com o chat_id de cada um).
2. **"Reative o cronômetro" no celular:** disparar em tempo real (precisa de um agendador
   externo chamando um endpoint a cada poucos minutos).
3. **Rentabilidade por projeto:** cadastrar R$/hora por pessoa e valor do projeto para
   calcular lucro (valor − horas × custo). *(O norte do projeto.)*
4. Limpeza: apagar os projetos de teste.

---

*Documentação gerada em 28/10/2026.*
