import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'STUDY:U — AI 학습 코치',
  description: '문서 기반 AI 학습 도구. 업로드한 자료로 질의응답, 요약, 퀴즈를 생성합니다.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body className="font-sans">
        {children}
      </body>
    </html>
  )
}
