import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { lerCookieSessao, COOKIE_SESSAO } from '@/lib/sessao'
import Painel from '@/components/Painel'

export const dynamic = 'force-dynamic'

/**
 * Porta de entrada: sem sessão válida do escritório, vai para /login. A página
 * em si se protege (o proxy tranca as APIs; aqui trancamos a tela).
 */
export default async function Home() {
  const store = await cookies()
  const sessao = await lerCookieSessao(store.get(COOKIE_SESSAO)?.value, process.env.ADMIN_SECRET || '')
  if (!sessao) redirect('/login')
  return <Painel email={sessao.email} />
}
