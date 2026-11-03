#!/bin/sh
# Minimal jshn-compatible stub for unit tests.
#
# Implements only the subset used by the mesh-lite rpcd plugin:
#   json_init, json_add_string, json_add_boolean, json_add_int,
#   json_add_array, json_add_object, json_close_array, json_close_object,
#   json_dump, json_load, json_get_var
#
# State lives in a temp directory (one file per depth) so no eval quoting is
# involved. This is test-only infrastructure; production uses libubox jshn.

_json_escape() {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

json_init() {
	_J_DIR="$(mktemp -d)"
	printf '0' > "$_J_DIR/depth"
	printf 'o' > "$_J_DIR/type.0"
	: > "$_J_DIR/name.0"
	printf '1' > "$_J_DIR/first.0"
	: > "$_J_DIR/content.0"
}

_json_depth() { cat "$_J_DIR/depth"; }

_json_append() {
	local d type first sep piece

	d="$(_json_depth)"
	type="$(cat "$_J_DIR/type.$d")"
	first="$(cat "$_J_DIR/first.$d")"

	sep=''
	[ "$first" = '1' ] || sep=,

	if [ "$type" = 'o' ]; then
		piece="$sep\"$1\":$2"
	else
		piece="$sep$2"
	fi

	printf '%s' "$piece" >> "$_J_DIR/content.$d"
	printf '0' > "$_J_DIR/first.$d"
}

json_add_string() {
	_json_append "$1" "\"$(_json_escape "$2")\""
}

json_add_boolean() {
	case "$2" in
		1|true|TRUE) _json_append "$1" 'true' ;;
		*) _json_append "$1" 'false' ;;
	esac
}

json_add_int() {
	_json_append "$1" "${2:-0}"
}

_json_push() {
	local d

	d="$(_json_depth)"
	d=$((d + 1))
	printf '%s' "$1" > "$_J_DIR/name.$d"
	printf '%s' "$2" > "$_J_DIR/type.$d"
	printf '1' > "$_J_DIR/first.$d"
	: > "$_J_DIR/content.$d"
	printf '%s' "$d" > "$_J_DIR/depth"
}

json_add_array() { _json_push "$1" 'a'; }
json_add_object() { _json_push "$1" 'o'; }

_json_pop() {
	local d type name cont open close

	d="$(_json_depth)"
	type="$(cat "$_J_DIR/type.$d")"
	name="$(cat "$_J_DIR/name.$d")"
	cont="$(cat "$_J_DIR/content.$d")"

	if [ "$type" = 'o' ]; then
		open='{'; close='}'
	else
		open='['; close=']'
	fi

	d=$((d - 1))
	printf '%s' "$d" > "$_J_DIR/depth"
	_json_append "$name" "$open$cont$close"
}

json_close_array() { _json_pop; }
json_close_object() { _json_pop; }

json_dump() {
	printf '{%s}\n' "$(cat "$_J_DIR/content.0")"
}

json_load() { :; }
json_get_var() { :; }
