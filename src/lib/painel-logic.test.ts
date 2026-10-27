import { describe, it, expect } from 'vitest'
import { travarPrazo } from './painel-logic'
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
  it('não muda a data direto (fica cadeada)', () => {
    const existente = proj([stage({ due: '2026-10-25' })])
    const incoming = proj([stage({ due: '2026-11-30' })]) // tentou mudar
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
