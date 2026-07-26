import { NextResponse, type NextRequest } from "next/server"

// ============================================================
// 교사 경로 보호
//
// /admin/* 과 /host/* 는 지문 원문을 그대로 보여준다. CSAT 기출이므로
// 공개 URL 에 그냥 두면 안 된다. 학생 경로(/join, /r/*)는 6자리 코드로
// 들어와야 하므로 열어 둔다.
//
// 운영에서 TEACHER_PASSWORD 를 설정하지 않으면 교사 경로를 아예 막는다.
// "설정을 깜빡해서 지문이 공개된" 상태보다 "안 열려서 당황하는" 쪽이 낫다.
// 로컬 개발에서는 비밀번호 없이 통과한다.
// ============================================================

const PROTECTED = ["/admin", "/host"]

function unauthorized(): NextResponse {
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Teacher", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}

/** 길이 정보까지 흘리지 않도록 상수 시간에 가깝게 비교한다. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  const password = process.env.TEACHER_PASSWORD?.trim()

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next()
    return new NextResponse(
      "TEACHER_PASSWORD 가 설정되지 않아 교사 화면을 막았습니다.\n" +
        "이 앱에는 CSAT 기출 원문이 들어 있어 보호 없이 열 수 없습니다.\n" +
        "docs/DEPLOY.md 를 참고해 환경변수를 설정하세요.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    )
  }

  const header = req.headers.get("authorization")
  if (!header?.startsWith("Basic ")) return unauthorized()

  let decoded: string
  try {
    decoded = atob(header.slice(6))
  } catch {
    return unauthorized()
  }
  // 사용자명은 무엇이든 받는다. 비밀번호 하나로만 가른다.
  const given = decoded.slice(decoded.indexOf(":") + 1)
  return safeEqual(given, password) ? NextResponse.next() : unauthorized()
}

export const config = {
  matcher: ["/admin/:path*", "/host/:path*"],
}
