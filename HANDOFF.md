# HANDOFF — 100-Word Paraphrase Challenge

**최종 갱신** 2026-07-27 · **레포** `smilepat/csat_paraphrase_challenge` (private)
현재 커밋은 `git log --oneline -1` 로 확인하세요 — 이 문서에 해시를 박으면
문서를 고치는 순간 어긋납니다.

수능 기출 지문을 가장 짧고 쉬운 영어로 바꾸는 교실 활동 앱.
단일 HTML 게임을 Next.js 16 앱으로 전환했고, 학생은 자기 기기로 제출하고 교사는
실시간 화면으로 진행·채점·비교합니다.

---

## 1. 지금 상태

| 영역 | 상태 |
|---|---|
| 수업 전 구간 (검수→방→조인→제출→채점→리포트) | **완료**, E2E 7개 green |
| 플래그 제출 처리 | 교사 판단 전까지 순위·팀점수·평균에서 제외 |
| 채점 엔진 | **완료**, 축별 캘리브레이션 전체 PASS |
| 지문 | CSAT 118개 적재·보강 완료. **승인은 0개** (사람이 눌러야 함) |
| Vercel 배포 | 프로젝트 생성·env 등록·프리뷰 배포 완료. **DB 없어 교사 경로 500** |
| 운영 투입 | **불가** — 아래 블로커 2개 |

로컬에서는 전부 동작합니다. 막힌 건 배포 환경의 DB와 학생 접근 경로뿐입니다.

---

## 2. 바로 재개하기

### 이 PC (`C:\tmp\csat_paraphrase_challenge`)

```bash
npm run dev            # local.db 에 지문 118개 + 보강 결과가 이미 들어 있음
```

`/admin/passages` → 무지적 115개 일괄 승인 → `/host` 에서 방 생성 → 다른 창에서 `/join`.

### 다른 PC

```bash
git clone https://github.com/smilepat/csat_paraphrase_challenge && cd csat_paraphrase_challenge
npm install
cp .env.example .env.local        # GEMINI_API_KEY 입력
npm run db:schema                 # file:./local.db
npm run db:import                 # CSAT 565 → 필터 → 118  (원천 경로는 아래 참고)
npm run db:enrich                 # 명제·모범답안 생성. Gemini 약 24콜, 3~4분
npm run dev
```

`db:import` 의 원천은 `C:/tmp/csat-reasoning-bridge-builder/public/passages.json` 입니다.
다른 PC에서는 그 레포를 먼저 클론하거나 경로를 인자로 넘기세요:
`node scripts/import-passages.mjs <passages.json 경로>`

`data/freq-rank.json`(어휘 빈도 6,266)은 레포에 커밋돼 있어 다시 만들 필요가 없습니다.
다시 만들려면 `npm run db:freq` (원천 `C:/tmp/vocab-context/designed_min_clean.csv`).

---

## 3. 남은 블로커 2개

### ① Turso DB — 배포본이 못 뜨는 직접 원인

서버리스에는 로컬 SQLite 파일이 없습니다. `TURSO_DATABASE_URL` 이 없으면
`lib/db.ts` 가 **쿼리 시점에 명시적으로 실패**합니다(의도된 동작, 로컬 재현 확인:
`Turso 가 설정되지 않았습니다`). 그래서 배포본의 `/admin`·`/host` 는 인증을
통과해도 500 입니다.

WSL 의 turso CLI 토큰이 만료돼 있습니다(플랫폼 API 401 `Token is expired`).
`turso auth login` 은 브라우저 OAuth라 사람이 해야 합니다.

```bash
wsl
~/.turso/turso auth login                       # 브라우저 로그인
~/.turso/turso db create csat-paraphrase
~/.turso/turso db show csat-paraphrase --url    # → TURSO_DATABASE_URL
~/.turso/turso db tokens create csat-paraphrase # → TURSO_AUTH_TOKEN
```

받은 뒤 이어서 할 일:

```bash
export TURSO_DATABASE_URL=libsql://...  TURSO_AUTH_TOKEN=...
npm run db:schema && npm run db:import && npm run db:enrich
# 또는 로컬 검수 결과를 그대로 옮기기(추천 — 재생성 비용 없음):
#   local.db 의 pc_passages 에서 propositions / model_answers /
#   review_status / ref_embedding 컬럼을 복사
npx vercel env add TURSO_DATABASE_URL production   # preview 도 같이
npx vercel env add TURSO_AUTH_TOKEN production
npx vercel deploy --prod
```

⚠ `vercel env add` 가 `--value --yes` 를 줘도 프롬프트 안내만 반복하는 버그가 있었습니다.
막히면 REST API 로 넣으세요(`POST /v10/projects/{id}/env?teamId=...&upsert=true`,
body `{key,value,type:"encrypted",target:["preview"]}`). 토큰은
`%APPDATA%\com.vercel.cli\Data\auth.json`.

### ② Vercel SSO 설정 — 학생이 못 들어옴

프로젝트는 팀 `prompt-improvement-dm-pat`(Pro)에 있고
`ssoProtection = all_except_custom_domains` 입니다. 즉 `*.vercel.app` 은
**프로덕션까지 Vercel 로그인 필요** → 지문 유출 위험은 이미 막혀 있지만
**학생도 못 들어옵니다**(학생은 Vercel 계정이 없음).

둘 중 하나를 골라야 합니다. 대시보드 설정이라 코드로는 못 바꿉니다.

- **A. 커스텀 도메인 연결** — 도메인은 SSO 예외. 학생 자유 입장.
- **B. Deployment Protection → "Only Preview Deployments"** — 프로덕션 `.vercel.app` 개방.

어느 쪽이든 `/admin`·`/host` 는 `proxy.ts` 의 Basic 인증이 지킵니다(프리뷰 배포에서
401 실측 확인). 학생 경로(`/`, `/join`, `/r/*`)만 열립니다.

---

## 4. 자격 증명

| 항목 | 위치 |
|---|---|
| `GEMINI_API_KEY` | 로컬 `.env.local` (gitignore), Vercel env(prod+preview) |
| `TEACHER_PASSWORD` | **Vercel env 에만** 있습니다. 값이 필요하면 대시보드 또는 `vercel env pull` |
| Vercel 프로젝트 | 팀 `prompt-improvement-dm-pat` / `csat-paraphrase-challenge` |
| Turso | 미생성 (블로커 ①) |

비밀번호를 바꾸려면 Vercel env 의 `TEACHER_PASSWORD` 만 교체하고 재배포하면 됩니다.
운영에서 이 값을 비우면 `/admin`·`/host` 가 **503** 으로 막힙니다(고의적 안전 기본값 —
설정을 깜빡해 CSAT 원문이 열리는 것보다 낫다고 판단).

---

## 5. 설계에서 반드시 알아야 할 것

전부 **측정으로 뒤집힌** 것들입니다. 근거와 수치는 [docs/CALIBRATION.md](docs/CALIBRATION.md).
채점을 건드리기 전에 그 문서를 먼저 읽으세요.

1. **임베딩은 명제 커버리지를 못 잽니다.** 한 지문의 명제들은 주제가 같아서, 4개 중
   1개만 담은 답안도 나머지와 0.78+ 유사도가 나옵니다(커버리지 1.00 vs 0.25 가
   50.0 vs 47.6점). 임계값 문제가 아니라 원리 문제입니다(격자 탐색 최대 ρ 0.728).
   → **LLM 의 명제별 agree/disagree/absent 판정이 1차**, 임베딩은 폴백.
2. **`text-embedding-004` 는 퇴역(404)**. `gemini-embedding-001` 은 의미 역전을
   구별하지 못합니다(0.804 vs 0.812). **`gemini-embedding-2` / 768차원**을 씁니다.
3. **"모순 인덱스를 나열하라"** 프롬프트는 탐지율 67%. **명제별 입장을 강제**하니 100%.
4. **모순은 누락보다 무겁게** 쳐야 합니다. 0점 처리만 하면 둘이 동점이 됩니다(42.5 vs 42.5).
   모순 명제는 −1 로 계산합니다.
5. **베낌 판정에 임베딩을 쓰면 안 됩니다.** 같은 뜻을 자기 말로 바꿔 쓴 정직한 답안을
   부정행위로 몰게 됩니다 — 이 게임이 장려하려는 바로 그 행동을. 표면 비교
   (최장 공통 연속 단어 + 내용어 자카드)로 합니다. 오탐 0/84 실측.

6. **플래그가 붙은 제출은 교사 판단 전까지 어디에도 반영하지 않습니다**
   (`lib/rooms.ts` 의 `reviewState`). 복붙의 원점수는 69.3 으로 여전히 높게 나옵니다 —
   임베딩·규칙만 보면 실제로 "핵심을 다 담은 짧은 글"이기 때문입니다. 그래서 예전에는
   순위 2위에 올랐습니다. 자동 0점 처리는 하지 않습니다(정당한 인용을 기계가 가려낼 수
   없음). `counted`/`pending`/`rejected` 세 상태로 순위·팀점수·평균·학생 화면을 한꺼번에
   통제합니다. **이 규칙을 지우면 베낀 답안이 다시 1위에 오릅니다.**

**측정 방법론 교훈**: 총점 하나로 뭉뚱그려 재면 측정 도구의 결함이 채점기 성능처럼
보입니다(v1 에서 실제로 그럴 뻔했습니다 — ρ 0.709 가 나왔는데 진단해 보니 정답
순서가 애초에 신호에 없었습니다). 축을 하나씩만 움직인 데이터로 재고, 심판 LLM 의
라벨로 그 심판을 평가하는 순환을 피하세요.

---

## 6. 파일 지도

```
app/actions/       host(방·전이·권한) / play(조인·제출·라운드채점) /
                   admin(검수·일괄승인) / custom-passage(교사 입력) / teacher-view(폴링)
app/host, app/r, app/join, app/admin, app/reports   화면
lib/scoring/       text·brevity·ease·guards·meaning·audit = 순수 함수 (테스트 대상)
                   index.ts 조립 / service.ts 는 I/O / verdict.ts 는 LLM 판정
lib/               codes(ULID·6자리) db(Turso) gemini identity
                   rooms — 방 상태 전이 + reviewState(플래그 제출 반영 규칙)
proxy.ts           교사 경로 Basic 인증 (Next 16 규약. 구 middleware)
scripts/           schema·import·enrich·freq·calibrate·audit·live-check
e2e/               Playwright 7개
docs/              CALIBRATION.md(채점 근거) DEPLOY.md(배포)
HANDOFF.md         이 문서(정본) · STATUS.md 는 repo-ops 자동화가 읽는 요약
public/standalone.html   원래 단일 HTML — 기기 없는 교실용 폴백
```

`lib/codes.ts`, `lib/db.ts`, `lib/gemini.ts`, `lib/identity.ts` 는
`Korea_English_Solution` 에서 **복사**한 것입니다(각 파일 헤더에 원본 경로).
원본이 개선돼도 자동 반영되지 않습니다.

> 파생 발견: KES 의 `lib/gemini.ts` `generateEmbedding` 도 퇴역한
> `text-embedding-004` 를 써서 **현재 404 로 깨져 있습니다**. 그 레포는 건드리지
> 않았습니다.

---

## 7. 밟았던 함정 (반복 방지)

- **`vercel env add` 가 프롬프트 안내만 반복** — `--value --yes` 를 줘도. REST API 우회.
- **`vercel logs` 는 스트리밍** — 타임아웃으로 죽으면 출력이 빕니다. 배포 원인 확인은
  로컬 프로덕션 모드 재현이 빠릅니다.
- **Playwright `request` 컨텍스트가 config 의 `httpCredentials` 를 물려받습니다** —
  인증 차단 테스트가 200 으로 통과해 버립니다. 순수 `fetch` 로 확인하세요.
- **`next start` 가 `.env.local` 을 자동으로 읽습니다** — E2E 가 실수로 실제 API 를
  때립니다. `playwright.config.ts` 에서 `GEMINI_API_KEY: ""` 로 덮어썼습니다.
- **E2E DB 는 매 실행 리셋해야 합니다**(`e2e/global-setup.ts`). 이전 실행의 승인분이
  남아 "승인한 지문"과 "방이 고른 지문"이 어긋난 적이 있습니다.
- **vite-node 는 `vitest.config.ts` 를 읽지 않습니다** — `@/` 별칭 때문에
  `vite.config.ts` 한 곳으로 합쳤습니다.
- **Node 의 `/tmp/x` 는 Windows 에서 `C:\tmp\x`**, Git Bash 의 `/tmp` 와 다른 곳입니다.
- **Next 16 은 `middleware` 규약을 deprecated** 처리했습니다 → `proxy.ts`.
- **원격 main 에 자동화가 직접 push 합니다** — `project-dashboard` 액션이 `STATUS.md` 를
  넣습니다. push 가 거부되면 남의 작업이 아니라 이것일 가능성이 큽니다.
  `git pull --rebase origin main` 후 다시 push 하세요.
- **`vercel link` 가 비대화형에서 개인 계정을 스코프로 못 씁니다** — 팀
  `prompt-improvement-dm-pat` 을 `--scope` 로 명시해야 합니다(기존 100개 프로젝트가
  전부 이 팀에 있고 멤버는 1명입니다).

---

## 8. 검증

```bash
npm test          # 순수 함수 단위 44개
npm run test:e2e  # 수업 전 구간 7개 (외부 API 없이 — 가짜 임베딩)
npm run typecheck
npm run calibrate # 채점 품질 회귀 (실제 API. 채점 로직·임베딩 모델 건드렸을 때만)
npx vite-node scripts/audit-passages.mjs   # 지문 검수 자동 점검 요약
npx vite-node scripts/live-check.mjs       # 실제 API 로 한 라운드 채점 + 호출 수
```

CI(`.github/workflows/ci.yml`)는 typecheck + 단위 + build + E2E 를 돌립니다.
캘리브레이션은 실제 API 라 `workflow_dispatch` 수동 실행입니다
(`GEMINI_API_KEY` 시크릿 등록 완료).

**현재 수치**: 의미 ρ0.978 · 쉬움 ρ0.932 · 간결 ρ0.924 · 모순 9/9 ·
복붙 6/6 오탐 0/84 · 지문 자동점검 무지적 115/118. 단위 44 · E2E 7.

---

## 9. 비용

- 30명 라운드 1회 ≈ **5콜** (임베딩 1~2 + 판정 3). 같은 답안 재채점은 **0콜**(캐시).
- 제출 즉시에는 임베딩만 부릅니다. LLM 판정은 라운드 종료 시 10명씩 배치.
- `PARAPHRASE_LLM=off` 로 판정을 끌 수 있습니다(임베딩+규칙만으로 계속 동작).
  단 이 경우 의미 점수의 **간격이 거의 없습니다** — 등수는 되지만 절대 점수는 믿지 마세요.
- `GEMINI_DAILY_LIMIT` 로 일일 상한. 교사 화면에 오늘 사용량이 표시됩니다.

---

## 10. 선택 과제 (블로커 아님)

- **교사 감각 검증** — 캘리브레이션의 정답 라벨은 구성 사양 + 심판 LLM 확인이지
  사람 교사의 판단이 아닙니다. 실제 학생 답안 30~50개에 교사가 순위를 매겨
  ρ 를 다시 재면 신뢰도가 한 단계 올라갑니다.
- **지문 유형 확대** — 지금은 6개 유형(빈칸추론·요지·주제·제목·주장·함축)만 씁니다.
  넓히면 명제 구조가 달라 임계값 재조정이 필요합니다.
- **실제 수업 1회 투입** — 지금까지의 검증은 전부 합성 데이터입니다. 실제 학생 답안이
  들어와야만 드러나는 것들이 있습니다(빈 제출·한글 섞임·초성체·시간 초과 행동 등).
  블로커 2개를 푼 뒤 한 반으로 먼저 돌려 보는 게 다음 단계입니다.

코드로 더 할 수 있는 항목은 소진했습니다. 남은 것은 전부 사람의 판단(SSO·도메인),
계정 작업(Turso 로그인), 또는 실제 학생 데이터가 있어야 진행됩니다.

