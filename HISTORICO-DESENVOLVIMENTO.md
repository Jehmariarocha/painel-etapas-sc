# Histórico de Desenvolvimento — Painel de Etapas 1Comodo

Registro de toda a jornada de construção da ferramenta, em ordem, com as decisões
e os problemas resolvidos. (Documentação técnica da versão final: ver `DOCUMENTACAO.md`.)

---

## Linha do tempo

### Fase 1 — Protótipo (23/10/2026)
Começou como um **protótipo HTML** (dados no navegador), para validar a ideia com você.
- Quadro **kanban** com as fases NBR (LV, EP, AP, PE, DT) + Concluído.
- Decisões suas pelo caminho: estilo kanban, mover entre colunas, **fundo branco**,
  cores da marca (amarelo #ffd600, Century Gothic), **logo 1COMODO** no topo, botão claro/escuro,
  remover a coluna "Projeto Legal", play/pausa direto no card, setas de toque.
- Cronômetro por etapa, horas previstas, **responsável** e **prazo** por etapa.
- **Relatório** de horas (projeto × etapa) com **exportar PDF**.
- Primeiras ideias de **honestidade das horas** (quem iniciou, auto-pausa, histórico).

### Fase 2 — Virou um app de verdade + foi para produção (26/10/2026)
Decisão: transformar o protótipo em um **app Next.js** (irmão das outras ferramentas), para ter
servidor e permitir **alertas automáticos**.
- Scaffold Next.js 16 + Tailwind v4 + TypeScript + Upstash Redis.
- **Login com Google** `@1comodo.online` (perfis **dona** e **equipe**).
- Toda a interface do protótipo portada para React.
- **Publicado na Vercel:** `painel-etapas-sc-7mrk.vercel.app`, deploy automático por `git push`.
- Os 5 projetos reais + a equipe foram migrados do protótipo.
- Lições que custaram tempo: `next dev -H 0.0.0.0` quebrava o login do Google; o redirect
  do OAuth tinha que estar cadastrado; separar banco local (`dev:`) do de produção.

### Alerta automático de prazos por e-mail (27/10/2026)
- **Cron diário na Vercel** varre as etapas e manda um resumo das vencidas/a vencer.
- Enviado por **Resend**. Como o remetente de teste só entrega no Gmail pessoal, criamos um
  **filtro no Gmail** que reenvia automático para o e-mail do escritório (sem precisar verificar
  domínio na Servla, que você não tinha acesso).
- Horário ajustado para **9h da manhã** (horário de Brasília).
- Bug grave corrigido aqui: a gravação estava indo vazia (o estado era lido tarde demais).

### Travas de prazo (27-28/10/2026)
Objetivo: ninguém "maquiar" datas para nunca parecer atrasado.
- 1º modelo: **registrar** quem muda a data (histórico).
- Evoluiu para **aprovação**: a equipe não muda a data direto — faz um **pedido com
  justificativa**, e só a **dona aprova** ou recusa. Regra garantida **no servidor**.
- Refinamento: etapa **sem prazo** deixa a equipe definir a **1ª data** direto; só a troca
  de data existente exige aprovação.
- Bug do campo de data: ele agia a cada tecla (digitar o ano virava ano 0002). Corrigido para
  agir só ao sair do campo.

### Cronômetro anti-burla (27-28/10/2026)
A maior frente. Objetivo final: enxergar **rentabilidade** por projeto (horas confiáveis).
- **Teto de 1 hora por sessão:** pausa sozinho e pede **"Reative"** (evita cronômetro esquecido).
- **Relatório ganhou:** horas **por pessoa** (por projeto) e **registro início → fim** de cada
  sessão (só a dona vê).
- **Um cronômetro por pessoa:** pessoas diferentes cronometram juntas; a mesma não roda duas.
- **Multiusuário:** a tela se atualiza sozinha (projetos **e** equipe), sem precisar de F5.
- **Aviso direcionado:** cada pessoa é ligada ao seu **e-mail de login**, então o alerta de
  reativar aparece **só na tela da pessoa dona** do cronômetro. Também há **notificação do
  Windows** (quando o sistema permite).
- **Bloqueio:** ninguém pausa/conclui/move o cronômetro de outra pessoa (nem a dona).
- Correções importantes: a duração das sessões no relatório (parou de encolher sessões antigas);
  e **o bug real do e-mail sumindo** — o servidor estava descartando o campo `email` ao salvar a
  equipe.

### Equipe travada (28/10/2026)
- **Só a dona** pode editar o cadastro da equipe (nomes, funções, e-mails). Garantido no servidor.
- A equipe só **consulta**.

### Fase 3 — Aviso no celular via Telegram (28/10/2026)
- A ideia era WhatsApp, mas você não tinha o Facebook do escritório (o WhatsApp oficial exige
  Meta/Business). Fomos de **Telegram** (grátis, sem Facebook, sem aprovação).
- Criamos o **bot** no @BotFather.
- **Prova de conceito:** uma mensagem de teste chegou no seu Telegram. ✅
- **Alerta de prazos no Telegram:** o cron diário agora manda o resumo por **e-mail E Telegram**,
  automaticamente, às 9h — testado em produção, chega nos dois. ✅

---

## Decisões importantes (e o porquê)

- **App próprio, não módulo:** para ter servidor e permitir alertas automáticos.
- **Reenvio do Gmail** em vez de verificar domínio na Servla: você não tinha o login da Servla,
  e o reenvio resolve sem mexer no DNS.
- **Prazo com aprovação** (em vez de só registrar): "apertar o prazo" não pode deixar nada nunca
  atrasado — a aprovação faz a régua valer.
- **Nem a dona para o cronômetro do outro:** anti-burla mais rígido, a seu pedido.
- **Telegram em vez de WhatsApp:** falta do Facebook + o WhatsApp não deixa postar em grupo.
- **Dados sensíveis (horas por pessoa, início/fim) só a dona vê:** por enquanto, na fase de teste.

---

## Problemas que resolvemos (e as lições)

- **Gravação ia vazia:** o estado novo era lido dentro do updater do React (que roda depois).
  Lição: clonar o dado de forma síncrona antes de gravar.
- **E-mail sumia:** o servidor descartava o campo `email` ao salvar a equipe. (Também ajudou
  consertar o campo no cliente e não salvar ao fechar clicando fora.)
- **Alerta aparecia para todos / parava o cronômetro do outro:** porque qualquer janela fazia a
  pausa automática. Lição: cada janela cuida só do próprio cronômetro (casando pelo e-mail).
- **Teste multiusuário confuso:** era prod + local ao mesmo tempo (bancos separados). Lição: usar
  o **mesmo ambiente** nas duas janelas.
- **Recarregamento de constante não pega sozinho:** reiniciar o `npm run dev` e dar Ctrl+Shift+R.
- **Notificação do Windows é teimosa:** depende das configs de cada PC; o canal confiável é o
  servidor (Telegram).

---

## O que ficou para depois

1. **Telegram para a equipe toda** (grupo ou por pessoa).
2. **"Reative o cronômetro" no celular em tempo real** (precisa de um agendador externo).
3. **Rentabilidade por projeto:** R$/hora por pessoa + valor do projeto → lucro. *(O norte.)*
4. Limpeza dos projetos de teste.

---

*Histórico registrado em 28/10/2026. Trabalho em parceria — Jéssica (1Comodo) + Claude.*
