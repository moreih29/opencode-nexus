# Engineer Note

- 현재 로그는 부모 세션 기준으로 `session_id`를 묶고, `task` 호출마다 `subagent-N` `invocation_id`를 남깁니다.
- 서브에이전트가 실제 `sessionId`를 반환하면 부모 세션 로그와 하위 세션 식별자를 함께 연결할 수 있습니다.
- 훅 payload에 식별자가 없거나 모델 호출이 실패하면 실행 흔적은 남지만 결과 산출물은 비어 있을 수 있습니다.
