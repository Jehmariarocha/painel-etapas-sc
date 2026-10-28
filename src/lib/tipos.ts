/**
 * Tipos e constantes do painel. Sem `server-only`: as telas do cliente
 * importam daqui, então nada aqui pode puxar o servidor.
 */

export type StatusEtapa = 'pendente' | 'andamento' | 'concluida'

/**
 * Um evento do histórico da etapa. Cronômetro: start/pause/auto/done/reopen.
 * Prazo: `due` (dona mudou direto), `due_req` (equipe pediu), `due_ok`
 * (dona aprovou), `due_rej` (dona recusou).
 */
export interface EventoLog {
  t: 'start' | 'pause' | 'auto' | 'done' | 'reopen' | 'due' | 'due_req' | 'due_ok' | 'due_rej'
  /** id da pessoa (cronômetro) ou e-mail de quem logou (eventos de prazo); null quando não se sabe. */
  by: string | null
  /** epoch ms. */
  at: number
  /** eventos de prazo: data anterior (YYYY-MM-DD ou null). */
  from?: string | null
  /** eventos de prazo: data nova/pedida (YYYY-MM-DD ou null). */
  to?: string | null
  /** aprovação/recusa: e-mail de quem tinha pedido. */
  req?: string | null
  /** pedido de mudança: a justificativa. */
  reason?: string
}

/** Pedido de mudança de prazo (feito pela equipe) aguardando aprovação da dona. */
export interface PedidoPrazo {
  /** nova data pedida (YYYY-MM-DD) ou null para remover o prazo. */
  to: string | null
  /** e-mail de quem pediu. */
  by: string
  /** epoch ms. */
  at: number
  /** justificativa do pedido. */
  reason: string
}

export interface Etapa {
  code: string
  name: string
  status: StatusEtapa
  /** segundos acumulados (já pausados). */
  seconds: number
  /** horas previstas. */
  estimated: number
  /** prazo YYYY-MM-DD, ou null. */
  due: string | null
  /** responsável da etapa (id da pessoa), ou null. */
  personId: string | null
  /** epoch ms se o cronômetro está rodando, senão null. */
  startedAt: number | null
  /** quem iniciou a contagem em curso. */
  startedBy: string | null
  log: EventoLog[]
  /** pedido de mudança de prazo pendente de aprovação (null = nenhum). */
  pendingDue?: PedidoPrazo | null
}

export interface Projeto {
  id: string
  name: string
  client: string
  example?: boolean
  /** responsáveis do projeto (ids das pessoas). */
  people: string[]
  stages: Etapa[]
  createdAt: number
  updatedAt: number
}

export interface Pessoa {
  id: string
  name: string
  /** função/cargo (Arquiteta, Projetista, Estagiário…). */
  role: string
}

/** As fases NBR que o escritório acompanha (Projeto Legal foi removida). */
export const ETAPAS_MODELO: { code: string; name: string }[] = [
  { code: 'LV', name: 'Levantamento' },
  { code: 'EP', name: 'Estudo Preliminar' },
  { code: 'AP', name: 'Anteprojeto' },
  { code: 'PE', name: 'Projeto Executivo' },
  { code: 'DT', name: 'Detalhamento' },
]

export const CODES = ETAPAS_MODELO.map((e) => e.code)

/**
 * Auto-pausa (anti-burla): o cronômetro conta no máximo este tanto por sessão.
 * A cada 1h ele pausa sozinho e pede reativação — assim ninguém deixa rodando
 * e sai; no máximo 1h "solta" sem alguém confirmar que está trabalhando.
 */
export const MAX_RUN_HOURS = 1
export const MAX_RUN_SECONDS = MAX_RUN_HOURS * 3600

export function etapasNovas(): Etapa[] {
  return ETAPAS_MODELO.map((e) => ({
    code: e.code,
    name: e.name,
    status: 'pendente',
    seconds: 0,
    estimated: 0,
    due: null,
    personId: null,
    startedAt: null,
    startedBy: null,
    log: [],
    pendingDue: null,
  }))
}
