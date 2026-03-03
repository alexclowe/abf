#!/bin/bash
# Validates ABF agent YAML files after they are written or edited.
# Called by the PostToolUse hook when Write or Edit tools are used.
# Checks that *.agent.yaml files have the required fields.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file // empty')

# Only validate agent YAML files
if [[ ! "$FILE_PATH" =~ \.agent\.yaml$ ]]; then
  exit 0
fi

# Check file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

ERRORS=""

# Check required fields
for field in "name:" "display_name:" "role:" "description:"; do
  if ! grep -q "^${field}" "$FILE_PATH" 2>/dev/null; then
    ERRORS="${ERRORS}Missing required field: ${field%:}\n"
  fi
done

# Check name is kebab-case (if present)
NAME=$(grep "^name:" "$FILE_PATH" 2>/dev/null | head -1 | sed 's/^name: *//' | tr -d '"\x27')
if [ -n "$NAME" ] && ! echo "$NAME" | grep -qE '^[a-z][a-z0-9-]*$'; then
  ERRORS="${ERRORS}Agent name must be kebab-case (lowercase letters, numbers, hyphens): got '${NAME}'\n"
fi

# Check temperature range (if present)
TEMP=$(grep "^temperature:" "$FILE_PATH" 2>/dev/null | head -1 | sed 's/^temperature: *//')
if [ -n "$TEMP" ]; then
  if ! echo "$TEMP" | grep -qE '^[0-9]*\.?[0-9]+$'; then
    ERRORS="${ERRORS}Temperature must be a number: got '${TEMP}'\n"
  fi
fi

# Check valid archetype (if present)
ARCHETYPE=$(grep "^role_archetype:" "$FILE_PATH" 2>/dev/null | head -1 | sed 's/^role_archetype: *//' | tr -d '"\x27')
if [ -n "$ARCHETYPE" ]; then
  VALID="researcher writer orchestrator analyst customer-support developer marketer finance monitor generalist"
  if ! echo "$VALID" | grep -qw "$ARCHETYPE"; then
    ERRORS="${ERRORS}Invalid role_archetype '${ARCHETYPE}'. Must be one of: ${VALID}\n"
  fi
fi

if [ -n "$ERRORS" ]; then
  echo -e "ABF agent YAML validation warnings for ${FILE_PATH}:\n${ERRORS}" >&2
  # Exit 0 (not 2) — warn but don't block the operation
  exit 0
fi

exit 0
