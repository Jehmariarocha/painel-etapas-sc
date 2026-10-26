import 'server-only'
import { Redis } from '@upstash/redis'
import { chave } from './chaves'
import type { Projeto, Pessoa } from './tipos'

/**
 * Persistência do painel no Upstash Redis — o mesmo banco das outras
 * ferramentas. No local tudo vive sob o prefixo `dev:` (ver `chaves.ts`), para
 * não misturar com os dados do site publicado.
 *
 * - `painel:proj_index`  → conjunto com os ids dos projetos
 * - `painel:proj:<id>`   → o projeto inteiro (JSON)
 * - `painel:equipe`      → a lista de pessoas (JSON)
 */

const redis = Redis.fromEnv()

const K_INDEX = () => chave('painel:proj_index')
const K_PROJ = (id: string) => chave(`painel:proj:${id}`)
const K_EQUIPE = () => chave('painel:equipe')

export async function listarProjetos(): Promise<Projeto[]> {
  const ids = await redis.smembers(K_INDEX())
  if (!ids || ids.length === 0) return []
  const chaves = ids.map((id) => K_PROJ(id))
  const brutos = await redis.mget<Projeto[]>(...chaves)
  return (brutos.filter(Boolean) as Projeto[]).sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  )
}

export async function lerProjeto(id: string): Promise<Projeto | null> {
  return (await redis.get<Projeto>(K_PROJ(id))) ?? null
}

export async function salvarProjeto(p: Projeto): Promise<Projeto> {
  p.updatedAt = Date.now()
  await redis.set(K_PROJ(p.id), p)
  await redis.sadd(K_INDEX(), p.id)
  return p
}

export async function excluirProjeto(id: string): Promise<void> {
  await redis.del(K_PROJ(id))
  await redis.srem(K_INDEX(), id)
}

export async function lerEquipe(): Promise<Pessoa[]> {
  return (await redis.get<Pessoa[]>(K_EQUIPE())) ?? []
}

export async function salvarEquipe(pessoas: Pessoa[]): Promise<void> {
  await redis.set(K_EQUIPE(), pessoas)
}
