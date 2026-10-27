import {
  CODES,
  MAX_RUN_SECONDS,
  type Projeto,
  type Etapa,
  type EventoLog,
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

/** Registra no histórico uma mudança de prazo: quem (e-mail), de→para. */
export function logDueChange(st: Etapa, by: string | null, from: string | null, to: string | null): void {
  if (!Array.isArray(st.log)) st.log = []
  st.log.push({ t: 'due', by: by || null, at: Date.now(), from: from ?? null, to: to ?? null })
  if (st.log.length > 200) st.log = st.log.slice(-200)
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
