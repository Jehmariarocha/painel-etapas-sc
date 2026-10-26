import 'server-only'

/**
 * Separa os dados do ambiente local dos dados do site publicado.
 *
 * O diário usa o mesmo banco Upstash das outras ferramentas. Sem isso,
 * qualquer diário criado durante um `npm run dev` cairia no meio dos reais
 * — e diário de obra é registro que precisa ser confiável.
 *
 * Rodando localmente, tudo vive sob o prefixo `dev:`. Na Vercel, nunca — a
 * checagem de `VERCEL` é uma trava a mais caso o NODE_ENV venha errado.
 */
export function ehSandbox(): boolean {
  if (process.env.VERCEL) return false
  return process.env.NODE_ENV !== 'production'
}

export function chave(nome: string): string {
  return ehSandbox() ? `dev:${nome}` : nome
}
