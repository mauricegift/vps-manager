#!/bin/bash
# Push one or more files to GitHub via the API (bypasses git restrictions in Replit)
# Usage: ./push-to-github.sh "commit message" file1 file2 ...

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

PUSH_SCRIPT=$(mktemp /tmp/gh_push_XXXXXX.mjs)
trap "rm -f $PUSH_SCRIPT" EXIT

cat > "$PUSH_SCRIPT" << 'JSEOF'
import https from 'https';
import fs from 'fs';

const token  = process.env.GH_TOKEN;
const repo   = process.env.REPO;
const branch = process.env.BRANCH;
const msg    = process.env.MSG;
const file   = process.env.FILE;

const content = fs.readFileSync(file).toString('base64');

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'push-script',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
      },
    };
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    r.on('error', reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

const existing = await req('GET', `/repos/${repo}/contents/${file}?ref=${branch}`);
const sha = existing.sha || '';
const payload = { message: msg, content, branch };
if (sha) payload.sha = sha;
const result = await req('PUT', `/repos/${repo}/contents/${file}`, JSON.stringify(payload));
if (result.commit) {
  console.log('OK ' + result.commit.sha);
} else {
  console.log('ERR: ' + (result.message || JSON.stringify(result)));
}
JSEOF

for FILE in "$@"; do
  if [ ! -f "$FILE" ]; then
    echo "SKIP: $FILE not found"
    continue
  fi

  RESULT=$(GH_TOKEN="$GITHUB_TOKEN" REPO="$REPO" BRANCH="$BRANCH" MSG="$MSG" FILE="$FILE" \
    node --input-type=module < "$PUSH_SCRIPT" 2>&1)

  echo "$FILE -> $RESULT"
done
