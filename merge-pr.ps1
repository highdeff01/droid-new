<#
merge-pr.ps1 - safely merge a PR: update branch from main, resolve conflicts, verify, merge.

Usage (run from repo root in PowerShell):
  .\merge-pr.ps1 -Pr 19                  # merge main into PR branch, stop on conflicts
  .\merge-pr.ps1 -Pr 19 -Union           # auto-resolve conflicts by keeping BOTH sides
  .\merge-pr.ps1 -Pr 19 -Union -Merge    # ...then verify, push, and merge the PR on GitHub

Requires: git, gh (GitHub CLI, logged in), node/npm.
#>
param(
  [Parameter(Mandatory)][int]$Pr,
  [string]$Base = "main",
  [switch]$Union,
  [switch]$Merge
)

$ErrorActionPreference = "Stop"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Git { git @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" } }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) not found. Install it and run 'gh auth login'." }
if (git status --porcelain) { throw "Working tree is dirty. Commit or stash first." }

Step "Fetching and checking out PR #$Pr"
Git fetch origin
gh pr checkout $Pr
if ($LASTEXITCODE -ne 0) { throw "gh pr checkout failed" }
$branch = git rev-parse --abbrev-ref HEAD

Step "Merging origin/$Base into $branch"
git merge "origin/$Base" --no-edit
$conflicted = ($LASTEXITCODE -ne 0)

if ($conflicted) {
  $files = @(git diff --name-only --diff-filter=U)
  Write-Host "Conflicts in $($files.Count) file(s):" -ForegroundColor Yellow
  $files | ForEach-Object { Write-Host "  $_" }

  if (-not $Union) {
    Write-Host "`nRe-run with -Union to keep both sides automatically, or resolve by hand." -ForegroundColor Yellow
    Write-Host "To back out: git merge --abort"
    exit 1
  }

  Step "Union-resolving (keeping both sides)"
  $tmp = Join-Path $env:TEMP "merge-pr-$Pr"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $reviewList = @()

  foreach ($f in $files) {
    if ($f -match 'package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$') {
      git checkout --theirs -- $f   # take main's lockfile, regenerate later
      git add -- $f
      Write-Host "  lockfile: took $Base version of $f"
      continue
    }
    $ours = Join-Path $tmp "ours"; $base = Join-Path $tmp "base"; $theirs = Join-Path $tmp "theirs"
    Remove-Item $ours, $base, $theirs -ErrorAction SilentlyContinue
    cmd /c "git show :2:`"$f`" > `"$ours`" 2>nul"
    cmd /c "git show :3:`"$f`" > `"$theirs`" 2>nul"
    cmd /c "git show :1:`"$f`" > `"$base`" 2>nul"
    if (-not (Test-Path $ours) -or -not (Test-Path $theirs)) {
      Write-Host "  SKIP (delete/modify conflict, resolve by hand): $f" -ForegroundColor Red
      $reviewList += $f
      continue
    }
    if (-not (Test-Path $base) -or (Get-Item $base).Length -eq 0) { Set-Content $base "" -NoNewline }
    git merge-file --union $ours $base $theirs
    Copy-Item $ours $f -Force
    git add -- $f
    Write-Host "  union-merged: $f"
    $reviewList += $f
  }

  $left = @(git diff --name-only --diff-filter=U)
  if ($left.Count -gt 0) {
    Write-Host "`nStill unresolved, fix by hand then re-run verification:" -ForegroundColor Red
    $left | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
}

if (Test-Path package.json) {
  if ($conflicted -and (Test-Path package-lock.json)) {
    Step "Regenerating lockfile"
    npm install --package-lock-only
    git add package-lock.json
  }

  Step "Typecheck (tsc --noEmit)"
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`nTypecheck FAILED. Merge is NOT committed/pushed. Fix the errors (often duplicate definitions from the union merge) or run: git merge --abort" -ForegroundColor Red
    exit 1
  }

  Step "Tests (vitest run)"
  npx vitest run
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`nTests FAILED. Merge is NOT pushed. Fix them or run: git merge --abort" -ForegroundColor Red
    exit 1
  }
}

if (Test-Path ".git/MERGE_HEAD") {
  Step "Committing merge"
  Git commit --no-edit
}

Step "Pushing $branch"
Git push

if ($Merge) {
  Step "Merging PR #$Pr on GitHub"
  gh pr merge $Pr --merge
  if ($LASTEXITCODE -ne 0) { throw "gh pr merge failed" }
  Git checkout $Base
  Git pull origin $Base
  Write-Host "`nPR #$Pr merged and local $Base updated." -ForegroundColor Green
} else {
  Write-Host "`n$branch is verified and pushed. Re-run with -Merge, or merge on GitHub." -ForegroundColor Green
}
