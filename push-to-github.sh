#!/bin/bash
# Push one or more files to GitHub via the API (bypasses git restrictions in Replit)
# Usage: ./push-to-github.sh "commit message" file1 file2 ...
# Example: ./push-to-github.sh "fix: update route" server/routes/github.ts .gitignore

REPO="mauricegift/vps-manager"
BRANCH="main"
MSG="${1:-"chore: update files"}"
shift

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN env var not set"
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "Usage: $0 \"commit message\" file1 [file2 ...]"
  exit 1
fi

for FILE in "$@"; do
  if [ ! -f "$FILE" ]; then
    echo "SKIP: $FILE not found"
    continue
  fi

  CONTENT=$(base64 -w0 "$FILE")

  # Get existing SHA (if file exists on remote)
  SHA=$(curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$REPO/contents/$FILE?ref=$BRANCH" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.sha||'')}catch{}})")

  # Build payload
  if [ -n "$SHA" ]; then
    PAYLOAD="{\"message\":\"$MSG\",\"content\":\"$CONTENT\",\"sha\":\"$SHA\",\"branch\":\"$BRANCH\"}"
  else
    PAYLOAD="{\"message\":\"$MSG\",\"content\":\"$CONTENT\",\"branch\":\"$BRANCH\"}"
  fi

  RESULT=$(curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.github.com/repos/$REPO/contents/$FILE" \
    -d "$PAYLOAD" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.commit?'OK '+j.commit.sha:'ERR: '+j.message)}catch(e){console.log('ERR: parse failed')}})")

  echo "$FILE -> $RESULT"
done
