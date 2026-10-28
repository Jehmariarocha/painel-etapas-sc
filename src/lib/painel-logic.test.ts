import { describe, it, expect } from 'vitest'
import { travarPrazo, logDueChange, logDueReq, logDueOk, logDueRej, autoPauseStage, secondsByPersonForProject, workSessions } from './painel-logic'
import { MAX_RUN_SECONDS } from './tipos'
import type { Projeto, Etapa } from './tipos'

/**
 * Testes da regra AUTORITATIVA da trava de prazo (`travarPrazo`), que roda no
 * servidor. Provam que a equipe não muda a data direto nem aprova o próprio
 * pedido, e que a dona manda em tudo.
 */

function stage(partial: Partial<Etapa>): Etapa {
  return {
    code: 'LV', name: 'Levantamento', status: 'pendente', seconds: 0, estimated: 0,
    due: null, personId: null, startedAt: null, startedBy: null, log: [], pendingDue: null,
    ...partial,
  }
}
function proj(stages: Etapa[]): Projeto {
  return { id: 'p1', name: 'P', client: '', people: [], stages, createdAt: 0, updatedAt: 0 }
}

const JOAO = 'joao@1comodo.online'
const MARIA = 'maria@1comodo.online'
const DONA = 'jessica.rocha@1comodo.online'

describe('travarPrazo — equipe', () => {
  it('define a 1ª data direto quando a etapa não tem prazo', () => {
    const existente = proj([stage({ due: null })])
    const incoming = proj([stage({ due: '2026-11-30' })]) // 1ª data
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].due).toBe('2026-11-30')
    expect(incoming.stages[0].pendingDue).toBeNull()
  })

  it('não muda a data direto quando JÁ existe prazo (fica cadeada)', () => {
    const existente = proj([stage({ due: '2026-10-25' })])
    const incoming = proj([stage({ due: '2026-11-30' })]) // tentou trocar
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].due).toBe('2026-10-25')
  })

  it('cria um pedido com justificativa; o autor é sempre o e-mail logado', () => {
    const existente = proj([stage({ due: '2026-10-25' })])
    const incoming = proj([
      stage({ due: '2026-10-25', pendingDue: { to: '2026-11-30', by: 'fake@x.com', at: 123, reason: 'cliente atrasou envio' } }),
    ])
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].due).toBe('2026-10-25')
    expect(incoming.stages[0].pendingDue).toEqual({ to: '2026-11-30', by: JOAO, at: 123, reason: 'cliente atrasou envio' })
  })

  it('pedir a data que já é a atual não vira pedido', () => {
    const existente = proj([stage({ due: '2026-10-25' })])
    const incoming = proj([
      stage({ due: '2026-10-25', pendingDue: { to: '2026-10-25', by: JOAO, at: 1, reason: 'x' } }),
    ])
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].pendingDue).toBeNull()
  })

  it('não consegue aprovar o próprio pedido (a data reverte)', () => {
    const existente = proj([
      stage({ due: '2026-10-25', pendingDue: { to: '2026-11-30', by: JOAO, at: 1, reason: 'x' } }),
    ])
    const incoming = proj([stage({ due: '2026-11-30', pendingDue: null })]) // tentou aplicar sozinho
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].due).toBe('2026-10-25')
  })

  it('não apaga o pedido de outra pessoa', () => {
    const existente = proj([
      stage({ due: '2026-10-25', pendingDue: { to: '2026-11-30', by: MARIA, at: 1, reason: 'x' } }),
    ])
    const incoming = proj([stage({ due: '2026-10-25', pendingDue: null })]) // joão tentou apagar o da maria
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].pendingDue).toEqual({ to: '2026-11-30', by: MARIA, at: 1, reason: 'x' })
  })

  it('ação de outra pessoa (noutro campo) não rouba a autoria do pedido', () => {
    const ped = { to: '2026-11-30', by: JOAO, at: 10, reason: 'cliente atrasou' }
    const existente = proj([stage({ due: '2026-10-25', pendingDue: ped })])
    // maria mexeu só nas horas previstas; o pedido do joão veio igual no payload.
    const incoming = proj([stage({ due: '2026-10-25', estimated: 5, pendingDue: { ...ped } })])
    travarPrazo(existente, incoming, 'equipe', MARIA)
    expect(incoming.stages[0].pendingDue).toEqual(ped) // continua sendo do joão
    expect(incoming.stages[0].estimated).toBe(5)
  })

  it('não trava outros campos (ex.: horas previstas continuam editáveis)', () => {
    const existente = proj([stage({ due: '2026-10-25', estimated: 10 })])
    const incoming = proj([stage({ due: '2026-10-25', estimated: 40 })])
    travarPrazo(existente, incoming, 'equipe', JOAO)
    expect(incoming.stages[0].estimated).toBe(40)
  })
})

describe('fluxo completo prazo (cliente + servidor juntos)', () => {
  // imita o servidor: aplica a trava sobre o que o cliente mandou salvar.
  function salvar(existente: Projeto, incoming: Projeto, papel: 'dona' | 'equipe', email: string): Projeto {
    const copia = structuredClone(incoming)
    travarPrazo(existente, copia, papel, email)
    return copia
  }
  const ultimo = (p: Projeto) => p.stages[0].log[p.stages[0].log.length - 1]

  it('equipe define 1ª data, tenta trocar (vira pedido) e a dona aprova', () => {
    const inicial = proj([stage({ due: null })])

    // 1) equipe define a 1ª data (cliente muda direto + loga 'due')
    const c1 = structuredClone(inicial)
    c1.stages[0].due = '2026-11-10'
    logDueChange(c1.stages[0], JOAO, null, '2026-11-10')
    const s1 = salvar(inicial, c1, 'equipe', JOAO)
    expect(s1.stages[0].due).toBe('2026-11-10')
    expect(ultimo(s1)).toMatchObject({ t: 'due', by: JOAO, to: '2026-11-10' })

    // 2) equipe tenta trocar → data não muda, vira pedido com justificativa
    const c2 = structuredClone(s1)
    c2.stages[0].pendingDue = { to: '2026-12-01', by: JOAO, at: 100, reason: 'obra parou' }
    logDueReq(c2.stages[0], JOAO, '2026-11-10', '2026-12-01', 'obra parou')
    const s2 = salvar(s1, c2, 'equipe', JOAO)
    expect(s2.stages[0].due).toBe('2026-11-10')
    expect(s2.stages[0].pendingDue).toMatchObject({ to: '2026-12-01', by: JOAO, reason: 'obra parou' })
    expect(ultimo(s2)).toMatchObject({ t: 'due_req', reason: 'obra parou' })

    // 3) dona aprova → aplica a data pedida, limpa o pedido, registra
    const c3 = structuredClone(s2)
    const ped = c3.stages[0].pendingDue!
    c3.stages[0].due = ped.to
    logDueOk(c3.stages[0], DONA, '2026-11-10', ped.to, ped.by)
    c3.stages[0].pendingDue = null
    const s3 = salvar(s2, c3, 'dona', DONA)
    expect(s3.stages[0].due).toBe('2026-12-01')
    expect(s3.stages[0].pendingDue).toBeNull()
    expect(ultimo(s3)).toMatchObject({ t: 'due_ok', req: JOAO, to: '2026-12-01' })
  })

  it('dona recusa: a data não muda e fica registrado', () => {
    const existente = proj([stage({ due: '2026-11-10', pendingDue: { to: '2026-12-01', by: JOAO, at: 1, reason: 'x' } })])
    const c = structuredClone(existente)
    logDueRej(c.stages[0], DONA, c.stages[0].pendingDue!.to, c.stages[0].pendingDue!.by)
    c.stages[0].pendingDue = null
    const s = salvar(existente, c, 'dona', DONA)
    expect(s.stages[0].due).toBe('2026-11-10')
    expect(s.stages[0].pendingDue).toBeNull()
    expect(ultimo(s)).toMatchObject({ t: 'due_rej', req: JOAO })
  })
})

describe('secondsByPersonForProject — horas por pessoa', () => {
  it('soma as horas de cada pessoa a partir do histórico (com teto por sessão)', () => {
    const now = 1_000_000_000_000
    const s = stage({
      log: [
        { t: 'start', by: 'joao', at: now },
        { t: 'pause', by: 'joao', at: now + 30 * 60 * 1000 }, // 30 min
        { t: 'start', by: 'maria', at: now + 60 * 60 * 1000 },
        { t: 'auto', by: 'maria', at: now + 60 * 60 * 1000 + MAX_RUN_SECONDS * 1000 }, // teto 1h
      ],
    })
    const m = secondsByPersonForProject(proj([s]))
    expect(m['joao']).toBe(30 * 60)
    expect(m['maria']).toBe(MAX_RUN_SECONDS)
  })

  it('sessão antiga maior que o teto mantém a duração real (não recapa)', () => {
    const now = 1_000_000_000_000
    const s = stage({
      log: [
        { t: 'start', by: 'joao', at: now },
        { t: 'pause', by: 'joao', at: now + 2 * 60 * 60 * 1000 }, // 2h (acima do teto de 1h)
      ],
    })
    expect(secondsByPersonForProject(proj([s]))['joao']).toBe(2 * 60 * 60)
    expect(workSessions(s)[0].seconds).toBe(2 * 60 * 60)
  })

  it('workSessions casa início com fim e marca a sessão em curso', () => {
    const now = 1_000_000_000_000
    const encerrada = stage({
      log: [
        { t: 'start', by: 'joao', at: now },
        { t: 'pause', by: 'joao', at: now + 20 * 60 * 1000 },
      ],
    })
    const ss = workSessions(encerrada)
    expect(ss.length).toBe(1)
    expect(ss[0]).toMatchObject({ by: 'joao', start: now, end: now + 20 * 60 * 1000, seconds: 20 * 60 })

    const rodando = stage({ startedAt: Date.now() - 5 * 60 * 1000, startedBy: 'maria', log: [{ t: 'start', by: 'maria', at: Date.now() - 5 * 60 * 1000 }] })
    const sr = workSessions(rodando)
    expect(sr[sr.length - 1].end).toBeNull()
  })
})

describe('autoPauseStage — anti-burla (teto de 1h)', () => {
  it('pausa ao passar do teto e conta no máximo 1h (não o tempo "solto")', () => {
    const s = stage({ status: 'andamento', startedAt: Date.now() - (MAX_RUN_SECONDS + 600) * 1000, startedBy: 'p1', seconds: 0 })
    expect(autoPauseStage(s)).toBe(true)
    expect(s.startedAt).toBeNull()
    expect(s.seconds).toBe(MAX_RUN_SECONDS)
    expect(s.log[s.log.length - 1].t).toBe('auto')
  })

  it('não pausa antes do teto', () => {
    const s = stage({ status: 'andamento', startedAt: Date.now() - 60 * 1000, startedBy: 'p1' })
    expect(autoPauseStage(s)).toBe(false)
    expect(s.startedAt).not.toBeNull()
  })
})

describe('travarPrazo — dona', () => {
  it('muda a data direto (nada é travado)', () => {
    const existente = proj([stage({ due: '2026-10-25' })])
    const incoming = proj([stage({ due: '2026-11-30' })])
    travarPrazo(existente, incoming, 'dona', DONA)
    expect(incoming.stages[0].due).toBe('2026-11-30')
  })

  it('aprova um pedido: aplica a data pedida e limpa o pedido', () => {
    const existente = proj([
      stage({ due: '2026-10-25', pendingDue: { to: '2026-11-30', by: JOAO, at: 1, reason: 'x' } }),
    ])
    const incoming = proj([stage({ due: '2026-11-30', pendingDue: null })])
    travarPrazo(existente, incoming, 'dona', DONA)
    expect(incoming.stages[0].due).toBe('2026-11-30')
    expect(incoming.stages[0].pendingDue).toBeNull()
  })
})
