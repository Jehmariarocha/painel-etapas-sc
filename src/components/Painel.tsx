'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CODES, ETAPAS_MODELO, MAX_RUN_HOURS, MAX_RUN_SECONDS, type Projeto, type Pessoa, type Etapa, type EventoLog, type PedidoPrazo } from '@/lib/tipos'
import {
  liveSeconds, fmtClock, fmtHours, fmtHoursNum, fmtTime, fmtDateTime, fmtDate, daysUntil,
  projectTotals, currentStage, startStage, stopRun, toggleDone, moveToStage, autoPauseStage,
  logDueChange, logDueReq, logDueOk, logDueRej, secondsByPersonForProject, workSessions,
} from '@/lib/painel-logic'

/* ---------------- cores da marca ---------------- */
const C = {
  amarelo: '#ffd600', ink: '#7a6200', soft: '#fffbe0', onAccent: '#1f1d18',
  done: '#2f7d53', doneSoft: '#e2f0e7', danger: '#c0392b', dangerSoft: '#fbe4e0',
  surf2: '#f4f2ec', linha: '#e5e1d6', muted: '#6c6a63', faint: '#9c988d',
}
const AV_COLORS: [string, string][] = [
  ['#fff3c4', '#6b5200'], ['#dcefe2', '#1f5e3a'], ['#e3e8ef', '#36465a'],
  ['#f3e0d6', '#7a4a2e'], ['#e7def0', '#4a3a6b'],
]
function initials(name: string) {
  const p = (name || '').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase()
}
function avColor(id: string): [string, string] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AV_COLORS[h % AV_COLORS.length]
}

type Modal =
  | { kind: 'new' }
  | { kind: 'team' }
  | { kind: 'resp'; projId: string }
  | { kind: 'start'; projId: string; code: string }
  | { kind: 'log'; projId: string; code: string }
  | { kind: 'prazoReq'; projId: string; code: string; to: string | null }
  | { kind: 'import' }
  | null

/** Pede permissão de notificação do navegador (1x), a partir de um clique. */
function pedirPermissaoNotificacao() {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  } catch {}
}

/** Dispara uma notificação de teste na hora (pra conferir se o Windows mostra). */
async function testarNotificacao() {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Este navegador não suporta notificações.')
      return
    }
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm === 'granted') {
      new Notification('⏰ Teste de aviso — Painel de Etapas', {
        body: 'Se você está vendo isto, as notificações do Windows funcionam!',
        icon: '/logo.png',
        requireInteraction: true,
      })
    } else {
      alert('As notificações estão bloqueadas. Libere no ícone ao lado do endereço (cadeado) → Notificações → Permitir.')
    }
  } catch (e) {
    alert('Não consegui disparar a notificação: ' + (e instanceof Error ? e.message : String(e)))
  }
}

/** Mostra uma notificação do sistema (Windows) avisando pra reativar. */
function notificarReativar(projeto: string, etapa: string) {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('⏰ Reative seu cronômetro', {
        body: `${projeto} · ${etapa} pausou após 1h. Reative se ainda estiver trabalhando.`,
        icon: '/logo.png',
        tag: 'reativar-cronometro',
        requireInteraction: true,
      })
    }
  } catch {}
}

export default function Painel({ email, papel }: { email: string; papel: 'dona' | 'equipe' }) {
  const ehDona = papel === 'dona'
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [equipe, setEquipe] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'detail' | 'report'>('board')
  const [openId, setOpenId] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [, setTick] = useState(0)
  // Alerta "reative o cronômetro" quando uma etapa pausa sozinha após 1h.
  const [alertaReativar, setAlertaReativar] = useState<{ projId: string; code: string; personId: string | null } | null>(null)
  const dragId = useRef<string | null>(null)
  const projetosRef = useRef(projetos)
  projetosRef.current = projetos
  // Espelho do modal para o polling saber se há interação em curso.
  const modalRef = useRef<Modal>(null)
  modalRef.current = modal
  // Momento da última gravação local, para o polling não atropelar.
  const lastPersistRef = useRef(0)
  // Qual pessoa da equipe é o usuário logado (casando pelo e-mail). Serve para
  // mandar o alerta de reativar só pra quem é dono do cronômetro.
  const minhaPessoaId = equipe.find((p) => p.email && p.email.toLowerCase() === email.toLowerCase())?.id ?? null
  const minhaPessoaIdRef = useRef<string | null>(null)
  minhaPessoaIdRef.current = minhaPessoaId

  const personById = useCallback((id: string | null) => equipe.find((p) => p.id === id) || null, [equipe])

  /* ---------------- carregar ---------------- */
  useEffect(() => {
    ;(async () => {
      try {
        const [rp, re] = await Promise.all([fetch('/api/projetos'), fetch('/api/equipe')])
        const dp = await rp.json()
        const de = await re.json()
        setProjetos(Array.isArray(dp.projetos) ? dp.projetos : [])
        setEquipe(Array.isArray(de.equipe) ? de.equipe : [])
      } catch {
        // deixa vazio; a tela mostra o estado vazio
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /* ---------------- tick + auto-pausa ---------------- */
  useEffect(() => {
    const t = setInterval(() => {
      let mudou: Projeto | null = null
      let pausou: { projId: string; code: string; personId: string | null } | null = null
      const atuais = projetosRef.current
      // Cada janela só pausa (e avisa sobre) os cronômetros da PRÓPRIA pessoa,
      // pra o aviso aparecer na tela de quem é o dono — não na de quem viu antes.
      for (const p of atuais) {
        for (const s of p.stages) {
          if (s.startedAt && s.startedBy === minhaPessoaIdRef.current) {
            const quem = s.startedBy // guarda antes do auto-pausa limpar
            if (autoPauseStage(s)) {
              mudou = p
              pausou = { projId: p.id, code: s.code, personId: quem }
            }
          }
        }
      }
      if (mudou) {
        setProjetos((atual) => atual.map((p) => (p.id === mudou!.id ? { ...mudou! } : p)))
        void persistir(mudou)
      }
      // Pediu reativação: só avisa a PESSOA dona do cronômetro (casada pelo
      // e-mail logado). Nas telas dos outros, nada aparece.
      if (pausou && pausou.personId === minhaPessoaIdRef.current) {
        setAlertaReativar((atual) => atual ?? pausou)
        const p = projetosRef.current.find((x) => x.id === pausou!.projId)
        const st = p?.stages.find((s) => s.code === pausou!.code)
        if (p && st) notificarReativar(p.name, `${st.code} ${st.name}`)
      }
      setTick((x) => x + 1)
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* -------- atualização automática: busca o que os outros fizeram -------- */
  useEffect(() => {
    const t = setInterval(async () => {
      // Não atualiza durante uma interação (modal aberto, arrastando um card),
      // para não atrapalhar. O cronômetro em curso continua (vem do servidor).
      if (modalRef.current || dragId.current) return
      if (Date.now() - lastPersistRef.current < 3000) return // ação local recente
      try {
        const [rp, re] = await Promise.all([fetch('/api/projetos'), fetch('/api/equipe')])
        const dp = await rp.json()
        const de = await re.json()
        if (Array.isArray(dp.projetos)) setProjetos(dp.projetos)
        if (Array.isArray(de.equipe)) setEquipe(de.equipe)
      } catch {
        // rede instável: tenta de novo no próximo ciclo
      }
    }, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- persistência ---------------- */
  async function persistir(p: Projeto) {
    // Marca a ação local: o polling não sobrescreve nos próximos segundos,
    // enquanto o servidor ainda não confirmou a gravação.
    lastPersistRef.current = Date.now()
    try {
      await fetch(`/api/projetos/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      })
      lastPersistRef.current = Date.now()
    } catch {
      /* mantém o estado local; numa próxima a gente trata reconexão */
    }
  }
  async function persistirEquipe(nova: Pessoa[]) {
    try {
      await fetch('/api/equipe', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe: nova }),
      })
    } catch {}
  }

  function mutar(projId: string, fn: (p: Projeto) => void) {
    // Calcula o projeto novo AGORA (fora do updater do setState), senão a
    // gravação roda antes do React montar o novo valor e nada é salvo.
    const atual = projetosRef.current.find((x) => x.id === projId)
    if (!atual) return
    const c: Projeto = structuredClone(atual)
    fn(c)
    setProjetos((lista) => lista.map((x) => (x.id === projId ? c : x)))
    void persistir(c)
  }

  // Um cronômetro por PESSOA: devolve os cronômetros que JÁ estão rodando
  // iniciados por esta pessoa (para pausá-los ao iniciar outro). Pessoas
  // diferentes rodam ao mesmo tempo sem se atrapalhar.
  function rodandoDaPessoa(personId: string | null): { projId: string; code: string }[] {
    const out: { projId: string; code: string }[] = []
    for (const p of projetosRef.current) {
      for (const s of p.stages) {
        if (s.startedAt && s.startedBy === personId) out.push({ projId: p.id, code: s.code })
      }
    }
    return out
  }

  /* ---------------- ações de etapa ---------------- */
  function iniciarEtapa(projId: string, code: string, personId: string | null) {
    const anteriores = rodandoDaPessoa(personId) // só os cronômetros DESSA pessoa
    const ids = new Set<string>([projId])
    anteriores.forEach((r) => ids.add(r.projId))
    // Clona os afetados AGORA (fora do updater), aplica e grava.
    const clones = new Map<string, Projeto>()
    for (const id of ids) {
      const orig = projetosRef.current.find((x) => x.id === id)
      if (orig) clones.set(id, structuredClone(orig))
    }
    // Pausa os cronômetros anteriores da MESMA pessoa (nunca os de outras).
    for (const r of anteriores) {
      const rs = clones.get(r.projId)?.stages.find((s) => s.code === r.code)
      if (rs) stopRun(rs, false)
    }
    const ts = clones.get(projId)?.stages.find((s) => s.code === code)
    if (ts) {
      if (ts.startedAt) stopRun(ts, false) // se já rodava (por outra pessoa), fecha a sessão antes
      startStage(ts, personId)
    }
    setProjetos((atual) => atual.map((p) => clones.get(p.id) || p))
    clones.forEach((c) => void persistir(c))
  }

  function requestStart(projId: string, code: string) {
    pedirPermissaoNotificacao() // aproveita o clique pra pedir permissão (1x)
    if (!equipe.length) {
      iniciarEtapa(projId, code, null)
      return
    }
    setModal({ kind: 'start', projId, code })
  }

  // Anti-burla: um cronômetro rodando só pode ser parado pela PRÓPRIA pessoa
  // que o iniciou — nem a dona para o dos outros. O teto de 1h cuida dos esquecidos.
  function podeParar(st: Etapa): boolean {
    return !st.startedAt || st.startedBy === minhaPessoaId
  }
  function avisarBloqueio(st: Etapa) {
    const n = personById(st.startedBy)?.name || 'outra pessoa'
    alert(`Este cronômetro é de ${n}. Só ${n} pode pausar.`)
  }

  function pausarEtapa(projId: string, code: string) {
    const st = projetosRef.current.find((x) => x.id === projId)?.stages.find((s) => s.code === code)
    if (st && !podeParar(st)) { avisarBloqueio(st); return }
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (s) stopRun(s, false)
    })
  }
  function concluirEtapa(projId: string, code: string) {
    const st = projetosRef.current.find((x) => x.id === projId)?.stages.find((s) => s.code === code)
    if (st && st.startedAt && !podeParar(st)) { avisarBloqueio(st); return }
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (s) toggleDone(s)
    })
  }
  function moverEtapa(projId: string, code: string) {
    const p0 = projetosRef.current.find((x) => x.id === projId)
    const bloqueada = p0?.stages.find((s) => s.startedAt && s.code !== code && !podeParar(s))
    if (bloqueada) { avisarBloqueio(bloqueada); return }
    mutar(projId, (p) => moveToStage(p, code))
  }
  function setPrevisto(projId: string, code: string, horas: number) {
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (s) s.estimated = Math.max(0, Number(horas) || 0)
    })
  }
  function setResponsavel(projId: string, code: string, pid: string) {
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (s) s.personId = pid || null
    })
  }
  // Prazo com aprovação: a dona muda direto (fica no histórico); a equipe não
  // muda — abre um pedido com justificativa pra dona aprovar/recusar.
  function aoMudarPrazo(projId: string, code: string, iso: string) {
    const proj = projetosRef.current.find((x) => x.id === projId)
    const s = proj?.stages.find((x) => x.code === code)
    if (!s) return
    const novo = iso || null
    const antigo = s.due || null
    if (novo === antigo) return
    // Dona muda direto. Equipe também pode DEFINIR a 1ª data (quando a etapa
    // ainda não tem prazo); depois disso, trocar só via pedido com aprovação.
    if (ehDona || !antigo) {
      mutar(projId, (p) => {
        const st = p.stages.find((x) => x.code === code)
        if (!st) return
        st.due = novo
        logDueChange(st, email, antigo, novo)
      })
    } else {
      setModal({ kind: 'prazoReq', projId, code, to: novo })
    }
  }

  function enviarPedidoPrazo(projId: string, code: string, to: string | null, reason: string) {
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (!s) return
      s.pendingDue = { to, by: email, at: Date.now(), reason }
      logDueReq(s, email, s.due || null, to, reason)
    })
    setModal(null)
  }

  function aprovarPrazo(projId: string, code: string) {
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (!s || !s.pendingDue) return
      const ped = s.pendingDue
      const antigo = s.due || null
      s.due = ped.to
      logDueOk(s, email, antigo, ped.to, ped.by)
      s.pendingDue = null
    })
  }

  function recusarPrazo(projId: string, code: string) {
    mutar(projId, (p) => {
      const s = p.stages.find((x) => x.code === code)
      if (!s || !s.pendingDue) return
      logDueRej(s, email, s.pendingDue.to, s.pendingDue.by)
      s.pendingDue = null
    })
  }
  function setResponsaveisProjeto(projId: string, ids: string[]) {
    mutar(projId, (p) => {
      p.people = ids
    })
  }

  /* ---------------- projetos ---------------- */
  async function criarProjeto(name: string, client: string, people: string[]) {
    const r = await fetch('/api/projetos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, client, people }),
    })
    const d = await r.json()
    if (d.projeto) {
      setProjetos((atual) => [d.projeto, ...atual])
      setModal(null)
      setOpenId(d.projeto.id)
      setView('detail')
    }
  }
  async function excluirProjeto(projId: string) {
    setProjetos((atual) => atual.filter((p) => p.id !== projId))
    if (openId === projId) {
      setView('board')
      setOpenId(null)
    }
    try {
      await fetch(`/api/projetos/${projId}`, { method: 'DELETE' })
    } catch {}
  }

  async function importar(texto: string): Promise<{ ok: boolean; msg: string }> {
    let dados: unknown
    try {
      dados = JSON.parse(texto)
    } catch {
      return { ok: false, msg: 'JSON inválido — copie de novo do protótipo.' }
    }
    try {
      const r = await fetch('/api/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string }
        return { ok: false, msg: e.error || 'Falha ao importar.' }
      }
      const d = (await r.json()) as { importados: number; pessoas: number }
      const [rp, re] = await Promise.all([fetch('/api/projetos'), fetch('/api/equipe')])
      const dp = await rp.json()
      const de = await re.json()
      setProjetos(Array.isArray(dp.projetos) ? dp.projetos : [])
      setEquipe(Array.isArray(de.equipe) ? de.equipe : [])
      return { ok: true, msg: `Importados ${d.importados} projeto(s) e ${d.pessoas} pessoa(s).` }
    } catch {
      return { ok: false, msg: 'Erro de rede ao importar.' }
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}
    window.location.href = '/login'
  }

  /* ================= render ================= */
  const projeto = openId ? projetos.find((p) => p.id === openId) || null : null

  return (
    <div className="min-h-screen">
      <Header
        email={email}
        vinculo={equipe.find((p) => p.id === minhaPessoaId)?.name ?? null}
        onNovo={() => setModal({ kind: 'new' })}
        onEquipe={() => setModal({ kind: 'team' })}
        onRelatorio={() => setView('report')}
        onLogout={logout}
      />
      <main className="mx-auto w-full max-w-[1600px] px-4 py-6">
        {loading ? (
          <p className="text-sm" style={{ color: C.muted }}>Carregando…</p>
        ) : view === 'report' ? (
          <Relatorio projetos={projetos} onVoltar={() => setView('board')} ehDona={ehDona} equipe={equipe} />
        ) : view === 'detail' && projeto ? (
          <Detalhe
            projeto={projeto}
            equipe={equipe}
            personById={personById}
            onVoltar={() => { setView('board'); setOpenId(null) }}
            onPlay={(code) => requestStart(projeto.id, code)}
            onPause={(code) => pausarEtapa(projeto.id, code)}
            onDone={(code) => concluirEtapa(projeto.id, code)}
            onPrevisto={(code, h) => setPrevisto(projeto.id, code, h)}
            onResponsavel={(code, pid) => setResponsavel(projeto.id, code, pid)}
            onPrazo={(code, iso) => aoMudarPrazo(projeto.id, code, iso)}
            ehDona={ehDona}
            minhaPessoaId={minhaPessoaId}
            onAprovarPrazo={(code) => aprovarPrazo(projeto.id, code)}
            onRecusarPrazo={(code) => recusarPrazo(projeto.id, code)}
            onEditResp={() => setModal({ kind: 'resp', projId: projeto.id })}
            onLog={(code) => setModal({ kind: 'log', projId: projeto.id, code })}
            onExcluir={() => excluirProjeto(projeto.id)}
          />
        ) : (
          <Quadro
            projetos={projetos}
            personById={personById}
            onImportar={() => setModal({ kind: 'import' })}
            onAbrir={(id) => { setOpenId(id); setView('detail') }}
            onPlayPause={(p) => {
              const rodando = p.stages.find((s) => s.startedAt)
              if (rodando) pausarEtapa(p.id, rodando.code)
              else {
                const cur = currentStage(p)
                if (cur) requestStart(p.id, cur.code)
              }
            }}
            onExcluir={(id) => excluirProjeto(id)}
            onDropMover={(projId, code) => moverEtapa(projId, code)}
            dragId={dragId}
            minhaPessoaId={minhaPessoaId}
          />
        )}
      </main>

      {modal?.kind === 'new' && (
        <NovoProjetoModal
          equipe={equipe}
          onFechar={() => setModal(null)}
          onCriar={criarProjeto}
        />
      )}
      {modal?.kind === 'team' && (
        <EquipeModal
          equipe={equipe}
          ehDona={ehDona}
          onFechar={() => setModal(null)}
          onSalvar={(nova) => { setEquipe(nova); void persistirEquipe(nova) }}
        />
      )}
      {modal?.kind === 'resp' && (() => {
        const p = projetos.find((x) => x.id === modal.projId)
        if (!p) return null
        return (
          <RespModal
            titulo={p.name}
            equipe={equipe}
            selecionados={p.people || []}
            onFechar={() => setModal(null)}
            onSalvar={(ids) => { setResponsaveisProjeto(p.id, ids); setModal(null) }}
          />
        )
      })()}
      {modal?.kind === 'start' && (() => {
        const p = projetos.find((x) => x.id === modal.projId)
        const st = p?.stages.find((s) => s.code === modal.code)
        if (!p || !st) return null
        return (
          <QuemIniciaModal
            etapa={st.name}
            equipe={equipe}
            padrao={st.personId}
            onFechar={() => setModal(null)}
            onIniciar={(pid) => { iniciarEtapa(p.id, st.code, pid); setModal(null) }}
          />
        )
      })()}
      {modal?.kind === 'log' && (() => {
        const p = projetos.find((x) => x.id === modal.projId)
        const st = p?.stages.find((s) => s.code === modal.code)
        if (!p || !st) return null
        return <LogModal etapa={st} personById={personById} onFechar={() => setModal(null)} />
      })()}
      {modal?.kind === 'prazoReq' && (() => {
        const p = projetos.find((x) => x.id === modal.projId)
        const st = p?.stages.find((s) => s.code === modal.code)
        if (!p || !st) return null
        return (
          <PedirPrazoModal
            etapa={st}
            to={modal.to}
            onFechar={() => setModal(null)}
            onEnviar={(reason) => enviarPedidoPrazo(modal.projId, modal.code, modal.to, reason)}
          />
        )
      })()}
      {modal?.kind === 'import' && (
        <ImportModal onFechar={() => setModal(null)} onImportar={importar} />
      )}
      {alertaReativar && (() => {
        const p = projetos.find((x) => x.id === alertaReativar.projId)
        const st = p?.stages.find((s) => s.code === alertaReativar.code)
        if (!p || !st) return null
        return (
          <ReativarModal
            projeto={p.name}
            etapa={`${st.code} ${st.name}`}
            onReativar={() => { iniciarEtapa(alertaReativar.projId, alertaReativar.code, alertaReativar.personId); setAlertaReativar(null) }}
            onFechar={() => setAlertaReativar(null)}
          />
        )
      })()}
    </div>
  )
}

/* ================= Cabeçalho ================= */
function Header({
  email, vinculo, onNovo, onEquipe, onRelatorio, onLogout,
}: {
  email: string
  vinculo: string | null
  onNovo: () => void
  onEquipe: () => void
  onRelatorio: () => void
  onLogout: () => void
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-white no-print" style={{ borderColor: C.linha }}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="1COMODO" className="h-10 w-auto rounded" />
        <div className="min-w-0 border-l pl-3" style={{ borderColor: C.linha }}>
          <h1 className="text-xl font-bold leading-tight tracking-tight">Painel de Etapas de Projeto</h1>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.faint }}>
            Arquitetura · Urbanismo · Construção
          </p>
        </div>
        <span className="flex-1" />
        <span className="hidden text-xs sm:flex sm:flex-col sm:items-end sm:leading-tight" style={{ color: C.faint }}>
          <span>{email}</span>
          <span style={{ color: vinculo ? C.ink : C.danger }}>{vinculo ? `você é: ${vinculo}` : '⚠ login não vinculado a ninguém'}</span>
        </span>
        <button className="btn-primary" onClick={onNovo}>+ Novo projeto</button>
        <button className="btn" onClick={onEquipe}>Equipe</button>
        <button className="btn" onClick={onRelatorio}>Relatório</button>
        <button className="btn-ghost" onClick={onLogout}>Sair</button>
      </div>
      <style jsx>{`
        .btn {
          border: 1px solid ${C.linha}; background: ${C.surf2}; color: #1a1a1a;
          border-radius: 9px; padding: 7px 12px; font-size: 13px; font-weight: 600; white-space: nowrap;
        }
        .btn:hover { border-color: ${C.ink}; }
        .btn-ghost {
          background: transparent; border: 1px solid transparent; color: ${C.muted};
          border-radius: 9px; padding: 7px 10px; font-size: 13px; font-weight: 600;
        }
        .btn-ghost:hover { color: #1a1a1a; background: ${C.surf2}; }
        .btn-primary {
          background: ${C.amarelo}; border: 1px solid ${C.amarelo}; color: ${C.onAccent};
          border-radius: 9px; padding: 7px 14px; font-size: 13px; font-weight: 700; white-space: nowrap;
        }
        .btn-primary:hover { filter: brightness(1.05); }
      `}</style>
    </header>
  )
}

/* ================= Avatares / responsáveis ================= */
function Avatar({ pessoa, sm }: { pessoa: Pessoa; sm?: boolean }) {
  const [bg, fg] = avColor(pessoa.id)
  const size = sm ? 19 : 22
  return (
    <span
      title={pessoa.name + (pessoa.role ? ' — ' + pessoa.role : '')}
      style={{
        background: bg, color: fg, width: size, height: size, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: sm ? 9 : 9.5, fontWeight: 700, border: '2px solid #fff', flex: 'none',
      }}
    >
      {initials(pessoa.name) || '?'}
    </span>
  )
}
function Avatares({ ids, personById }: { ids: string[]; personById: (id: string) => Pessoa | null }) {
  const ps = ids.map((id) => personById(id)).filter(Boolean) as Pessoa[]
  if (!ps.length) return null
  return (
    <span style={{ display: 'inline-flex' }}>
      {ps.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -6 : 0 }}>
          <Avatar pessoa={p} />
        </span>
      ))}
    </span>
  )
}

/* ================= Quadro (kanban) ================= */
function Quadro({
  projetos, personById, onImportar, onAbrir, onPlayPause, onExcluir, onDropMover, dragId, minhaPessoaId,
}: {
  projetos: Projeto[]
  personById: (id: string) => Pessoa | null
  onImportar: () => void
  onAbrir: (id: string) => void
  onPlayPause: (p: Projeto) => void
  onExcluir: (id: string) => void
  onDropMover: (projId: string, code: string) => void
  dragId: React.MutableRefObject<string | null>
  minhaPessoaId: string | null
}) {
  const [over, setOver] = useState<string | null>(null)
  const colunas = [
    ...ETAPAS_MODELO.map((e) => ({ code: e.code, name: e.name })),
    { code: '__done', name: 'Concluído' },
  ]
  const porColuna = new Map<string, Projeto[]>()
  colunas.forEach((c) => porColuna.set(c.code, []))
  for (const p of projetos) {
    const cur = currentStage(p)
    const code = cur ? cur.code : '__done'
    ;(porColuna.get(code) || porColuna.get('LV')!).push(p)
  }
  const rodando = projetos.some((p) => p.stages.some((s) => s.startedAt))

  if (!projetos.length) {
    return (
      <div className="rounded-xl border p-10 text-center" style={{ borderColor: C.linha }}>
        <h3 className="text-lg font-bold">Nenhum projeto ainda</h3>
        <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: C.muted }}>
          Crie o primeiro projeto para acompanhar as etapas, ou traga os projetos do protótipo.
        </p>
        <button
          onClick={onImportar}
          className="mt-4 rounded-lg border px-3.5 py-2 text-sm font-semibold"
          style={{ borderColor: C.linha }}
        >
          ↓ Importar do protótipo
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold" style={{ color: C.muted }}>Quadro de etapas</h2>
        <span className="tnum text-[13px]" style={{ color: C.faint }}>{projetos.length} projetos</span>
      </div>
      <p className="mb-3 text-[12.5px]" style={{ color: C.muted }}>
        Arraste o card entre as colunas para mudar a etapa. ▶ inicia o cronômetro; clique no card para abrir o projeto.
      </p>
      <div className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin">
        {colunas.map((c) => {
          const lista = porColuna.get(c.code) || []
          const done = c.code === '__done'
          return (
            <div
              key={c.code}
              onDragOver={(e) => { e.preventDefault(); setOver(c.code) }}
              onDragLeave={() => setOver((o) => (o === c.code ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const id = dragId.current
                if (id) onDropMover(id, c.code)
              }}
              className="flex min-h-[130px] flex-[1_1_0] flex-col rounded-xl border max-[900px]:w-[210px] max-[900px]:flex-none"
              style={{
                minWidth: 0,
                background: over === c.code ? C.soft : C.surf2,
                borderColor: over === c.code ? C.ink : C.linha,
              }}
            >
              <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                <span
                  className="tnum rounded-md border px-[7px] py-0.5 text-[12px] font-semibold"
                  style={{ color: done ? C.done : C.ink, background: '#fff', borderColor: C.linha }}
                >
                  {done ? '✓' : c.code}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-semibold">{c.name}</span>
                <span className="tnum text-[12px]" style={{ color: C.faint }}>{lista.length}</span>
              </div>
              <div className="flex flex-col gap-2.5 px-2.5 pb-3">
                {lista.length === 0 ? (
                  <div className="py-1.5 text-center text-base" style={{ color: C.linha }}>·</div>
                ) : (
                  lista.map((p) => (
                    <Card
                      key={p.id}
                      projeto={p}
                      personById={personById}
                      onAbrir={() => onAbrir(p.id)}
                      onPlayPause={() => onPlayPause(p)}
                      onExcluir={() => onExcluir(p.id)}
                      dragId={dragId}
                      minhaPessoaId={minhaPessoaId}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
      {rodando && null}
    </div>
  )
}

function Card({
  projeto: p, personById, onAbrir, onPlayPause, onExcluir, dragId, minhaPessoaId,
}: {
  projeto: Projeto
  personById: (id: string) => Pessoa | null
  onAbrir: () => void
  onPlayPause: () => void
  onExcluir: () => void
  dragId: React.MutableRefObject<string | null>
  minhaPessoaId: string | null
}) {
  const t = projectTotals(p)
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0
  const rodandoEtapa = p.stages.find((s) => s.startedAt)
  const cur = currentStage(p)
  // Cronômetro rodando de OUTRA pessoa: ninguém além da própria pausa (nem a dona).
  const travado = !!rodandoEtapa && rodandoEtapa.startedBy !== minhaPessoaId

  const respNomes = (p.people || [])
    .map((id) => {
      const pp = personById(id)
      if (!pp) return ''
      const fn = pp.name.split(' ')[0]
      return pp.role ? `${fn} · ${pp.role}` : fn
    })
    .filter(Boolean)
    .join(', ')

  let runWho = ''
  if (rodandoEtapa) {
    const w = rodandoEtapa.startedBy ? personById(rodandoEtapa.startedBy) : null
    runWho = w ? w.name.split(' ')[0] : ''
  }

  // prazo
  let dueOver: { c: string; d: number; due: string } | null = null
  let dueSoon: { c: string; d: number; due: string } | null = null
  for (const s of p.stages) {
    if (s.due && s.status !== 'concluida') {
      const d = daysUntil(s.due)
      if (d === null) continue
      if (d < 0) { if (!dueOver || d < dueOver.d) dueOver = { c: s.code, d, due: s.due } }
      else if (d <= 3) { if (!dueSoon || d < dueSoon.d) dueSoon = { c: s.code, d, due: s.due } }
    }
  }

  return (
    <div
      draggable
      onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { dragId.current = null }}
      onClick={onAbrir}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onAbrir() } }}
      className="relative flex cursor-grab flex-col gap-[7px] rounded-[10px] border bg-white p-3 shadow-sm active:cursor-grabbing"
      style={{ borderColor: C.linha }}
    >
      <button
        aria-label={`Excluir ${p.name}`}
        title="Excluir projeto"
        onClick={(e) => { e.stopPropagation(); if (confirm(`Excluir “${p.name}” e todas as horas registradas?`)) onExcluir() }}
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md text-sm"
        style={{ color: C.faint }}
      >
        ✕
      </button>
      {p.example && (
        <span className="self-start rounded-[5px] border px-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.faint, borderColor: C.linha }}>
          exemplo
        </span>
      )}
      <div className="pr-5 text-[15px] font-bold leading-tight tracking-tight">{p.name}</div>
      {p.client && <div className="-mt-1 text-[12px]" style={{ color: C.muted }}>{p.client}</div>}
      {(p.people || []).length > 0 && (
        <div className="flex items-start gap-[7px]">
          <Avatares ids={p.people} personById={personById} />
          <span className="min-w-0 text-[12px] leading-[1.35]" style={{ color: C.muted }}>{respNomes}</span>
        </div>
      )}
      {rodandoEtapa && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.ink }}>
          <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-full" style={{ background: C.ink }} />
          {runWho ? `${runWho} cronometrando` : 'cronômetro ativo'}
        </span>
      )}
      {dueOver ? (
        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: C.danger }}>
          ⚠ {dueOver.c} atrasada · {fmtDate(dueOver.due)}
        </span>
      ) : dueSoon ? (
        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: C.ink }}>
          ⏳ {dueSoon.c} vence {dueSoon.d === 0 ? 'hoje' : `em ${dueSoon.d}d`}
        </span>
      ) : null}
      <div className="h-1.5 overflow-hidden rounded" style={{ background: C.surf2 }}>
        <i className="block h-full" style={{ width: `${pct}%`, background: C.done }} />
      </div>
      <div className="flex items-center justify-between border-t pt-[7px] text-[12.5px]" style={{ borderColor: C.linha, color: C.muted }}>
        <span className="tnum">{fmtHours(t.real)}</span>
        <span className="flex items-center gap-2.5">
          <span className="tnum">{t.done}/{t.total}</span>
          {cur && (
            <button
              aria-label={rodandoEtapa ? `Pausar ${p.name}` : `Iniciar cronômetro de ${p.name}`}
              title={travado ? 'Cronômetro de outra pessoa — só ela pausa' : rodandoEtapa ? 'Pausar' : `Iniciar ${cur.code}`}
              onClick={(e) => { e.stopPropagation(); if (!travado) onPlayPause() }}
              disabled={travado}
              className="grid h-[30px] w-9 place-items-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: C.amarelo, borderColor: C.amarelo, color: C.onAccent }}
            >
              {rodandoEtapa ? '⏸' : '▶'}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

/* ================= Detalhe do projeto ================= */
function Detalhe({
  projeto: p, equipe, personById, onVoltar, onPlay, onPause, onDone, onPrevisto, onResponsavel, onPrazo, ehDona, minhaPessoaId, onAprovarPrazo, onRecusarPrazo, onEditResp, onLog, onExcluir,
}: {
  projeto: Projeto
  equipe: Pessoa[]
  personById: (id: string) => Pessoa | null
  onVoltar: () => void
  onPlay: (code: string) => void
  onPause: (code: string) => void
  onDone: (code: string) => void
  onPrevisto: (code: string, h: number) => void
  onResponsavel: (code: string, pid: string) => void
  onPrazo: (code: string, iso: string) => void
  ehDona: boolean
  minhaPessoaId: string | null
  onAprovarPrazo: (code: string) => void
  onRecusarPrazo: (code: string) => void
  onEditResp: () => void
  onLog: (code: string) => void
  onExcluir: () => void
}) {
  const t = projectTotals(p)
  const saldo = t.est ? t.real - t.est : null
  const saldoCor = saldo === null ? C.muted : saldo > 0 ? C.ink : C.done
  const saldoTxt =
    saldo === null ? '—' : `${saldo > 0 ? '+' : ''}${(saldo / 3600).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`

  return (
    <div>
      <button className="mb-3 text-sm font-semibold" style={{ color: C.muted }} onClick={onVoltar}>← Projetos</button>
      <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold tracking-tight">{p.name}</h2>
          {p.client && <div className="text-sm" style={{ color: C.muted }}>{p.client}</div>}
        </div>
        <div className="flex items-center gap-2.5">
          {(p.people || []).length > 0 ? (
            <>
              <Avatares ids={p.people} personById={personById} />
              <span className="text-[12px]" style={{ color: C.muted }}>
                {(p.people || []).map((id) => { const pp = personById(id); return pp ? pp.name + (pp.role ? ` (${pp.role})` : '') : '' }).filter(Boolean).join(', ')}
              </span>
            </>
          ) : (
            <span className="text-[12px]" style={{ color: C.faint }}>sem responsável</span>
          )}
          <button className="rounded-lg px-2 py-1 text-[13px] font-semibold" style={{ color: C.muted }} onClick={onEditResp}>Responsáveis</button>
        </div>
        <button className="rounded-lg border px-2.5 py-1 text-[13px] font-semibold" style={{ borderColor: C.linha, color: C.danger }} onClick={() => { if (confirm(`Excluir “${p.name}”?`)) onExcluir() }}>
          Excluir projeto
        </button>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2.5 max-[560px]:grid-cols-2">
        <Stat cap="Trabalhadas" big={fmtHours(t.real)} sub={`de ${fmtHours(t.est)} previstas`} />
        <Stat cap="Saldo" big={saldoTxt} bigColor={saldoCor} sub={saldo && saldo > 0 ? 'acima do previsto' : saldo && saldo < 0 ? 'dentro do previsto' : 'no previsto'} />
        <Stat cap="Progresso" big={`${t.done}/${t.total}`} sub="etapas concluídas" />
      </div>

      <div className="flex flex-col gap-2.5">
        {p.stages.map((st) => (
          <LinhaEtapa
            key={st.code}
            st={st}
            equipe={equipe}
            personById={personById}
            onPlay={() => onPlay(st.code)}
            onPause={() => onPause(st.code)}
            onDone={() => onDone(st.code)}
            onPrevisto={(h) => onPrevisto(st.code, h)}
            onResponsavel={(pid) => onResponsavel(st.code, pid)}
            onPrazo={(iso) => onPrazo(st.code, iso)}
            ehDona={ehDona}
            onAprovarPrazo={() => onAprovarPrazo(st.code)}
            onRecusarPrazo={() => onRecusarPrazo(st.code)}
            onLog={() => onLog(st.code)}
            travado={!!st.startedAt && st.startedBy !== minhaPessoaId}
          />
        ))}
      </div>
    </div>
  )
}

function Stat({ cap, big, sub, bigColor }: { cap: string; big: string; sub: string; bigColor?: string }) {
  return (
    <div className="rounded-[10px] border bg-white px-3.5 py-3" style={{ borderColor: C.linha }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: C.faint }}>{cap}</div>
      <div className="tnum mt-0.5 text-[22px] font-semibold" style={{ color: bigColor }}>{big}</div>
      <div className="mt-0.5 text-[12px]" style={{ color: C.muted }}>{sub}</div>
    </div>
  )
}

function LinhaEtapa({
  st, equipe, personById, onPlay, onPause, onDone, onPrevisto, onResponsavel, onPrazo, ehDona, onAprovarPrazo, onRecusarPrazo, onLog, travado,
}: {
  st: Etapa
  equipe: Pessoa[]
  personById: (id: string) => Pessoa | null
  onPlay: () => void
  onPause: () => void
  onDone: () => void
  onPrevisto: (h: number) => void
  onResponsavel: (pid: string) => void
  onPrazo: (iso: string) => void
  ehDona: boolean
  onAprovarPrazo: () => void
  onRecusarPrazo: () => void
  onLog: () => void
  travado: boolean
}) {
  const sec = liveSeconds(st)
  const rodando = !!st.startedAt
  const stLabel = { pendente: 'Pendente', andamento: 'Em andamento', concluida: 'Concluída' }[st.status]
  const du = st.due ? daysUntil(st.due) : null
  const over = st.due && st.status !== 'concluida' && du !== null && du < 0
  const soon = st.due && st.status !== 'concluida' && du !== null && du >= 0 && du <= 2
  const resp = st.personId ? personById(st.personId) : null
  const codeColor = st.status === 'concluida' ? C.done : st.status === 'andamento' ? C.ink : C.ink
  const codeBg = st.status === 'concluida' ? C.doneSoft : st.status === 'andamento' ? C.soft : C.soft

  return (
    <div
      className="grid items-center gap-x-3.5 gap-y-1 rounded-xl border bg-white px-3.5 py-3 shadow-sm"
      style={{
        gridTemplateColumns: '44px 1fr auto',
        borderColor: over ? C.danger : st.status === 'andamento' ? C.amarelo : C.linha,
        background: st.status === 'andamento' ? 'linear-gradient(0deg, #fffbe0, transparent 60%)' : '#fff',
      }}
    >
      <div className="rounded-md py-2 text-center text-[13px] font-semibold tnum" style={{ color: codeColor, background: codeBg }}>
        {st.code}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold">
          {resp && <Avatar pessoa={resp} sm />}
          {st.name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px]" style={{ color: C.muted }}>
          {rodando && (
            <span className="font-semibold" style={{ color: C.ink }}>
              ▶ {st.startedBy ? personById(st.startedBy)?.name || '—' : '—'} desde {st.startedAt ? fmtTime(st.startedAt) : ''}
            </span>
          )}
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: st.status === 'concluida' ? C.done : st.status === 'andamento' ? C.ink : C.faint }}>
            {stLabel}
          </span>
          <label className="flex items-center gap-1">
            Previsto:
            <input
              type="number" min={0} step={0.5} defaultValue={st.estimated || 0}
              onBlur={(e) => onPrevisto(Number(e.target.value))}
              className="w-14 rounded-md border px-1.5 py-0.5 text-right tnum"
              style={{ borderColor: C.linha, background: C.surf2 }}
            /> h
          </label>
          <label className="flex items-center gap-1">
            Resp.:
            <select
              value={st.personId || ''}
              onChange={(e) => onResponsavel(e.target.value)}
              className="max-w-[150px] rounded-md border px-1 py-0.5"
              style={{ borderColor: C.linha, background: C.surf2 }}
            >
              <option value="">—</option>
              {equipe.map((pp) => (
                <option key={pp.id} value={pp.id}>{pp.name}{pp.role ? ` · ${pp.role}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Prazo:
            <input
              // Age só quando termina de preencher (onBlur), não a cada tecla —
              // senão ao digitar o ano (ex.: "2" de 2026) dispararia como 0002.
              // `key` remonta o campo quando a data/pedido muda, pra refletir o estado.
              key={`${st.code}-${st.due ?? 'x'}-${st.pendingDue?.at ?? 0}`}
              type="date" defaultValue={st.due || ''}
              onBlur={(e) => onPrazo(e.target.value)}
              title={ehDona ? 'Alterar prazo' : st.due ? 'Pedir mudança de prazo (precisa de aprovação)' : 'Definir prazo'}
              className="rounded-md border px-1.5 py-0.5 tnum"
              style={{ borderColor: C.linha, background: C.surf2 }}
            />
            {!ehDona && st.due && <span title="Mudança de prazo precisa de aprovação" style={{ color: C.faint }}>🔒</span>}
          </label>
          {over && (
            <span className="rounded-[5px] px-1.5 py-px text-[11px] font-bold uppercase" style={{ color: C.danger, background: C.dangerSoft }}>vencida</span>
          )}
          {soon && (
            <span className="rounded-[5px] px-1.5 py-px text-[11px] font-bold uppercase" style={{ color: C.ink, background: C.soft }}>
              {du === 0 ? 'vence hoje' : `vence em ${du}d`}
            </span>
          )}
          {st.pendingDue && (
            <PedidoPendente pedido={st.pendingDue} due={st.due} ehDona={ehDona} onAprovar={onAprovarPrazo} onRecusar={onRecusarPrazo} />
          )}
        </div>
      </div>
      <div className="col-[3] flex items-center gap-3 max-[560px]:col-[1/-1] max-[560px]:mt-1 max-[560px]:justify-between max-[560px]:border-t max-[560px]:pt-2.5">
        <div className="tnum min-w-[92px] text-right text-[19px] font-semibold" style={{ color: st.status === 'andamento' ? C.ink : undefined }}>
          {fmtClock(sec)}
        </div>
        <div className="flex gap-1.5">
          <IconBtn
            title={rodando && travado ? 'Cronômetro de outra pessoa — só ela pausa' : rodando ? 'Pausar' : 'Iniciar'}
            onClick={rodando ? onPause : onPlay}
            disabled={rodando && travado}
            style={{ background: C.amarelo, borderColor: C.amarelo, color: C.onAccent }}
          >
            {rodando ? '⏸' : '▶'}
          </IconBtn>
          <IconBtn
            title={rodando && travado ? 'Cronômetro de outra pessoa' : st.status === 'concluida' ? 'Reabrir' : 'Concluir'}
            onClick={onDone}
            disabled={rodando && travado}
            style={st.status === 'concluida' ? { background: C.done, borderColor: C.done, color: '#fff' } : undefined}
          >
            ✓
          </IconBtn>
          <IconBtn title="Histórico" onClick={onLog}>⏱</IconBtn>
        </div>
      </div>
    </div>
  )
}

function IconBtn({ children, onClick, title, style, disabled }: { children: React.ReactNode; onClick: () => void; title: string; style?: React.CSSProperties; disabled?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-[38px] w-[38px] place-items-center rounded-lg border text-base disabled:cursor-not-allowed disabled:opacity-40"
      style={{ borderColor: C.linha, background: C.surf2, color: '#1a1a1a', ...style }}
    >
      {children}
    </button>
  )
}

/** Mostra um pedido de mudança de prazo pendente; a dona aprova/recusa aqui. */
function PedidoPendente({ pedido, due, ehDona, onAprovar, onRecusar }: { pedido: PedidoPrazo; due: string | null; ehDona: boolean; onAprovar: () => void; onRecusar: () => void }) {
  const alvo = pedido.to ? fmtDate(pedido.to) : 'sem prazo'
  const atual = due ? fmtDate(due) : 'sem prazo'
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 text-[12px]" style={{ background: C.soft, border: `1px solid ${C.amarelo}`, color: C.ink }}>
      <span>⏳ Pedido: {atual} → <b>{alvo}</b></span>
      <span style={{ color: C.muted }}>· {pedido.by}</span>
      {pedido.reason && <span style={{ color: C.muted }}>· “{pedido.reason}”</span>}
      {ehDona ? (
        <span className="flex gap-1">
          <button onClick={onAprovar} className="rounded px-2 py-0.5 font-semibold" style={{ background: C.done, color: '#fff' }}>✓ Aprovar</button>
          <button onClick={onRecusar} className="rounded px-2 py-0.5 font-semibold" style={{ background: C.dangerSoft, color: C.danger }}>✗ Recusar</button>
        </span>
      ) : (
        <span style={{ color: C.muted }}>· aguardando aprovação</span>
      )}
    </div>
  )
}

/** Modal onde a equipe escreve a justificativa do pedido de mudança de prazo. */
function PedirPrazoModal({ etapa, to, onFechar, onEnviar }: { etapa: Etapa; to: string | null; onFechar: () => void; onEnviar: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const alvo = to ? fmtDate(to) : 'remover o prazo'
  const atual = etapa.due ? fmtDate(etapa.due) : 'sem prazo'
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Pedir mudança de prazo</h3>
      <p className="mb-3 text-[13px]" style={{ color: C.muted }}>
        {etapa.code} {etapa.name}: <b>{atual}</b> → <b>{alvo}</b>. O pedido vai para aprovação da responsável.
      </p>
      <label className="text-[13px] font-semibold">Justificativa</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Por que o prazo precisa mudar?"
        className="mt-1 w-full rounded-md border px-2 py-1.5 text-[13px]"
        style={{ borderColor: C.linha, background: C.surf2 }}
      />
      <div className="mt-4 flex justify-end gap-2.5">
        <button className="btn2" onClick={onFechar}>Cancelar</button>
        <button className="btn2-primary" disabled={!reason.trim()} style={{ opacity: reason.trim() ? 1 : 0.5 }} onClick={() => onEnviar(reason.trim())}>Enviar pedido</button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

/** Alerta anti-burla: o cronômetro pausou sozinho após 1h e pede reativação. */
function ReativarModal({ projeto, etapa, onReativar, onFechar }: { projeto: string; etapa: string; onReativar: () => void; onFechar: () => void }) {
  const [perm, setPerm] = useState<string>(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported')
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">⏰ Ainda está trabalhando?</h3>
      <p className="mb-3 text-[13px]" style={{ color: C.muted }}>
        O cronômetro de <b>{projeto} · {etapa}</b> pausou sozinho. Reative para continuar contando o tempo.
      </p>
      {perm === 'granted' && (
        <p className="mb-1 text-[12px]" style={{ color: C.muted }}>🔔 Avisos do Windows ativos — eles aparecem quando você está <b>fora</b> desta aba (em outro programa).</p>
      )}
      {perm === 'default' && (
        <button
          className="mb-1 rounded-md px-2 py-1 text-[12.5px] font-semibold"
          style={{ background: C.soft, color: C.ink }}
          onClick={async () => { try { setPerm(await Notification.requestPermission()) } catch {} }}
        >🔔 Ativar avisos do Windows
        </button>
      )}
      {perm === 'denied' && (
        <p className="mb-1 text-[12px]" style={{ color: C.danger }}>🔔 Avisos bloqueados. Libere no ícone ao lado do endereço (cadeado) → Notificações → Permitir.</p>
      )}
      <div className="mt-4 flex justify-end gap-2.5">
        <button className="btn2" onClick={onFechar}>Agora não</button>
        <button className="btn2-primary" onClick={onReativar}>Reativar</button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

/* ================= Relatório ================= */
function Relatorio({ projetos, onVoltar, ehDona, equipe }: { projetos: Projeto[]; onVoltar: () => void; ehDona: boolean; equipe: Pessoa[] }) {
  const [gerando, setGerando] = useState(false)
  const hc = (sec: number) => (sec > 0 ? (sec / 3600).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '·')
  const nome = (id: string | null) => { const pp = equipe.find((x) => x.id === id); return pp ? pp.name : '—' }
  const saldo = (real: number, est: number) => {
    if (!est) return { txt: '·', cor: C.muted }
    const d = (real - est) / 3600
    return { txt: `${d > 0 ? '+' : ''}${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`, cor: d > 0.05 ? C.ink : d < -0.05 ? C.done : C.muted }
  }
  let gReal = 0
  let gEst = 0
  const colTot = CODES.map(() => 0)
  const linhas = projetos.map((p) => {
    const t = projectTotals(p)
    gReal += t.real
    gEst += t.est
    const cells = CODES.map((code, i) => {
      const s = p.stages.find((x) => x.code === code)
      const sec = s ? liveSeconds(s) : 0
      colTot[i] += sec
      return sec
    })
    return { p, t, cells, sd: saldo(t.real, t.est) }
  })
  const totalReal = colTot.reduce((a, b) => a + b, 0)
  const gsd = saldo(gReal, gEst)

  async function exportarPdf() {
    const alvo = document.getElementById('report-doc')
    if (!alvo) return
    setGerando(true)
    try {
      const mod = (await import('html2pdf.js')) as unknown as { default: (...a: unknown[]) => { set: (o: unknown) => { from: (e: HTMLElement) => { save: () => Promise<void> } } } }
      const html2pdf = mod.default
      await html2pdf()
        .set({
          margin: 8,
          filename: `Relatorio-horas-${new Date().toISOString().slice(0, 10)}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 980 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        })
        .from(alvo)
        .save()
    } catch {
      alert('Não consegui gerar o PDF aqui. Use Ctrl+P como alternativa.')
    } finally {
      setGerando(false)
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2.5">
        <button className="text-sm font-semibold" style={{ color: C.muted }} onClick={onVoltar}>← Projetos</button>
        {projetos.length > 0 && (
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold no-print" style={{ borderColor: C.linha }} onClick={exportarPdf} disabled={gerando}>
            {gerando ? 'Gerando…' : '↓ Exportar PDF'}
          </button>
        )}
      </div>
      <div id="report-doc">
        <div className="mb-5">
          <h2 className="text-2xl font-bold tracking-tight">Relatório de horas</h2>
          <div className="text-sm" style={{ color: C.muted }}>Horas por projeto e por etapa</div>
        </div>
        <div className="mb-5 grid grid-cols-4 gap-2.5 max-[620px]:grid-cols-2">
          <Stat cap="Projetos" big={String(projetos.length)} sub="" />
          <Stat cap="Horas trabalhadas" big={`${fmtHoursNum(gReal)} h`} sub="" />
          <Stat cap="Horas previstas" big={`${fmtHoursNum(gEst)} h`} sub="" />
          <Stat cap="Saldo" big={gsd.txt === '·' ? '—' : `${gsd.txt} h`} bigColor={gsd.cor} sub="" />
        </div>
        {projetos.length === 0 ? (
          <div className="rounded-xl border p-10 text-center text-sm" style={{ borderColor: C.linha, color: C.muted }}>
            Sem projetos para relatar.
          </div>
        ) : (
          <>
            <p className="mb-3.5 max-w-[72ch] text-[12.5px]" style={{ color: C.muted }}>
              Horas trabalhadas por etapa, em horas (h). Saldo = trabalhado − previsto — dourado quando passou do previsto, verde quando está dentro.
            </p>
            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm scrollbar-thin" style={{ borderColor: C.linha }}>
              <table className="w-full min-w-[660px] border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 border-b px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.surf2, color: C.muted, borderColor: C.linha }}>Projeto</th>
                    {CODES.map((c) => <th key={c} className="border-b px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.surf2, color: C.muted, borderColor: C.linha }}>{c}</th>)}
                    <th className="border-b px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.surf2, color: C.muted, borderColor: C.linha }}>Trab.</th>
                    <th className="border-b px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.surf2, color: C.muted, borderColor: C.linha }}>Prev.</th>
                    <th className="border-b px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.surf2, color: C.muted, borderColor: C.linha }}>Saldo</th>
                    <th className="border-b px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.surf2, color: C.muted, borderColor: C.linha }}>Etapas</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ p, t, cells, sd }) => (
                    <tr key={p.id}>
                      <td className="sticky left-0 border-b bg-white px-3 py-2.5 text-left" style={{ borderColor: C.linha }}>
                        <span className="block font-semibold">{p.name}</span>
                        {p.client && <small style={{ color: C.muted }}>{p.client}</small>}
                      </td>
                      {cells.map((sec, i) => <td key={i} className="tnum border-b px-3 py-2.5 text-right" style={{ borderColor: C.linha }}>{hc(sec)}</td>)}
                      <td className="tnum border-b px-3 py-2.5 text-right font-bold" style={{ borderColor: C.linha }}>{fmtHoursNum(t.real)}</td>
                      <td className="tnum border-b px-3 py-2.5 text-right" style={{ borderColor: C.linha, color: C.muted }}>{fmtHoursNum(t.est)}</td>
                      <td className="tnum border-b px-3 py-2.5 text-right" style={{ borderColor: C.linha, color: sd.cor }}>{sd.txt}</td>
                      <td className="tnum border-b px-3 py-2.5 text-right" style={{ borderColor: C.linha, color: C.muted }}>{t.done}/{t.total}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: C.surf2 }}>
                    <td className="sticky left-0 px-3 py-2.5 font-bold" style={{ background: C.surf2 }}>Total</td>
                    {colTot.map((sec, i) => <td key={i} className="tnum px-3 py-2.5 text-right font-bold">{hc(sec)}</td>)}
                    <td className="tnum px-3 py-2.5 text-right font-bold">{fmtHoursNum(totalReal)}</td>
                    <td className="tnum px-3 py-2.5 text-right font-bold">{fmtHoursNum(gEst)}</td>
                    <td className="tnum px-3 py-2.5 text-right font-bold" style={{ color: gsd.cor }}>{gsd.txt}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {ehDona && (() => {
              const blocos = projetos.map((p) => {
                const m = secondsByPersonForProject(p)
                const linhas = Object.entries(m).filter(([, sec]) => sec > 0).sort((a, b) => b[1] - a[1])
                return { p, linhas }
              }).filter((b) => b.linhas.length > 0)
              if (blocos.length === 0) return null
              return (
                <div className="mt-7">
                  <h3 className="text-lg font-bold">Horas por pessoa <span className="text-[12px] font-normal" style={{ color: C.faint }}>(só você vê)</span></h3>
                  <p className="mb-3 text-[12.5px]" style={{ color: C.muted }}>Quanto cada pessoa trabalhou em cada projeto.</p>
                  <div className="flex flex-col gap-4">
                    {blocos.map(({ p, linhas }) => (
                      <div key={p.id}>
                        <div className="mb-1 font-semibold">{p.name}</div>
                        <div className="overflow-hidden rounded-lg border" style={{ borderColor: C.linha }}>
                          {linhas.map(([pid, sec]) => (
                            <div key={pid} className="flex items-center justify-between border-b px-3 py-1.5 text-[13px] last:border-0" style={{ borderColor: C.linha }}>
                              <span><b>{pid === '—' ? '— (sem identificação)' : nome(pid)}</b></span>
                              <span className="tnum font-semibold" style={{ color: C.ink }}>{fmtHoursNum(sec)} h</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {ehDona && (() => {
              const mesmoDia = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
              const blocos = projetos.map((p) => {
                const sess = p.stages
                  .flatMap((s) => workSessions(s).map((w) => ({ code: s.code, name: s.name, ...w })))
                  .sort((a, b) => b.start - a.start)
                return { p, sess }
              }).filter((b) => b.sess.length > 0)
              if (blocos.length === 0) return null
              return (
                <div className="mt-7">
                  <h3 className="text-lg font-bold">Registro de horas <span className="text-[12px] font-normal" style={{ color: C.faint }}>(só você vê)</span></h3>
                  <p className="mb-3 text-[12.5px]" style={{ color: C.muted }}>Início → fim de cada sessão do cronômetro, quem e quanto durou.</p>
                  <div className="flex flex-col gap-4">
                    {blocos.map(({ p, sess }) => (
                      <div key={p.id}>
                        <div className="mb-1 font-semibold">{p.name}</div>
                        <div className="overflow-hidden rounded-lg border" style={{ borderColor: C.linha }}>
                          {sess.map((it, i) => (
                            <div key={i} className="flex items-center gap-2.5 border-b px-3 py-1.5 text-[13px] last:border-0" style={{ borderColor: C.linha }}>
                              <span style={{ color: C.muted }}>▶</span>
                              <span className="tnum whitespace-nowrap" style={{ color: C.faint }}>
                                {fmtDateTime(it.start)} → {it.end === null ? 'em curso' : mesmoDia(it.start, it.end) ? fmtTime(it.end) : fmtDateTime(it.end)}
                              </span>
                              <span className="flex-1 min-w-0"><b>{nome(it.by)}</b></span>
                              <span className="tnum whitespace-nowrap font-semibold" style={{ color: C.ink }}>{fmtHoursNum(it.seconds)} h</span>
                              <span className="whitespace-nowrap" style={{ color: C.muted }}>{it.code} · {it.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            <div className="mt-3.5 text-[11.5px]" style={{ color: C.faint }}>
              Gerado em {new Date().toLocaleDateString('pt-BR')} · Painel de Etapas de Projeto · 1Comodo
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ================= Modais ================= */
function Scrim({ children, onFechar }: { children: React.ReactNode; onFechar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-5"
      style={{ background: 'rgba(12,16,20,.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}
    >
      <div className="w-full max-w-md rounded-2xl border bg-white p-5 shadow-xl" style={{ borderColor: C.linha }}>
        {children}
      </div>
    </div>
  )
}

function NovoProjetoModal({ equipe, onFechar, onCriar }: { equipe: Pessoa[]; onFechar: () => void; onCriar: (name: string, client: string, people: string[]) => void }) {
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [sel, setSel] = useState<string[]>([])
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Novo projeto</h3>
      <p className="mb-4 text-[13px]" style={{ color: C.muted }}>As cinco etapas NBR são criadas automaticamente.</p>
      <Campo label="Nome do projeto">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Residência Vila Nova" className="input" />
      </Campo>
      <Campo label="Cliente (opcional)">
        <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Ex.: Família Souza" className="input" />
      </Campo>
      <Campo label="Responsáveis (opcional)">
        <Picker equipe={equipe} selecionados={sel} onToggle={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
      </Campo>
      <div className="mt-2 flex justify-end gap-2.5">
        <button className="btn2" onClick={onFechar}>Cancelar</button>
        <button className="btn2-primary" onClick={() => name.trim() && onCriar(name.trim(), client.trim(), sel)}>Criar projeto</button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

function EquipeModal({ equipe, ehDona, onFechar, onSalvar }: { equipe: Pessoa[]; ehDona: boolean; onFechar: () => void; onSalvar: (e: Pessoa[]) => void }) {
  const [lista, setLista] = useState<Pessoa[]>(equipe)
  const [nome, setNome] = useState('')
  const [funcao, setFuncao] = useState('')
  const [emailNovo, setEmailNovo] = useState('')
  function add() {
    const n = nome.trim()
    if (!n) return
    setLista((l) => [...l, { id: 'u' + Math.random().toString(36).slice(2, 8), name: n, role: funcao.trim(), email: emailNovo.trim().toLowerCase() || undefined }])
    setNome('')
    setFuncao('')
    setEmailNovo('')
  }
  // Normaliza (trim/minúsculas) e salva. Os campos são controlados (value+onChange),
  // então `lista` já está atualizada no clique — nada depende do "sair do campo".
  function salvar() {
    const limpa = lista.map((p) => ({
      ...p,
      name: p.name.trim(),
      role: (p.role || '').trim(),
      email: (p.email || '').trim().toLowerCase() || undefined,
    }))
    onSalvar(limpa)
    onFechar()
  }
  return (
    // Fechar clicando fora = cancelar (NÃO salva), pra não apagar dados sem querer.
    // Só o botão "Pronto" salva.
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Equipe</h3>
      <p className="mb-2 text-[13px]" style={{ color: C.muted }}>
        {ehDona
          ? 'Pessoas do escritório, a função e o e-mail de login de cada uma. O e-mail liga a pessoa à conta — assim o aviso do cronômetro vai pra pessoa certa.'
          : '🔒 Só a responsável pode editar a equipe. Você pode consultar os nomes e funções.'}
      </p>
      <button className="mb-3 rounded-md px-2 py-1 text-[12.5px] font-semibold" style={{ background: C.soft, color: C.ink }} onClick={() => void testarNotificacao()}>🔔 Testar notificação do Windows</button>
      <div className="mb-3 flex max-h-60 flex-col gap-1.5 overflow-y-auto scrollbar-thin">
        {lista.length === 0 && <p className="text-[13px]" style={{ color: C.muted }}>Nenhuma pessoa ainda.</p>}
        {lista.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0" style={{ borderColor: C.linha }}>
            <Avatar pessoa={p} />
            <span className="min-w-[70px] flex-1 text-sm">{p.name}</span>
            {ehDona ? (
              <>
                <input
                  value={p.role} placeholder="Função"
                  onChange={(e) => setLista((l) => l.map((x) => (x.id === p.id ? { ...x, role: e.target.value } : x)))}
                  className="w-[96px] rounded-md border px-1.5 py-[3px] text-[12.5px]" style={{ borderColor: C.linha, background: C.surf2 }}
                />
                <input
                  value={p.email || ''} placeholder="e-mail de login" type="email"
                  onChange={(e) => setLista((l) => l.map((x) => (x.id === p.id ? { ...x, email: e.target.value } : x)))}
                  className="w-[170px] rounded-md border px-1.5 py-[3px] text-[12.5px]" style={{ borderColor: C.linha, background: C.surf2 }}
                />
                <button className="text-[13px] font-semibold" style={{ color: C.danger }} onClick={() => setLista((l) => l.filter((x) => x.id !== p.id))}>remover</button>
              </>
            ) : (
              <span className="text-[12.5px]" style={{ color: C.muted }}>{p.role || '—'}</span>
            )}
          </div>
        ))}
      </div>
      {ehDona && (
        <Campo label="Adicionar pessoa">
          <div className="flex flex-wrap gap-2">
            <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Nome" className="input min-w-[90px] flex-1" />
            <input value={funcao} onChange={(e) => setFuncao(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Função" className="input min-w-[90px] flex-1" />
            <input value={emailNovo} onChange={(e) => setEmailNovo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e-mail de login" type="email" className="input min-w-[140px] flex-1" />
            <button className="btn2" onClick={add}>Adicionar</button>
          </div>
        </Campo>
      )}
      <div className="mt-2 flex justify-end">
        {ehDona
          ? <button className="btn2-primary" onClick={salvar}>Pronto</button>
          : <button className="btn2-primary" onClick={onFechar}>Fechar</button>}
      </div>
      <EstiloModal />
    </Scrim>
  )
}

function RespModal({ titulo, equipe, selecionados, onFechar, onSalvar }: { titulo: string; equipe: Pessoa[]; selecionados: string[]; onFechar: () => void; onSalvar: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(selecionados)
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Responsáveis do projeto</h3>
      <p className="mb-4 text-[13px]" style={{ color: C.muted }}>Quem está à frente de “{titulo}”.</p>
      <Picker equipe={equipe} selecionados={sel} onToggle={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
      <div className="mt-4 flex justify-end gap-2.5">
        <button className="btn2" onClick={onFechar}>Cancelar</button>
        <button className="btn2-primary" onClick={() => onSalvar(sel)}>Salvar</button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

function QuemIniciaModal({ etapa, equipe, padrao, onFechar, onIniciar }: { etapa: string; equipe: Pessoa[]; padrao: string | null; onFechar: () => void; onIniciar: (pid: string | null) => void }) {
  const [sel, setSel] = useState<string | null>(padrao)
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Quem está nesta etapa?</h3>
      <p className="mb-4 text-[13px]" style={{ color: C.muted }}>Registra quem iniciou o cronômetro de “{etapa}” e a que horas.</p>
      <div className="flex flex-wrap gap-2">
        {equipe.map((p) => {
          const on = sel === p.id
          return (
            <button
              key={p.id}
              onClick={() => setSel(p.id)}
              className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-[13px]"
              style={{ borderColor: on ? C.ink : C.linha, background: on ? C.soft : C.surf2 }}
            >
              <Avatar pessoa={p} sm />
              <span className="flex flex-col text-left leading-tight">
                {p.name}
                {p.role && <small style={{ color: C.muted, fontSize: 10 }}>{p.role}</small>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2.5">
        <button className="btn2" onClick={onFechar}>Cancelar</button>
        <button className="btn2-primary" onClick={() => onIniciar(sel)}>Iniciar</button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

function LogModal({ etapa, personById, onFechar }: { etapa: Etapa; personById: (id: string) => Pessoa | null; onFechar: () => void }) {
  const LABEL: Record<string, string> = { start: 'iniciou', pause: 'pausou', auto: `pausa automática (teto de ${MAX_RUN_HOURS}h)`, done: 'concluiu', reopen: 'reabriu' }
  const IC: Record<string, string> = { start: '▶', pause: '⏸', auto: '⏱', done: '✓', reopen: '↩', due: '📅', due_req: '📨', due_ok: '✅', due_rej: '🚫' }
  const PRAZO = new Set(['due', 'due_req', 'due_ok', 'due_rej'])
  const descPrazo = (e: EventoLog): string => {
    const de = e.from ? fmtDate(e.from) : 'sem prazo'
    const para = e.to ? fmtDate(e.to) : 'sem prazo'
    const just = e.reason ? ` — “${e.reason}”` : ''
    if (e.t === 'due_req') return `pediu mudança de prazo: ${de} → ${para}${just}`
    if (e.t === 'due_ok') return `aprovou a mudança: ${de} → ${para}${e.req ? ` (pedido de ${e.req})` : ''}`
    if (e.t === 'due_rej') return `recusou o pedido${e.to ? ` (${fmtDate(e.to)})` : ''}${e.req ? ` de ${e.req}` : ''}`
    // t === 'due' (dona mudou direto)
    if (!e.from && e.to) return `definiu o prazo: ${para}`
    if (e.from && !e.to) return `removeu o prazo (era ${de})`
    return `mudou o prazo: ${de} → ${para}`
  }
  const log = (etapa.log || []).slice().reverse()
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Histórico · {etapa.code} {etapa.name}</h3>
      <p className="mb-4 text-[13px]" style={{ color: C.muted }}>Quem iniciou/pausou, mudanças de prazo e quando. Tempo total: {fmtClock(liveSeconds(etapa))}.</p>
      <div className="flex max-h-80 flex-col overflow-y-auto scrollbar-thin">
        {log.length === 0 ? (
          <p className="text-[13px]" style={{ color: C.muted }}>Sem registros ainda. Use o cronômetro para gerar o histórico.</p>
        ) : (
          log.map((e, i) => {
            const ehPrazo = PRAZO.has(e.t)
            const who = ehPrazo ? (e.by || '—') : e.by ? personById(e.by)?.name || '—' : e.t === 'auto' ? 'sistema' : '—'
            const desc = ehPrazo ? descPrazo(e) : (LABEL[e.t] || e.t)
            return (
              <div key={i} className="flex items-center gap-2.5 border-b py-2 text-[13.5px] last:border-0" style={{ borderColor: C.linha }}>
                <span className="w-5 text-center" style={{ color: C.muted }}>{IC[e.t] || '·'}</span>
                <span className="flex-1 min-w-0"><b>{who}</b> {desc}</span>
                <span className="tnum whitespace-nowrap text-[12px]" style={{ color: C.faint }}>{fmtDateTime(e.at)}</span>
              </div>
            )
          })
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn2-primary" onClick={onFechar}>Fechar</button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

function ImportModal({ onFechar, onImportar }: { onFechar: () => void; onImportar: (t: string) => Promise<{ ok: boolean; msg: string }> }) {
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<{ ok: boolean; msg: string } | null>(null)
  const [carregando, setCarregando] = useState(false)
  async function go() {
    setCarregando(true)
    setEstado(null)
    const r = await onImportar(texto)
    setEstado(r)
    setCarregando(false)
    if (r.ok) setTimeout(onFechar, 1500)
  }
  return (
    <Scrim onFechar={onFechar}>
      <h3 className="text-lg font-bold">Importar do protótipo</h3>
      <p className="mb-3 text-[13px]" style={{ color: C.muted }}>
        No protótipo (<b>localhost:4321</b>), abra o Console do navegador (<b>F12</b> → aba Console) e rode este comando — ele copia seus dados:
      </p>
      <code className="mb-3 block rounded-lg px-3 py-2 text-[12.5px]" style={{ background: C.surf2, border: `1px solid ${C.linha}` }}>
        copy(localStorage.getItem(&apos;painel-etapas-v1&apos;))
      </code>
      <p className="mb-2 text-[13px]" style={{ color: C.muted }}>Depois cole aqui (Ctrl+V) e clique Importar:</p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Cole aqui o JSON copiado do protótipo"
        className="h-32 w-full rounded-lg border p-2.5 text-[12px] font-mono"
        style={{ borderColor: C.linha, background: C.surf2 }}
      />
      {estado && (
        <p className="mt-2 text-[13px] font-semibold" style={{ color: estado.ok ? C.done : C.danger }}>{estado.msg}</p>
      )}
      <div className="mt-3 flex justify-end gap-2.5">
        <button className="btn2" onClick={onFechar}>Fechar</button>
        <button className="btn2-primary" onClick={go} disabled={carregando || !texto.trim()}>
          {carregando ? 'Importando…' : 'Importar'}
        </button>
      </div>
      <EstiloModal />
    </Scrim>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>{label}</label>
      {children}
    </div>
  )
}

function Picker({ equipe, selecionados, onToggle }: { equipe: Pessoa[]; selecionados: string[]; onToggle: (id: string) => void }) {
  if (!equipe.length) return <p className="text-[13px]" style={{ color: C.muted }}>Cadastre a equipe primeiro no botão “Equipe”.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {equipe.map((p) => {
        const on = selecionados.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-[13px]"
            style={{ borderColor: on ? C.ink : C.linha, background: on ? C.soft : C.surf2 }}
          >
            <Avatar pessoa={p} sm />
            <span className="flex flex-col text-left leading-tight">
              {p.name}
              {p.role && <small style={{ color: C.muted, fontSize: 10 }}>{p.role}</small>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function EstiloModal() {
  return (
    <style jsx global>{`
      .input {
        font-size: 15px; padding: 10px 12px; border: 1px solid ${C.linha};
        border-radius: 9px; background: ${C.surf2}; color: #1a1a1a; width: 100%;
      }
      .btn2 { border: 1px solid ${C.linha}; background: ${C.surf2}; border-radius: 9px; padding: 9px 14px; font-size: 14px; font-weight: 600; }
      .btn2-primary { background: ${C.amarelo}; border: 1px solid ${C.amarelo}; color: ${C.onAccent}; border-radius: 9px; padding: 9px 14px; font-size: 14px; font-weight: 700; }
    `}</style>
  )
}
