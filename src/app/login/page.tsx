'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { DOMINIO_DA_EQUIPE } from '@/lib/sessao'

/** O que deu errado na volta do Google, em português. */
const ERROS: Record<string, string> = {
  dominio: `Essa conta não é do escritório. Entre com o seu e-mail @${DOMINIO_DA_EQUIPE}.`,
  configuracao: 'O login com Google ainda não está configurado nesta instalação.',
  sem_client_id: 'Falta a variável GOOGLE_CLIENT_ID nesta instalação.',
  sem_client_secret: 'Falta a variável GOOGLE_CLIENT_SECRET — confira o nome, inclusive o T no fim.',
  sem_admin_secret: 'Falta a variável ADMIN_SECRET, usada para assinar a sessão.',
  state: 'A tentativa de login expirou ou veio de outro lugar. Tente de novo.',
  token: 'O Google não confirmou o login. Tente de novo.',
  email: 'O Google não confirmou esse e-mail.',
  cancelado: 'Login cancelado.',
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginConteudo />
    </Suspense>
  )
}

function LoginConteudo() {
  const searchParams = useSearchParams()
  const erro = ERROS[searchParams.get('erro') ?? ''] ?? null

  return (
    <div className="flex items-center justify-center px-4 py-16">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-3xl mb-2">🔑</p>
          <h1 className="text-xl font-bold text-gray-900">Entrar no escritório</h1>
          <p className="text-sm text-gray-500 mt-1">
            Use a conta do escritório <span className="whitespace-nowrap">@{DOMINIO_DA_EQUIPE}</span>
          </p>
        </div>

        {erro && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">{erro}</p>
        )}

        <a
          href="/api/auth/google"
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden>
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z" />
            <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C2.9 17.3 2 20.5 2 24s.9 6.7 2.5 9.9l7.3-5.7z" />
            <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
          </svg>
          Entrar com Google
        </a>

        <p className="text-xs text-gray-400 text-center">
          Uso interno do escritório. Só contas @{DOMINIO_DA_EQUIPE} entram.
        </p>
      </div>
    </div>
  )
}
