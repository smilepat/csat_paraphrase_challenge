// ============================================================
// 지문 검수 자동 점검
//
// 118개를 하나씩 눈으로 보는 건 현실적이지 않다. 기계가 확실히 잡을 수 있는
// 문제만 먼저 걸러서 교사의 눈이 위험한 지문으로 먼저 가게 한다.
//
// 여기서 잡지 못하는 것: 명제가 지문의 논지를 제대로 대표하는가.
// 그건 사람이 봐야 하고, 그래서 승인 버튼은 남아 있다.
// ============================================================

import { longestCommonRun, surfaceOverlap } from "./guards"
import { scoreEase, type FreqRank } from "./ease"
import { wordCount } from "./text"

export type AuditLevel = "error" | "warn"

export interface AuditIssue {
  level: AuditLevel
  message: string
}

export interface AuditInput {
  body: string
  propositions: string[]
  modelAnswers: string[]
  freq: FreqRank
  /** 이 지문으로 열 수업의 목표 단어 수(기본 25) */
  targetWords?: number
}

/** 명제가 원문에서 이만큼 이어 붙였으면 패러프레이즈가 아니라 발췌다. */
const PROP_COPY_RUN = 8
/** 명제끼리 이만큼 겹치면 사실상 같은 말이다. */
const PROP_DUP_OVERLAP = 0.7

export function auditPassage(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = []
  const target = input.targetWords ?? 25
  const { propositions: props, modelAnswers: models, body, freq } = input

  // ---- 개수 ----
  if (props.length < 3) {
    issues.push({ level: "error", message: `핵심 명제가 ${props.length}개입니다 (3개 이상 권장).` })
  }
  if (props.length > 5) {
    issues.push({ level: "warn", message: `핵심 명제가 ${props.length}개로 많습니다. 25단어 안에 다 담기 어렵습니다.` })
  }
  if (models.length < 2) {
    issues.push({ level: "warn", message: `모범 답안이 ${models.length}개입니다 (2개 이상 권장).` })
  }

  // ---- 명제가 원문 발췌인가 ----
  // 명제를 원문 그대로 쓰면 "원문을 베낀 학생"이 만점을 받는 쪽으로 기울고,
  // 임베딩 폴백 경로도 표면 일치에 끌려간다.
  props.forEach((p, i) => {
    const run = longestCommonRun(body, p)
    if (run.length >= PROP_COPY_RUN) {
      issues.push({
        level: "warn",
        message: `명제 ${i + 1}이 원문을 ${run.length}단어 연속으로 그대로 씁니다. 바꿔 써야 합니다.`,
      })
    }
    if (wordCount(p) < 5) {
      issues.push({ level: "error", message: `명제 ${i + 1}이 너무 짧습니다.` })
    }
    if (wordCount(p) > 22) {
      issues.push({ level: "warn", message: `명제 ${i + 1}이 ${wordCount(p)}단어로 깁니다. 한 주장만 담아야 합니다.` })
    }
  })

  // ---- 명제끼리 중복 ----
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      if (surfaceOverlap(props[i], props[j]) >= PROP_DUP_OVERLAP) {
        issues.push({
          level: "warn",
          message: `명제 ${i + 1}과 ${j + 1}이 거의 같은 말입니다. 하나로 합치세요.`,
        })
      }
    }
  }

  // ---- 모범 답안 ----
  models.forEach((m, i) => {
    const w = wordCount(m)
    if (w > target + 5) {
      issues.push({
        level: "error",
        message: `모범 답안 ${i + 1}이 ${w}단어로 목표(${target})를 크게 넘습니다.`,
      })
    }
    const run = longestCommonRun(body, m)
    if (run.length >= 12) {
      issues.push({
        level: "error",
        message: `모범 답안 ${i + 1}이 원문을 ${run.length}단어 연속으로 옮겼습니다.`,
      })
    }
    const ease = scoreEase(m, freq)
    if (ease.score < 12) {
      issues.push({
        level: "warn",
        message: `모범 답안 ${i + 1}의 어휘가 어렵습니다 (쉬움 ${ease.score}/25` +
          `${ease.detail.hardWords.length ? `, 빈도표 밖: ${ease.detail.hardWords.slice(0, 3).join(", ")}` : ""}).`,
      })
    }
  })

  // ---- 모범 답안끼리 다양성 ----
  if (models.length >= 2) {
    const allSimilar = models.every((m, i) =>
      models.every((n, j) => i === j || surfaceOverlap(m, n) >= 0.7),
    )
    if (allSimilar) {
      issues.push({
        level: "warn",
        message: "모범 답안들이 서로 너무 비슷합니다. 다른 표현 방식이 하나는 있어야 합니다.",
      })
    }
  }

  return issues
}

export function auditSeverity(issues: AuditIssue[]): "clean" | "warn" | "error" {
  if (issues.some((i) => i.level === "error")) return "error"
  if (issues.length) return "warn"
  return "clean"
}
