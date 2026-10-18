#!/usr/bin/env bash

run_agent_profiles() {
  local action="${1:-list}"; shift || true
  case "$action" in
    list) jget "/api/v1/agent-profiles" ;;
    create|edit|clone|default|enable|disable)
      local input
      input="$(json_arg "${1:?JSON or @file with expectedRevision and reason}")"
      jpost "/api/v1/agent-profiles" "$(jq -c --arg action "$action" '. + {action:$action}' <<< "$input")" ;;
    run) jpost "/api/v1/agent-profiles/run" "$(json_arg "${1:?JSON or @file with profileId, profileRevision and prompt}")" ;;
    *) die "usage: mso ${U_agent_profiles:-agent-profiles}" ;;
  esac
}
