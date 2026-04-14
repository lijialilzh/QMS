#!/bin/zsh
set -euo pipefail

TARGET_DIR="${1:-$HOME/Downloads}"
count=0

for f in "$TARGET_DIR"/srs_doc_*.docx; do
  [[ -e "$f" ]] || continue
  xattr -d com.apple.quarantine "$f" 2>/dev/null || true
  count=$((count + 1))
done

echo "Processed $count file(s) in $TARGET_DIR"
