#!/usr/bin/env bash
# Quickstart: emit one valid agent spool file (schema v1).
#
#   bash examples/agent-file/emit.sh /path/to/spool --id demo --task "hello" --ttl-s 60
#   python3 serve.py --check /path/to/spool/demo.json   # -> check passed: agent file is valid
#
# Same CLI as emit.py. Writes <spool>/<id>.json atomically (temp file in the
# same dir that does not end in .json, sync, mv -f). bash + coreutils only.

set -eu

die() {
  printf 'emit: %s\n' "$1" >&2
  exit 2
}

is_int() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# JSON-escape a string: backslash, double quote, and control chars
# (newline, tab, carriage return, form feed, backspace).
json_escape() {
  local input=$1 out='' line last=''
  while IFS= read -r line || [ -n "$line" ]; do
    last=$line
    local i ch esc=''
    for ((i = 0; i < ${#line}; i++)); do
      ch=${line:i:1}
      case "$ch" in
        '\') esc='\\' ;;
        '"') esc='\"' ;;
        $'\n') esc='\n' ;;
        $'\t') esc='\t' ;;
        $'\r') esc='\r' ;;
        $'\f') esc='\f' ;;
        $'\b') esc='\b' ;;
        *) esc=$ch ;;
      esac
      out+=$esc
    done
    out+=$'\n'
  done < <(printf '%s' "$input")
  # Drop the newline we appended after the final line when the input did not
  # end with one (read -r consumed the last partial line without a newline).
  if [ -n "$last" ] && [ "${input: -1}" != $'\n' ]; then
    out=${out%$'\n'}
  fi
  printf '%s' "$out"
}

path=''
id=''
name=''
emoji=''
role=''
model=''
task=''
blocked=''
needs_decision=''
done=''
ctx_pct=''
ttl_s=''
log_entries=''
log_count=0
have_path=0
have_id=0
have_name=0
have_emoji=0
have_role=0
have_model=0
have_task=0
have_blocked=0
have_needs=0
have_done=0
have_ctx=0
have_ttl=0

while [ $# -gt 0 ]; do
  case "$1" in
    --id) id=${2:?}; have_id=1; shift 2 ;;
    --name) name=${2:?}; have_name=1; shift 2 ;;
    --emoji) emoji=${2:?}; have_emoji=1; shift 2 ;;
    --role) role=${2:?}; have_role=1; shift 2 ;;
    --model) model=${2:?}; have_model=1; shift 2 ;;
    --task) task=${2:?}; have_task=1; shift 2 ;;
    --blocked) blocked=${2:?}; have_blocked=1; shift 2 ;;
    --needs-decision) needs_decision=${2:?}; have_needs=1; shift 2 ;;
    --done) done=${2:?}; have_done=1; shift 2 ;;
    --ctx-pct) ctx_pct=${2:?}; have_ctx=1; shift 2 ;;
    --log) log_entries+=$(printf '"%s",' "$(json_escape "${2:?}")"); log_count=$((log_count + 1)); shift 2 ;;
    --ttl-s) ttl_s=${2:?}; have_ttl=1; shift 2 ;;
    --) shift; break ;;
    -*) die "unknown option: $1" ;;
    *)
      if [ "$have_path" -eq 1 ]; then
        die "unexpected argument: $1"
      fi
      path=$1
      have_path=1
      shift
      ;;
  esac
done

[ "$have_path" -eq 1 ] || die "missing spool directory argument"
[ "$have_id" -eq 1 ] || die "--id is required"

if [ "$have_ctx" -eq 1 ]; then
  is_int "$ctx_pct" || die "--ctx-pct must be an integer 0..100, got $ctx_pct"
  [ "$ctx_pct" -le 100 ] || die "--ctx-pct must be an integer 0..100, got $ctx_pct"
fi
if [ "$have_ttl" -eq 1 ]; then
  is_int "$ttl_s" || die "--ttl-s must be a positive integer, got $ttl_s"
  [ "$ttl_s" -ge 1 ] || die "--ttl-s must be a positive integer, got $ttl_s"
fi

mkdir -p -- "$path"

json='{"office": 1, "id": "'
json+="$(json_escape "$id")"
json+='"'
if [ "$have_name" -eq 1 ]; then
  json+=", \"name\": \"$(json_escape "$name")\""
fi
if [ "$have_emoji" -eq 1 ]; then
  json+=", \"emoji\": \"$(json_escape "$emoji")\""
fi
if [ "$have_role" -eq 1 ]; then
  json+=", \"role\": \"$(json_escape "$role")\""
fi
if [ "$have_model" -eq 1 ]; then
  json+=", \"model\": \"$(json_escape "$model")\""
fi
if [ "$have_task" -eq 1 ]; then
  json+=", \"task\": \"$(json_escape "$task")\""
fi
if [ "$have_blocked" -eq 1 ]; then
  json+=", \"blocked\": \"$(json_escape "$blocked")\""
fi
if [ "$have_needs" -eq 1 ]; then
  json+=", \"needs_decision\": \"$(json_escape "$needs_decision")\""
fi
if [ "$have_done" -eq 1 ]; then
  case "$done" in
    *=*)
      done_label=${done%%=*}
      done_url=${done#*=}
      json+=", \"done\": {\"label\": \"$(json_escape "$done_label")\", \"url\": \"$(json_escape "$done_url")\"}"
      ;;
    *)
      json+=", \"done\": \"$(json_escape "$done")\""
      ;;
  esac
fi
if [ "$have_ctx" -eq 1 ]; then
  json+=", \"ctx_pct\": $ctx_pct"
fi
if [ "$log_count" -gt 0 ]; then
  json+=", \"log\": [${log_entries%,}]"
fi
if [ "$have_ttl" -eq 1 ]; then
  json+=", \"ttl_s\": $ttl_s"
fi
json+='}'

# §3.4 atomic write: temp file in the same dir, name NOT ending in .json,
# sync, then mv -f onto the final path.
tmp=$(mktemp -- "$path/.$id.json.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
printf '%s\n' "$json" >"$tmp"
sync -- "$tmp"
mv -f -- "$tmp" "$path/$id.json"
trap - EXIT
