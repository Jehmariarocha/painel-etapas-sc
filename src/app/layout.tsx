import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Painel de Etapas de Projeto — 1Comodo',
  description: 'Acompanhamento das etapas de projeto do escritório: horas, responsáveis e prazos.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
