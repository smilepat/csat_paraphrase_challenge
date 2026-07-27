# 배포

> **먼저 읽을 것** — 이 앱의 DB 에는 CSAT 기출 원문이 들어 있습니다.
> 접근 제어 없이 프로덕션에 올리면 저작물이 공개 URL 로 열립니다.
> 아래 1번을 건너뛰지 마세요.

## 1. 접근 제어 (필수)

**현재 설정 (2026-07-27 변경 완료)**: `ssoProtection = preview`.
프로덕션 `.vercel.app` 은 **열려 있고**, Preview 배포만 Vercel 로그인을 요구합니다.
학생이 코드로 입장할 수 있도록 사용자가 이 방식을 선택했습니다.

따라서 프로덕션에서 지문 원문을 지키는 것은 **`proxy.ts` 의 `TEACHER_PASSWORD` 하나**입니다
(`/admin/*`, `/host/*`). 학생 경로는 열려 있고, 지문은 6자리 코드를 알고 방이
`writing` 상태일 때만 보입니다. 이 전제가 바뀌면 아래 표에서 다른 방식을 고르세요.

지문 유출 위험은 이 설정으로 이미 막혀 있습니다. 문제는 반대쪽입니다 —
**학생도 못 들어옵니다.** 학생은 Vercel 계정이 없으니까요.

수업에 쓰려면 둘 중 하나를 골라야 합니다.

| 방법 | 학생 접근 | 지문 노출 위험 |
|---|---|---|
| **A. 커스텀 도메인 연결** | 도메인으로 자유롭게 입장 | 도메인은 SSO 예외라 공개됨. `/admin`·`/host` 는 `TEACHER_PASSWORD` 가 막음 |
| **B. SSO 를 Preview 전용으로 변경** | 프로덕션 `.vercel.app` 으로 입장 | 위와 같음. 주소가 추측 가능하다는 점만 다름 |

어느 쪽이든 **교사 경로는 `proxy.ts` 의 Basic 인증이 지킵니다**(아래 2번).
학생 경로(`/`, `/join`, `/r/*`)는 열려야 하고, 지문은 6자리 코드를 알고 방이
`writing` 상태일 때만 보입니다.

바꾸는 법 (B):
```bash
# Vercel 대시보드 → Project → Settings → Deployment Protection
# Vercel Authentication 을 "Only Preview Deployments" 로 변경
```

학생이 각자 기기로 들어와야 하므로 **학생 화면(`/join`, `/r/*`)은 열려 있어야** 합니다.
보호가 필요한 건 지문 원문이 노출되는 경로입니다:

- `/admin/*` — 지문 전문이 그대로 보임
- `/host`, `/host/*` — 지문 전문이 보임
- `/reports/*` — 이미 host 쿠키로 보호됨

학생 화면에도 지문은 나오지만, 6자리 코드를 알고 방이 `writing` 상태일 때만 나옵니다.

## 2. 앱 비밀번호 (기본 제공)

`proxy.ts` 가 `/admin/*` 과 `/host/*` 에 Basic 인증을 겁니다.
`TEACHER_PASSWORD` 를 설정하면 그 값으로 열립니다(사용자명은 아무거나).

**운영에서 `TEACHER_PASSWORD` 를 설정하지 않으면 교사 경로는 503 으로 막힙니다.**
"설정을 깜빡해서 지문이 공개된" 상태보다 "안 열려서 당황하는" 쪽이 낫다고 봤습니다.
로컬 개발에서는 비밀번호 없이 통과합니다.

비밀번호 하나짜리 보호라는 점은 분명히 해 둡니다. 여러 교사가 각자 계정으로 쓰거나
학교 밖 노출이 걱정되면 Pro + Deployment Protection 쪽이 맞습니다.

## 3. 환경변수

Vercel 프로젝트 설정에 넣을 값:

```
TURSO_DATABASE_URL   libsql://... (필수 — 서버리스에는 로컬 파일이 없다)
TURSO_AUTH_TOKEN
GEMINI_API_KEY
GEMINI_MODEL         gemini-2.5-flash
GEMINI_EMBED_MODEL   gemini-embedding-2
GEMINI_EMBED_DIM     768
PARAPHRASE_LLM       on
GEMINI_DAILY_LIMIT   2000
TEACHER_PASSWORD     교사 화면 비밀번호 (운영에서 필수 — 없으면 /admin·/host 가 503)
```

⚠ `TURSO_AUTH_TOKEN` 을 복사할 때 줄바꿈이 섞이는 사고가 잦습니다. `lib/db.ts` 가
방어적으로 정리하지만, Vercel UI 에 붙여넣을 때 앞뒤 공백을 확인하세요.

## 4. DB 준비

로컬 SQLite 는 서버리스에서 못 씁니다. Turso DB 를 만들고 스키마·지문을 올립니다.

```bash
export TURSO_DATABASE_URL=libsql://...
export TURSO_AUTH_TOKEN=...
npm run db:schema
npm run db:import
npm run db:enrich     # Gemini 호출 — 118지문에 약 24콜
```

로컬에서 이미 검수·승인을 마쳤다면, `pc_passages` 를 그대로 옮기는 편이 빠릅니다
(`propositions`, `model_answers`, `review_status`, `ref_embedding` 컬럼).

## 5. 배포

```bash
npx vercel            # preview
npx vercel --prod     # production — 1번 접근 제어를 끝낸 뒤에만
```

**실측 확인 (프리뷰 배포, Vercel 인증 우회 토큰으로 앱 계층만 검사):**

| 경로 | 인증 없이 | 교사 비번 |
|---|---|---|
| `/`, `/join`, `/standalone.html` | 200 | — |
| `/admin/passages`, `/host` | **401** | 200(DB 있을 때) |
| 틀린 비번 | **401** | — |

모든 응답에 `x-robots-tag: noindex, nofollow, noarchive` 확인.
DB 미연결 상태에서는 교사 경로가 인증 통과 후 500 입니다 — `lib/db.ts` 가
운영에서 env 없이 쿼리하면 명시적으로 실패하도록 만든 의도된 동작입니다.

## 6. 배포 후 확인

- [ ] `curl -I <배포URL>/admin/passages` 가 401 인가 (인증 없이 200 이면 즉시 내릴 것)
- [ ] 학생 경로 `/join` 은 인증 없이 200 인가
- [ ] `curl -I <배포URL>` 에 `x-robots-tag: noindex, nofollow, noarchive` 가 있는가
- [ ] `/join` 에서 실제 코드로 입장되는가 (폰 1대로 확인)
- [ ] 한 라운드를 돌리고 `pc_api_usage` 에 호출 수가 기록되는가
- [ ] `GEMINI_DAILY_LIMIT` 이 의도한 값인가
