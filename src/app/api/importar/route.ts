/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/lib/sessao'
import { salvarProjeto, lerEquipe, salvarEquipe } from '@/lib/painel'
import { etapasNovas, type Projeto, type Pessoa, type StatusEtapa } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

/**
 * Importa os dados do protótipo (o JSON do localStorage `painel-etapas-v1`).
 * Upsert por id: adiciona/atualiza projetos e junta a equipe sem apagar o que
 * já existe. Normaliza as etapas para o modelo atual (ignora PL, etc.).
 */
export async function POST(req: NextRequest) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa

  const body = (await req.json().catch(() => null)) as any
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // --- equipe (merge por id) ---
  const equipeIn: any[] = Array.isArray(body.equipe) ? body.equipe : Array.isArray(body.people) ? body.people : []
  const equipe: Pessoa[] = await lerEquipe()
  const idsEquipe = new Set(equipe.map((p) => p.id))
  for (const p of equipeIn) {
    if (p && typeof p.id === 'string' && typeof p.name === 'string' && !idsEquipe.has(p.id)) {
      equipe.push({ id: p.id, name: String(p.name).trim(), role: String(p.role || '').trim(), email: typeof p.email === 'string' && p.email.trim() ? p.email.trim().toLowerCase() : undefined })
      idsEquipe.add(p.id)
    }
  }
  await salvarEquipe(equipe)

  // --- projetos (upsert por id) ---
  const projsIn: any[] = Array.isArray(body.projetos)
    ? body.projetos
    : Array.isArray(body.projects)
      ? body.projects
      : []
  const agora = Date.now()
  const statusOk = (s: any): StatusEtapa =>
    s === 'andamento' || s === 'concluida' ? s : 'pendente'

  let importados = 0
  for (const raw of projsIn) {
    if (!raw || typeof raw.name !== 'string') continue
    const stagesIn: any[] = Array.isArray(raw.stages) ? raw.stages : []
    const stages = etapasNovas().map((st) => {
      const src = stagesIn.find((s) => s && s.code === st.code)
      if (!src) return st
      return {
        ...st,
        status: statusOk(src.status),
        seconds: Number(src.seconds) || 0,
        estimated: Number(src.estimated) || 0,
        due: typeof src.due === 'string' ? src.due : null,
        personId: typeof src.personId === 'string' ? src.personId : null,
        startedAt: typeof src.startedAt === 'number' ? src.startedAt : null,
        startedBy: typeof src.startedBy === 'string' ? src.startedBy : null,
        log: Array.isArray(src.log) ? src.log.slice(-200) : [],
      }
    })
    const p: Projeto = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      name: raw.name.trim(),
      client: typeof raw.client === 'string' ? raw.client.trim() : '',
      example: !!raw.example,
      people: Array.isArray(raw.people) ? raw.people.filter((x: any) => typeof x === 'string') : [],
      stages,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : agora,
      updatedAt: agora,
    }
    await salvarProjeto(p)
    importados++
  }

  return NextResponse.json({ ok: true, importados, pessoas: equipe.length })
}
