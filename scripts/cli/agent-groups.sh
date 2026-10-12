#!/usr/bin/env bash
# Agent groups CLI. Each member runs as its own headless Hermes profile; bot
# tokens stay in Integrations and are only referenced by connection id here.
run_agent_groups() {
  local sub="${1:-list}" id="" run_id="" input='{}' revision="" prompt="" members="" body
  shift || true
  case "$sub" in
    show|save|delete|run) id="${1:?group id required}"; shift ;;
    stop) run_id="${1:?run id required}"; shift ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --input) input="${2:?JSON or @file required}"; shift 2 ;;
      --revision) revision="${2:?revision required}"; shift 2 ;;
      --prompt) prompt="${2:?prompt required}"; shift 2 ;;
      --members) members="${2:?comma-separated member ids required}"; shift 2 ;;
      *) die "unknown agent-groups option: $1" ;;
    esac
  done
  if [ "${input:0:1}" = "@" ]; then input=$(cat -- "${input:1}"); fi
  case "$sub" in
    list) jget "/api/v1/agent-groups" ;;
    show) jget "/api/v1/agent-groups?id=$(enc "$id")" ;;
    create)
      body=$(jq -n --argjson data "$input" '{action:"create",data:$data}')
      jpost "/api/v1/agent-groups" "$body" ;;
    save)
      [ -n "$revision" ] || die "agent-groups save requires --revision"
      body=$(jq -n --arg id "$id" --argjson revision "$revision" --argjson data "$input" '{action:"update",id:$id,expectedRevision:$revision,data:$data}')
      jpost "/api/v1/agent-groups" "$body" ;;
    delete)
      [ -n "$revision" ] || die "agent-groups delete requires --revision"
      body=$(jq -n --arg id "$id" --argjson revision "$revision" '{action:"delete",id:$id,expectedRevision:$revision}')
      jpost "/api/v1/agent-groups" "$body" ;;
    run)
      [ -n "$prompt" ] || die "agent-groups run requires --prompt"
      body=$(jq -n --arg id "$id" --arg prompt "$prompt" --arg members "$members" \
        '{action:"run",id:$id,prompt:$prompt}+if $members!="" then {members:($members|split(","))} else {} end')
      jpost "/api/v1/agent-groups" "$body" ;;
    stop)
      body=$(jq -n --arg runId "$run_id" '{action:"stop",runId:$runId}')
      jpost "/api/v1/agent-groups" "$body" ;;
    *) die "usage: mso ${U_agent_groups:-agent-groups}" ;;
  esac
}
