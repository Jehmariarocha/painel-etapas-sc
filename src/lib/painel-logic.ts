import {
  CODES,
  MAX_RUN_SECONDS,
  type Projeto,
  type Etapa,
  type EventoLog,
  type PedidoPrazo,
} from './tipos'

/**
 * Lógica do painel portada do protótipo. São funções puras sobre os dados
 * (nada de DOM): servem no cliente e dá para testar. As mutações alteram o
 * objeto recebido — no React, clonar antes (structuredClone) e guardar o novo.
 */

export function liveSeconds(st: Etapa): number {
  let s = st.seconds || 0
  if (st.startedAt) {
    s += Math.min(MAX_RUN_SECONDS, Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000)))
  }
  return s
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

export function fmtHoursNum(sec: number): string {
  return (sec / 3600).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function fmtHours(sec: number): string {
  return fmtHoursNum(sec) + ' h'
}

export function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const p = iso.split('-').map(Number)
  const due = new Date(p[0], p[1] - 1, p[2])
  due.setHours(0, 0, 0, 0)
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - t.getTime()) / 86400000)
}

export function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const p = iso.split('-')
  return `${p[2]}/${p[1]}/${p[0].slice(2)}`
}

export interface Totais {
  real: number
  est: number
  done: number
  total: number
}

export function projectTotals(p: Projeto): Totais {
  let real = 0
  let est = 0
  let done = 0
  for (const s of p.stages) {
    real += liveSeconds(s)
    est += (s.estimated || 0) * 3600
    if (s.status === 'concluida') done++
  }
  return { real, est, done, total: p.stages.length }
}

export function currentStage(p: Projeto): Etapa | null {
  return (
    p.stages.find((s) => s.status === 'andamento') ||
    p.stages.find((s) => s.status === 'pendente') ||
    null
  )
}

export function currentColIndex(p: Projeto): number {
  const cur = currentStage(p)
  if (!cur) return CODES.length
  return CODES.indexOf(cur.code)
}

// ---------------- mutações (alteram o objeto) ----------------

export function logEvent(st: Etapa, t: EventoLog['t'], by: string | null, at?: number): void {
  if (!Array.isArray(st.log)) st.log = []
  st.log.push({ t, by: by || null, at: at || Date.now() })
  if (st.log.length > 200) st.log = st.log.slice(-200)
}

/** Registra no histórico uma mudança de prazo direta (dona): quem, de→para. */
export function logDueChange(st: Etapa, by: string | null, from: string | null, to: string | null): void {
  if (!Array.isArray(st.log)) st.log = []
  st.log.push({ t: 'due', by: by || null, at: Date.now(), from: from ?? null, to: to ?? null })
  if (st.log.length > 200) st.log = st.log.slice(-200)
}

function pushLog(st: Etapa, ev: EventoLog): void {
  if (!Array.isArray(st.log)) st.log = []
  st.log.push(ev)
  if (st.log.length > 200) st.log = st.log.slice(-200)
}

/** Equipe pediu uma mudança de prazo (com justificativa). */
export function logDueReq(st: Etapa, by: string, from: string | null, to: string | null, reason: string): void {
  pushLog(st, { t: 'due_req', by, at: Date.now(), from: from ?? null, to: to ?? null, reason })
}

/** Dona aprovou um pedido: a data muda e fica o registro de quem pediu. */
export function logDueOk(st: Etapa, by: string, from: string | null, to: string | null, req: string): void {
  pushLog(st, { t: 'due_ok', by, at: Date.now(), from: from ?? null, to: to ?? null, req })
}

/** Dona recusou um pedido: a data NÃO muda; fica o registro. */
export function logDueRej(st: Etapa, by: string, to: string | null, req: string): void {
  pushLog(st, { t: 'due_rej', by, at: Date.now(), to: to ?? null, req })
}

/**
 * Trava do prazo com aprovação — a regra AUTORITATIVA, roda no servidor sobre
 * o que o cliente mandou salvar (`incoming`), comparando com o que está gravado
 * (`existente`). Altera `incoming` no lugar.
 *
 *  - `dona`: manda em tudo (muda a data direto, aprova/recusa pedidos). Nada a travar.
 *  - `equipe`: a data fica CADEADA — só pode deixar/cancelar um pedido pendente,
 *    nunca mudar `due` nem aprovar o próprio pedido. Quem pediu é sempre quem logou.
 *
 * O histórico é gravado no cliente; aqui protegemos o estado que vale (a data).
 */
function mesmoPedido(a: PedidoPrazo | null, b: PedidoPrazo | null): boolean {
  if (!a || !b) return a === b
  return a.to === b.to && a.by === b.by && a.at === b.at && a.reason === b.reason
}

export function travarPrazo(
  existente: Projeto,
  incoming: Projeto,
  papel: 'dona' | 'equipe',
  email: string,
): void {
  if (papel === 'dona') return
  for (const n of incoming.stages) {
    const e = existente.stages.find((x) => x.code === n.code)
    if (!e) continue

    // 0) etapa SEM prazo ainda → a equipe pode DEFINIR a 1ª data direto
    //    (não há nada a travar). A partir daí, trocar só com aprovação.
    if (e.due === null) {
      n.pendingDue = null
      continue
    }

    // 1) já tem prazo → a data não muda pela mão da equipe.
    n.due = e.due

    const ePed = e.pendingDue ?? null
    const nPed = n.pendingDue ?? null

    // 2) pedido inalterado → mantém exatamente o que está gravado (não reescreve
    //    autoria quando a pessoa está só mexendo em OUTRO campo da etapa).
    if (mesmoPedido(ePed, nPed)) { n.pendingDue = ePed; continue }

    // 3) ninguém mexe no pedido de OUTRA pessoa (nem cancela, nem substitui).
    if (ePed && ePed.by !== email) { n.pendingDue = ePed; continue }

    // 4) cancelar o próprio pedido.
    if (!nPed) { n.pendingDue = null; continue }

    // 5) pedir a data que já é a atual não faz sentido.
    if (nPed.to === e.due) { n.pendingDue = ePed; continue }

    // 6) novo pedido: quem pediu é sempre o e-mail logado.
    n.pendingDue = {
      to: nPed.to ?? null,
      by: email,
      at: nPed.at || Date.now(),
      reason: String(nPed.reason || '').slice(0, 500),
    }
  }
}

/** Encerra a contagem em curso; `auto` = foi a pausa automática (teto de horas). */
export function stopRun(st: Etapa, auto: boolean): void {
  if (!st.startedAt) return
  const elapsed = Math.min(MAX_RUN_SECONDS, Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000)))
  st.seconds = (st.seconds || 0) + elapsed
  const at = auto ? st.startedAt + MAX_RUN_SECONDS * 1000 : Date.now()
  logEvent(st, auto ? 'auto' : 'pause', st.startedBy, at)
  st.startedAt = null
  st.startedBy = null
}

export function startStage(st: Etapa, personId: string | null): void {
  st.seconds = st.seconds || 0
  st.startedAt = Date.now()
  st.startedBy = personId || null
  if (personId && !st.personId) st.personId = personId
  if (st.status !== 'concluida') st.status = 'andamento'
  logEvent(st, 'start', personId, st.startedAt)
}

export function toggleDone(st: Etapa): void {
  if (st.status === 'concluida') {
    st.status = st.seconds > 0 ? 'andamento' : 'pendente'
    logEvent(st, 'reopen', null)
  } else {
    if (st.startedAt) stopRun(st, false)
    st.status = 'concluida'
    logEvent(st, 'done', null)
  }
}

export function moveToStage(p: Projeto, code: string): void {
  if (code === '__done') {
    for (const s of p.stages) {
      if (s.startedAt) stopRun(s, false)
      s.status = 'concluida'
    }
    return
  }
  const idx = p.stages.findIndex((s) => s.code === code)
  if (idx < 0) return
  p.stages.forEach((s, i) => {
    if (i < idx) {
      if (s.startedAt) stopRun(s, false)
      s.status = 'concluida'
    } else if (i === idx) {
      s.status = 'andamento'
    } else {
      if (s.startedAt) stopRun(s, false)
      s.status = 'pendente'
    }
  })
}

/** Pausa automaticamente a etapa que passou do teto de horas. Devolve se mexeu. */
export function autoPauseStage(st: Etapa): boolean {
  if (st.startedAt && Date.now() - st.startedAt >= MAX_RUN_SECONDS * 1000) {
    stopRun(st, true)
    return true
  }
  return false
}

// ---------------- horas por pessoa (para o relatório) ----------------

/**
 * Reconstrói, a partir do histórico, quantos segundos CADA pessoa trabalhou
 * nesta etapa. Casa cada `start` com o `pause`/`auto` seguinte (mesmo teto por
 * sessão) e soma pela pessoa que iniciou. Inclui a sessão em curso, se houver.
 * Chave `'—'` = sessões sem pessoa identificada.
 */
export function secondsByPerson(st: Etapa): Record<string, number> {
  const acc: Record<string, number> = {}
  let openBy: string | null = null
  let openAt = 0
  for (const e of st.log || []) {
    if (e.t === 'start') {
      openBy = e.by
      openAt = e.at
    } else if ((e.t === 'pause' || e.t === 'auto') && openAt) {
      const sec = Math.min(MAX_RUN_SECONDS, Math.max(0, Math.round((e.at - openAt) / 1000)))
      const k = openBy || '—'
      acc[k] = (acc[k] || 0) + sec
      openBy = null
      openAt = 0
    }
  }
  // sessão rodando agora (ainda sem pause no log)
  if (st.startedAt) {
    const sec = Math.min(MAX_RUN_SECONDS, Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000)))
    const k = st.startedBy || '—'
    acc[k] = (acc[k] || 0) + sec
  }
  return acc
}

/** Soma as horas por pessoa de todas as etapas de um projeto. */
export function secondsByPersonForProject(p: Projeto): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const st of p.stages) {
    const m = secondsByPerson(st)
    for (const k in m) acc[k] = (acc[k] || 0) + m[k]
  }
  return acc
}

/** Uma sessão de cronômetro: início, fim (null = em curso), quem e quanto contou. */
export interface SessaoHoras {
  by: string | null
  start: number
  end: number | null
  seconds: number
}

/**
 * Reconstrói as sessões de trabalho (início → fim) de uma etapa a partir do
 * histórico, casando cada `start` com o `pause`/`auto` seguinte. A sessão em
 * curso entra com `end: null`.
 */
export function workSessions(st: Etapa): SessaoHoras[] {
  const out: SessaoHoras[] = []
  let openBy: string | null = null
  let openAt = 0
  for (const e of st.log || []) {
    if (e.t === 'start') {
      openBy = e.by
      openAt = e.at
    } else if ((e.t === 'pause' || e.t === 'auto') && openAt) {
      const sec = Math.min(MAX_RUN_SECONDS, Math.max(0, Math.round((e.at - openAt) / 1000)))
      out.push({ by: openBy, start: openAt, end: e.at, seconds: sec })
      openBy = null
      openAt = 0
    }
  }
  if (st.startedAt) {
    const sec = Math.min(MAX_RUN_SECONDS, Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000)))
    out.push({ by: st.startedBy, start: st.startedAt, end: null, seconds: sec })
  }
  return out
}
