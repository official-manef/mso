#!/usr/bin/env bash
# AI provider authentication: connect OAuth (device flow), paste/flag an API key,
# or declare a custom OpenAI/Anthropic-compatible endpoint. Sourced by
# scripts/mso-cli-agent.sh after HTTP/TTY transport and the provider catalog exist.
# Split out of mso-cli-agent.sh to keep that slice under the architecture line budget.

configure_oauth_provider() {
  local provider="$1" response code url interval poll
  [ "$provider" = "openai-codex" ] || die "OAuth provider not supported yet: $provider"
  response=$(jpost "/api/oauth/openai" '{"action":"start","select":false}')
  code=$(jq -r '.userCode // empty' <<<"$response"); url=$(jq -r '.verificationUrl // empty' <<<"$response"); interval=$(jq -r '.intervalMs // 5000' <<<"$response")
  [ -n "$code" ] && [ -n "$url" ] || die "OpenAI OAuth did not return a device code"
  echo "Open this URL in any browser: $url"
  echo "Enter code: $code"
  echo "Waiting for authorization (active model will NOT change)..."
  while true; do
    poll_seconds=$((interval / 1000))
        [ "$poll_seconds" -gt 2 ] || poll_seconds=3
        sleep "$poll_seconds"
    poll=$(jpost "/api/oauth/openai" '{"action":"poll","select":false}')
    if [ "$(jq -r '.ok // false' <<<"$poll")" = true ]; then
      echo "  ✓ connected $(jq -r '.slug' <<<"$poll"); model selection unchanged"
      return
    fi
    [ "$(jq -r '.pending // false' <<<"$poll")" = true ] || die "OpenAI OAuth failed: $poll"
    tty_print "."
  done
}

usage_models_add() {
  cat <<'TXT'
usage: mso models add <provider> [options]
       mso models add <name> --base-url <url> --api-key <key>   # custom endpoint

Options:
  --api-key <key>        Credential value (skips the hidden prompt; use in scripts/CI)
  --type api-key|oauth   Credential type (default: api-key; oauth only: openai-codex)
  --name <name>          Display name for a custom endpoint (defaults to the provider arg)
  --base-url <url>       Custom OpenAI/Anthropic-compatible base URL
  --protocol <p>         Custom endpoint protocol: openai (default) | anthropic
  --models <ids>         Custom endpoint model ids, comma/newline separated
                         (leave empty and the endpoint's own list API is queried)
TXT
}

# Ask a custom endpoint which model ids it actually serves. Populates
# DISCOVERED_MODELS (newline-separated) and returns 0 only on a usable answer,
# so a caller can fall back to manual ids. The key travels in the stdin-bodied
# secret_post body, never process argv, and is never echoed back.
discover_custom_models() {
  local base="$1" key="$2" protocol="$3" body response
  DISCOVERED_MODELS=""
  body=$(printf '%s\0%s\0%s' "$base" "$key" "$protocol" | discover_body)
  response=$(secret_post "/api/models/discover" "$body" 2>/dev/null) || { unset body; return 1; }
  unset body
  [ "$(jq -r '.ok // false' <<<"$response")" = true ] || return 1
  DISCOVERED_MODELS=$(jq -r '.models[]?.id // empty' <<<"$response")
  [ -n "$DISCOVERED_MODELS" ]
}

configure_ai_provider() {
  local provider="${1:?provider required}"; shift || true
  local body name base="" protocol="" models="" api_key="" cred_type="" opt_name=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --api-key|--key) api_key="${2:?--api-key needs a value}"; shift 2 ;;
      --type) cred_type="${2:?--type needs api-key or oauth}"; shift 2 ;;
      --name) opt_name="${2:?--name needs a value}"; shift 2 ;;
      --base-url|--base) base="${2:?--base-url needs a value}"; shift 2 ;;
      --protocol) protocol="${2:?--protocol needs openai or anthropic}"; shift 2 ;;
      --models) models="${2:?--models needs a value}"; shift 2 ;;
      *) die "unknown provider option: $1 (see: mso models add --help)" ;;
    esac
  done
  case "$cred_type" in
    ""|api-key|api_key|key|oauth) ;;
    *) die "--type must be api-key or oauth" ;;
  esac
  case "$provider" in
    chatgpt|codex) provider=openai-codex ;;
  esac

  # OAuth (device flow) is a sign-in, never a pasted key.
  if [ "$cred_type" = oauth ] || [ "$provider" = openai-codex ]; then
    [ -z "$api_key" ] || die "--api-key cannot be combined with the OAuth provider $provider"
    configure_oauth_provider "$provider"; return
  fi

  # Custom / self-hosted endpoint: explicit `custom`, or any id with a --base-url.
  if [ "$provider" = custom ] || { [ -n "$base" ] && ! ai_provider_supported "$provider"; }; then
    name="$opt_name"; [ "$provider" = custom ] || [ -n "$name" ] || name="$provider"
    if ! tty_ok; then
      { [ -n "$name" ] && [ -n "$base" ] && [ -n "$api_key" ]; } \
        || die "custom provider in non-interactive mode needs --base-url and --api-key (and --name when the id is 'custom')"
    fi
    if [ -z "$name" ]; then tty_line "Provider name: " ""; name="$REPLY"; fi
    [ -n "$name" ] || die "provider name required"
    if [ -z "$base" ]; then tty_line "Base URL (https://.../v1): " ""; base="$REPLY"; fi
    [ -n "$base" ] || die "base URL required"
    if [ -z "$protocol" ]; then
      if tty_ok; then tty_line "Protocol [openai|anthropic] [openai]: " "openai"; protocol="$REPLY"; else protocol=openai; fi
    fi
    case "$protocol" in
      openai|anthropic) ;;
      *) die "protocol must be openai or anthropic" ;;
    esac
    # The key is needed to query what the endpoint serves, so it is collected
    # before models. An empty --models now asks the endpoint itself, instead of
    # leaving the picker for this custom provider empty.
    if [ -z "$api_key" ]; then tty_secret "API key: "; api_key="$REPLY"; fi
    [ -n "$api_key" ] || die "empty API key"
    if [ -z "$models" ] && discover_custom_models "$base" "$api_key" "$protocol"; then
      local discovered_count
      discovered_count=$(grep -c . <<<"$DISCOVERED_MODELS")
      if tty_ok; then
        echo "  discovered $discovered_count model(s) at $base:"
        while IFS= read -r m; do [ -n "$m" ] && printf '    %s\n' "$m"; done <<<"$DISCOVERED_MODELS"
        tty_line "Use all $discovered_count discovered models? [Y/n]: " "y"
        case "${REPLY,,}" in
          n|no) models=""; tty_line "Models (comma/newline IDs; optional): " ""; models="$REPLY" ;;
          *) models="$DISCOVERED_MODELS" ;;
        esac
      else
        models="$DISCOVERED_MODELS"
      fi
    elif [ -z "$models" ] && tty_ok; then
      echo "  · could not discover models automatically"
      tty_line "Models (comma/newline IDs; optional): " ""; models="$REPLY"
    fi
    body=$(printf '%s\0%s\0%s\0%s\0%s' "$name" "$base" "$protocol" "$api_key" "$models" | custom_provider_body_unselected)
    secret_post "/api/config" "$body" >/dev/null
    unset api_key body REPLY
    echo "  ✓ custom provider configured; active model unchanged"
    return
  fi

  ai_provider_supported "$provider" || die "unknown/unsupported AI provider '$provider'; run: mso models free or mso models add"
  if [ -z "$api_key" ]; then
    tty_ok || die "provider setup needs a credential; pass --api-key <key> or run interactively"
    tty_secret "Paste $provider API key: "; api_key="$REPLY"
  fi
  [ -n "$api_key" ] || die "empty API key"
  body=$(printf '%s\0%s' "$provider" "$api_key" | provider_key_body_unselected)
  secret_post "/api/config" "$body" >/dev/null
  unset api_key body REPLY
  echo "  ✓ $provider configured; active model unchanged"
}
