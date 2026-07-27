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
| 지문 | 로컬·원격 Turso 모두 **119개**(명제 보유 119). **승인 0개** — 사람이 눌러야 함 |
| Vercel 배포 | **프로덕션 가동** https://csat-paraphrase-challenge.vercel.app · 실 라운드 통과 |
| 운영 투입 | **가능** — 지문 승인만 남음 |

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

## 3. 남은 일

### ① ~~Turso DB~~ — 해소됨 (2026-07-27)

`csat-paraphrase` DB 생성·스키마 적용·지문 119개 이관 완료(`npm run db:migrate`).
Vercel env 에 `TURSO_*` 등록 후 재배포했고, **프로덕션 실 라운드가 통과**했다
(`SMOKE_ANSWER="..." node scripts/prod-smoke.mjs`).

실측 비용: 1명 라운드에 `embed 2콜 / verdict 1콜`. 설계값과 일치.

### ② ~~Vercel SSO~~ — 해소됨 (2026-07-27)

`ssoProtection` 을 `preview` 전용으로 바꿨습니다(Vercel API PATCH). 프로덕션
`.vercel.app` 은 열려 있어 학생이 코드로 입장할 수 있습니다.

**그래서 프로덕션에서 지문을 지키는 것은 `TEACHER_PASSWORD` 하나뿐입니다.**
`/admin/*`·`/host/*` 만 막히고 학생 경로는 열려 있습니다. 비밀번호를 지우거나
`proxy.ts` 를 건드리면 CSAT 원문이 그대로 공개됩니다.

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
- **`vercel env add` 가 값을 빈 문자열로 저장합니다.** 성공을 반환하는데도 그렇습니다.
  실제로 `GEMINI_API_KEY`·`PARAPHRASE_LLM` 이 프로덕션에 0자로 들어가 배포본에서
  Gemini 호출이 전부 실패했습니다. **REST API(`POST /v10/projects/{id}/env?upsert=true`)로
  넣고, `vercel env pull` 로 길이를 확인하세요.**
- **`.env.local` 의 따옴표가 그대로 넘어갑니다.** `KEY="AIza..."` 를 그대로 밀면
  값에 `"` 가 포함돼 401/400 이 납니다. `loadEnv()` 는 벗기지만 REST 로 밀 때는 직접 벗겨야 합니다.
- **로컬에서 안 잡히는 결함이 있습니다.** 학생 화면이 첫 렌더에서 localStorage·Date.now()
  를 읽어 프로덕션에서만 React #418(하이드레이션 실패)이 났습니다.
  배포 후에는 `scripts/prod-smoke.mjs` 를 한 번 돌리세요.
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
SMOKE_ANSWER="..." node scripts/prod-smoke.mjs   # 배포본에서 실 라운드 1회 (지문에 맞는 답안 필수)
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

