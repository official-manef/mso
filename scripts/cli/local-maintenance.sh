#!/usr/bin/env bash
# Dispatch local maintenance before sourcing credentials or creating a cookie jar.
case "${1-}" in
  help|-h|--help)
    # shellcheck source=help.sh
    source "$ROOT/scripts/cli/help.sh"; usage; exit 0 ;;
  passwd)
    [ -z "$BASE_OVERRIDE$ENV_OVERRIDE${MSO_BASE:-}${OS_BASE:-}${MSO_ENV:-}${OS_ENV:-}" ] \
      || die "passwd edits this local installation; omit --base/--env and their environment overrides"
    shift
    source "$ROOT/scripts/cli/passwd.sh"
    mso_passwd "$ROOT" "$@"
    exit $? ;;
  heartbeat)
    [ -z "$BASE_OVERRIDE" ] || die "heartbeat is local-only; omit --base"
    shift
    MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="${ENV_OVERRIDE:-${MSO_ENV:-${OS_ENV:-$ROOT/.env.local}}}" exec "$ROOT/scripts/mso-heartbeat" "$@" ;;
  reset|uninstall)
    [ -z "$BASE_OVERRIDE$ENV_OVERRIDE${MSO_BASE:-}${OS_BASE:-}${MSO_ENV:-}${OS_ENV:-}" ] \
      || die "maintenance is local-only; omit --base/--env and run over SSH on the intended host"
    exec node "$ROOT/scripts/mso-maintenance.mjs" "$@" ;;
  tenant)
    [ -z "$BASE_OVERRIDE$ENV_OVERRIDE${MSO_BASE:-}${OS_BASE:-}${MSO_ENV:-}${OS_ENV:-}" ] \
      || die "tenant enrollment is local-only; omit --base/--env and run over SSH on the intended host"
    shift
    set -a; . "$ROOT/.env.local" 2>/dev/null || true; set +a
    export PATH="$HOME/.bun/bin:$PATH"
    exec bun "$ROOT/scripts/mso-tenant.ts" "$@" ;;
esac

