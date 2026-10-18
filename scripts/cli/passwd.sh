#!/usr/bin/env bash
# Local password setup runs before env sourcing, HTTP auth or cookie-jar creation.
set +x
mso_passwd() {
  local root="$1"; shift
  case "${1-}" in
    -h|--help|help)
      [ "$#" -eq 1 ] || die "usage: mso passwd [status]"
      printf '%s\n' 'usage: mso passwd [status]' \
        'Set/change the local login password with hidden prompts (6-128 supported characters).' \
        'An existing password is required to change it. status shows metadata only.' \
        'Fresh setup creates the session secret with MCP disabled; no device is approved.' \
        'No server is started/restarted. Existing sessions remain valid.'
      return ;;
    status) [ "$#" -eq 1 ] || die "usage: mso passwd [status]" ;;
    '') [ "$#" -eq 0 ] || die "password arguments are forbidden; run mso passwd" ;;
    *) die "password arguments are forbidden; run mso passwd" ;;
  esac
  local runner
  runner=$(command -v bun) || die "bun is required for mso passwd"
  if [ "${1-}" = status ]; then "$runner" "$root/scripts/mso-passwd.ts" "$root" status; return; fi
  [ -t 0 ] || die "a terminal is required; password input cannot be piped"
  local state current='' next confirm
  state=$("$runner" "$root/scripts/mso-passwd.ts" "$root" status) || return
  exec 3< /dev/tty 4> /dev/tty || { die "a terminal is required; password input cannot be piped"; }
  if [[ "$state" == '{"configured":true,'* ]]; then
    read -r -s -p 'Current password: ' -u 3 current || { exec 3<&- 4>&-; return 1; }
    printf '\n' >&4
  fi
  read -r -s -p 'New password: ' -u 3 next || { exec 3<&- 4>&-; return 1; }
  printf '\n' >&4
  read -r -s -p 'Confirm password: ' -u 3 confirm || { exec 3<&- 4>&-; return 1; }
  printf '\n' >&4
  exec 3<&- 4>&-
  printf '%s\0' "$current" "$next" "$confirm" | "$runner" "$root/scripts/mso-passwd.ts" "$root" set
}
