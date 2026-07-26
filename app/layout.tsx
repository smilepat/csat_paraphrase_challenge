import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "100-Word Paraphrase Challenge",
  description: "수능형 지문을 가장 짧고 쉬운 영어로 바꾸는 교실 활동",
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
