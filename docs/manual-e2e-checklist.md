# 수동 E2E 체크리스트

이 문서는 현재 저장소에서 아래 두 가지를 사람이 직접 검증하기 위한 체크리스트입니다.

1. `plan` / `run`에서 오케스트레이션 코어 continuity가 잘 동작하는지
2. `run`의 task pipeline이 정상적으로 동작하는지

최신 플러그인 코드가 반영되도록 OpenCode를 재시작한 뒤 사용하는 것을 권장합니다.

## 확인할 파일

- 오케스트레이션 상태: `.nexus/state/orchestration.opencode.json`
- plan projection: `.nexus/state/plan.opencode.json`
- task cycle 상태: `.nexus/state/tasks.json`
- 감사 로그: `.nexus/state/audit/all.jsonl`
- 세션 로그: `.nexus/state/audit/sessions/<session-id>/session.jsonl`
- 서브에이전트 로그: `.nexus/state/audit/sessions/<session-id>/subagents/<invocation-id>.jsonl`
- 종료된 cycle 이력: `.nexus/history.json`

## 1. Plan continuity 검증

### 목적

`plan`에서 한 번 호출한 HOW 참여자에게, 이후 follow-up 질문을 했을 때 단순 요약이 아니라 실제 orchestration continuity를 기반으로 이어지는지 확인합니다.

### 절차

1. HOW 참여자 한 명으로 plan을 시작합니다.
2. 그 참여자에게 하나의 구체적인 질문을 합니다.
3. 같은 참여자에게 후속 질문을 합니다.
4. 상태 파일과 로그를 확인합니다.

### 예시 프롬프트

1. `[plan] 아키텍트 참석해. 이 구조의 장단점 짧게 말해줘.`
2. `[plan] 아까 아키텍트에게 이어서 물어봐. 이 접근의 가장 큰 리스크는 뭐야?`

### 기대 확인 항목

- `plan.opencode.json`
  - 해당 role이 `panel.participants`에 존재해야 함
  - `last_summary`가 갱신되어 있어야 함
- `orchestration.opencode.json`
  - 해당 role의 invocation이 존재해야 함
  - continuity에 `child_session_id`가 있어야 함
  - 보통 `child_task_id`도 함께 있어야 함
  - 후속 질문이 생기면 같은 role의 continuity 이력이 갱신되어야 함
- `all.jsonl`
  - `task`에 대한 `tool.execute.after` 레코드가 있어야 함
  - subagent metadata에 `session_id`가 있어야 함
  - follow-up 과정에서 continuity handle 재사용 흔적이 보여야 함
- plan 관련 출력
  - `nxPlanResume` / `nxPlanFollowup` 성격의 출력에 `opencode_task_tool_resume_handle`가 보여야 함

### PASS 기준

- 후속 질문이 완전히 새로운 cold start처럼 보이지 않아야 함
- 같은 role에 대한 orchestration continuity가 `orchestration.opencode.json`에 남아 있어야 함
- 후속 질문 출력이 stale sidecar 값이 아니라 core 기반 `session_id` / resume handle을 사용해야 함

## 2. Run continuity 검증

### 목적

`run`에서 한 번 호출한 서브에이전트가 이후 같은 role/group으로 다시 호출될 때 continuity가 주입되는지 확인합니다.

### 절차

1. `run` task cycle을 시작합니다.
2. engineer 서브에이전트를 한 번 호출합니다.
3. 같은 engineer에게 같은 맥락으로 한 번 더 요청합니다.
4. 로그와 orchestration 상태를 확인합니다.

### 예시 프롬프트

1. `[run] 간단한 실험 작업 하나 등록하고 엔지니어에게 현재 상태를 한 줄로 요약하게 해.`
2. `[run] 방금 엔지니어에게 이어서 같은 맥락으로 한 줄 더 물어봐.`

### 기대 확인 항목

- `orchestration.opencode.json`
  - `engineer`에 대한 완료 invocation이 존재해야 함
  - continuity에 `child_session_id`, `child_task_id`가 있어야 함
  - 경우에 따라 `resume_*`도 함께 있어야 함
- `all.jsonl`
  - 첫 번째 `task`의 `tool.execute.before`에는 prior continuity가 없으면 `resume_*` 주입이 없어야 함
  - 이후 같은 role/group 호출에서는 `resume_task_id`, `resume_session_id`가 주입되어야 함
  - `resume_handles`가 있으면 그것도 함께 전달되어야 함

### PASS 기준

- 두 번째 호출에서 continuity 주입이 감사 로그에 보여야 함
- orchestration 상태의 최신 continuity가 가장 최근 완료된 subagent 실행과 일치해야 함

## 3. Run task pipeline 검증

### 목적

아래 task pipeline 전체가 정상 동작하는지 확인합니다.

`nx_task_add -> edit/work -> nx_task_update -> verify -> nx_task_close`

### 절차

1. 실제 task cycle이 열리는 `[run]` 요청을 보냅니다.
2. Nexus task가 생성되는지 확인합니다.
3. task cycle이 없을 때는 편집이 막히고, task가 생긴 뒤에는 허용되는지 확인합니다.
4. task status를 한 번 이상 갱신합니다.
5. cycle을 닫습니다.
6. history/archive를 확인합니다.

### 예시 프롬프트

1. `[run] 작은 문서 수정 작업 하나 진행해.`
2. 완료 후 `.nexus/state/tasks.json` 과 `.nexus/history.json` 확인

### 기대 확인 항목

- `tasks.json`
  - active cycle 동안 존재해야 함
  - `task-...` 형식의 id를 가져야 함
  - status 변경이 반영되어야 함
- task tool 출력
  - `nxTaskAdd`는 `task.id`를 반환해야 함
  - `nxTaskUpdate`는 `task.id`와 `status`를 반환해야 함
- edit guard
  - active task cycle 없이 파일 편집을 시도하면 거부되어야 함
- `history.json`
  - close 후 cycle이 archive 되어야 함
- `.nexus/state/tasks.json`
  - 성공적으로 close되면 제거되어야 함

### PASS 기준

- task id가 명시적 `task-...` 형식으로 드러나야 함
- cycle은 허용된 시점에만 close되어야 함
- 닫힌 cycle이 `.nexus/history.json`에 archive되어야 함

## 4. ID 분리 검증

### 목적

Nexus task id와 OpenCode task-tool resume handle이 혼동되지 않는지 확인합니다.

### 기대 확인 항목

- Nexus task 출력은 `task.id`를 사용해야 함
- plan follow-up 출력은 `opencode_task_tool_resume_handle`을 노출해야 함
- `nx_task_update`에 `ses_...` 값을 넣으면 설명적인 오류가 나와야 함

### PASS 기준

- `task-...`는 Nexus task-cycle 작업에만 사용되어야 함
- `ses_...`는 OpenCode resume handle로만 사용되어야 함

## 빠른 문제 확인 순서

뭔가 이상해 보이면 아래 순서로 확인합니다.

1. `all.jsonl`에서 실제 tool/event 순서를 본다
2. `orchestration.opencode.json`에서 continuity 상태를 본다
3. `plan.opencode.json`에서 panel membership과 summary를 본다
4. `tasks.json`에서 task-cycle 상태를 본다
5. `history.json`에서 close/archive 여부를 본다

## 수동 검증 결과 기록 형식

수동 검증 결과를 남길 때는 아래 형식을 추천합니다.

- 시나리오:
- 프롬프트:
- 기대 결과:
- 실제 결과:
- 확인한 증거 파일:
- PASS/FAIL:
