import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/lib/sessao'
import { listarProjetos, salvarProjeto } from '@/lib/painel'
import { etapasNovas, type Projeto } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  return NextResponse.json({ projetos: await listarProjetos() })
}

export async function POST(req: NextRequest) {
  const recusa = await exigirAdmin(req)
  if (recusa) return recusa
  const body = (await req.json().catch(() => null)) as
    | { name?: string; client?: string; people?: string[] }
    | null
  const name = (body?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })

  const agora = Date.now()
  const p: Projeto = {
    id: crypto.randomUUID(),
    name,
    client: (body?.client || '').trim(),
    people: Array.isArray(body?.people) ? body!.people.filter((x) => typeof x === 'string') : [],
    stages: etapasNovas(),
    createdAt: agora,
    updatedAt: agora,
  }
  await salvarProjeto(p)
  return NextResponse.json({ projeto: p })
}
