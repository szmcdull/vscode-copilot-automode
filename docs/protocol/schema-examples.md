# Protocol schema examples

These JSON samples match the TypeScript protocol mirror in `adapter-vscode/src/protocol/types.ts`. Field names use snake_case for JSON interchange.

`OperationRequest.normalized_effects` is required on the wire (use `{}` when there is no summarized impact). `ReviewDecision.trace` is required and must not be JSON `null`.

## Direct `allow` (`ReviewDecision`)

```json
{
  "decision": "allow",
  "reason": "read-only shell metadata query",
  "risk_level": "low",
  "trace": {
    "empty_constraint_confirmation": true,
    "branch": "hard_allow"
  }
}
```

## Direct `deny` (`ReviewDecision`)

```json
{
  "decision": "deny",
  "reason": "destructive delete outside workspace",
  "risk_level": "critical",
  "trace": {
    "empty_constraint_confirmation": true,
    "branch": "hard_deny"
  }
}
```

## `AskChallenge` (only wire form for `decision=ask`)

`review_snapshot` and `decision_context.current_review_snapshot` must be semantically identical JSON objects (both `decision: "ask"`).

`provide_context` is a valid schema token, but the current local extension flow only uses `approve`, `deny`, and `cancel`. Include `provide_context` only when both sides explicitly support it.

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "prompt_text": "This command may touch network and write files. Approve, deny, or cancel.",
  "review_snapshot": {
    "decision": "ask",
    "reason": "static rules and AI could not finalize without user input",
    "risk_level": "high",
    "trace": {
      "empty_constraint_confirmation": true,
      "branch": "ai_or_policy_ask"
    }
  },
  "decision_context": {
    "current_review_snapshot": {
      "decision": "ask",
      "reason": "static rules and AI could not finalize without user input",
      "risk_level": "high",
      "trace": {
        "empty_constraint_confirmation": true,
        "branch": "ai_or_policy_ask"
      }
    },
    "matched_risk_labels": [
      "untrusted_network",
      "touches_sensitive_file"
    ],
    "overridable_permissions": [
      "filesystem_write",
      "network_egress"
    ],
    "hard_boundary_summary": "credential_access and workspace_escape cannot be overridden by user action."
  },
  "allowed_user_actions": [
    "approve",
    "deny",
    "cancel"
  ],
  "timeout_behavior": "deny"
}
```

## `allow_with_constraints` (`ReviewDecision`)

```json
{
  "decision": "allow_with_constraints",
  "reason": "permitted edit with path and host limits",
  "risk_level": "medium",
  "constraints": {
    "path_allowlist": ["/home/user/proj/src", "/home/user/proj/docs"],
    "workspace_only": true,
    "forbid_delete": true,
    "host_allowlist": ["api.example.com", "registry.npmjs.org"],
    "command_template_allowlist": ["npm run *", "git diff *"]
  },
  "trace": {
    "constraint_template_ids": ["path_allowlist_v1", "host_allowlist_v1"],
    "ai_risk_level": "medium"
  }
}
```

## `ReviewHTTPResponse` with pending ask

```json
{
  "request_id": "shell-1",
  "status": "ask_pending",
  "adapter_identity": "vscode:auto-mode",
  "ask_challenge": {
    "request_id": "shell-1",
    "prompt_text": "Approve running tests?",
    "review_snapshot": {
      "decision": "ask",
      "reason": "needs approval",
      "risk_level": "high",
      "trace": {
        "steps": ["review"]
      }
    },
    "decision_context": {
      "current_review_snapshot": {
        "decision": "ask",
        "reason": "needs approval",
        "risk_level": "high",
        "trace": {
          "steps": ["review"]
        }
      },
      "matched_risk_labels": [],
      "overridable_permissions": ["shell_execute"],
      "hard_boundary_summary": "Need explicit approval."
    },
    "allowed_user_actions": ["approve", "deny"],
    "timeout_behavior": "deny"
  }
}
```

## `ReviewHTTPResponse` after user decision

```json
{
  "request_id": "shell-1",
  "status": "final",
  "adapter_identity": "vscode:auto-mode",
  "review_decision": {
    "decision": "allow",
    "reason": "user approved ask challenge",
    "risk_level": "high",
    "trace": {
      "steps": ["user_override", "approve"]
    }
  }
}
```

## `AuditRecord` with `ai_review_status=failed`

When AI review fails, input summary is retained, output is JSON `null`, and `ai_review_error` carries structured failure data.

```json
{
  "request": {
    "id": "op-20260403-001",
    "source": "vscode",
    "session": "sess-abc",
    "workspace": "/home/user/proj",
    "tool": "run_terminal_cmd",
    "category": "shell",
    "intent": "install dependency",
    "arguments": {"command": "npm install"},
    "normalized_effects": {
      "may_use_network": true,
      "may_spawn_process": true,
      "escapes_workspace": false
    },
    "requested_permissions": ["network_egress", "process_spawn"],
    "timestamp": "2026-04-03T12:00:00Z"
  },
  "risk_classification": {
    "labels": ["unknown_mcp_tool"],
    "aggregated_risk_level": "medium"
  },
  "final_decision": {
    "decision": "ask",
    "reason": "AI review failed; conservative fallback",
    "risk_level": "medium",
    "trace": {
      "fallback": "ai_failure_to_ask"
    }
  },
  "ai_review_status": "failed",
  "ai_review_input_summary": "goal=install deps; category=shell; effects include network",
  "ai_review_output": null,
  "ai_review_error": {
    "failure_stage": "response_parse",
    "error_code": "invalid_json",
    "detail": "model returned non-object root"
  },
  "execution_result": "",
  "user_overrode": false,
  "duration_ms": 842,
  "host_blind_spot_tags": ["adapter_context_incomplete"]
}
```
