/**
 * Tipos e constantes do painel. Sem `server-only`: as telas do cliente
 * importam daqui, então nada aqui pode puxar o servidor.
 */

export type StatusEtapa = 'pendente' | 'andamento' | 'concluida'

/** Um evento do histórico da etapa (quem iniciou/pausou/concluiu/mudou prazo e quando). */
export interface EventoLog {
  t: 'start' | 'pause' | 'auto' | 'done' | 'reopen' | 'due'
  /** id da pessoa (eventos de cronômetro) ou e-mail de quem logou (mudança de prazo); null quando não se sabe. */
  by: string | null
  /** epoch ms. */
  at: number
  /** mudança de prazo (`t: 'due'`): data anterior (YYYY-MM-DD ou null). */
  from?: string | null
  /** mudança de prazo (`t: 'due'`): data nova (YYYY-MM-DD ou null). */
  to?: string | null
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

/** Auto-pausa: o cronômetro conta no máximo este tanto por sessão. */
export const MAX_RUN_HOURS = 8
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
  }))
}
