# 수동 E2E 체크리스트 빠른 버전

## 확인할 파일

- `.nexus/state/orchestration.opencode.json`
- `.nexus/state/plan.opencode.json`
- `.nexus/state/tasks.json`
- `.nexus/state/audit/all.jsonl`
- `.nexus/history.json`

## 1. Plan continuity

### 프롬프트

1. `[plan] 아키텍트 참석해. 이 구조의 장단점 짧게 말해줘.`
2. `[plan] 아까 아키텍트에게 이어서 물어봐. 이 접근의 가장 큰 리스크는 뭐야?`

### PASS 기준

- `orchestration.opencode.json`에 `architect` continuity가 생김
- `all.jsonl`에 follow-up 시 continuity 재사용 흔적이 보임
- 출력에 `opencode_task_tool_resume_handle`가 보임

## 2. Run continuity

### 프롬프트

1. `[run] 간단한 실험 작업 하나 등록하고 엔지니어에게 현재 상태를 한 줄로 요약하게 해.`
2. `[run] 방금 엔지니어에게 이어서 같은 맥락으로 한 줄 더 물어봐.`

### PASS 기준

- 첫 호출 후 `orchestration.opencode.json`에 `engineer` continuity가 생김
- 두 번째 호출의 `all.jsonl` `tool.execute.before`에 `resume_task_id` / `resume_session_id`가 주입됨

## 3. Run task pipeline

### 프롬프트

1. `[run] 작은 문서 수정 작업 하나 진행해.`

### PASS 기준

- `tasks.json`에 `task-...` id가 생성됨
- 작업 중 status가 바뀜
- 종료 후 `tasks.json`이 사라지고 `.nexus/history.json`에 archive가 남음

## 4. ID 분리

### PASS 기준

- Nexus task 출력은 `task.id`
- plan follow-up 출력은 `opencode_task_tool_resume_handle`
- `task-...`와 `ses_...`를 서로 혼용하지 않음

## 문제 생기면 보는 순서

1. `all.jsonl`
2. `orchestration.opencode.json`
3. `plan.opencode.json`
4. `tasks.json`
5. `history.json`
