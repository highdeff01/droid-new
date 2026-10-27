<#
consolidate-prs.ps1 - union-merge a wave of PR branches into one fresh consolidation branch.

Every branch is merged one at a time, in the order given, with git's union merge driver
(conflicting hunks keep BOTH sides), so no feature is lost. The union result usually has
duplicate declarations/imports to weed out afterwards - run tsc/vitest and repair before pushing.

Usage (run from repo root in PowerShell):
  .\consolidate-prs.ps1                                       # default wave, branch consolidate/pr-wave-<date>
  .\consolidate-prs.ps1 -Branch consolidate/wave-2 -Branches highdeff/a, highdeff/b
  .\consolidate-prs.ps1 -Branches (gh pr list --state open --json headRefName -q '.[].headRefName')
  .\consolidate-prs.ps1 -Verify                               # also run tsc + vitest at the end
  .\consolidate-prs.ps1 -Push                                 # push the branch when done

Requires: git (gh only for the example above), node/npm when -Verify is used.
#>
param(
  [string[]]$Branches = @(
    "highdeff/auto-element-mapping-with-position",        # #61 element mapping
    "highdeff/multi-element-chained-workflow-execution",  # #56 multi-element chains
    "highdeff/workflow-packs-record-combine-cross-run",   # #53 workflow packs
    "highdeff/operation-memory-notes-blacklists",         # #52 operation memory
    "highdeff/ai-snip-tool-and-mid-operation-reroute",    # #54 snip/reroute
    "highdeff/full-screen-reading-route-plotting-fix",    # #55 screen reading/fix scripts
    "highdeff/25-agent-crew-for-coordinates-paths",       # #64 25-agent crew
    "highdeff/position-memory-with-diffs-and",            # #59 position memory
    "highdeff/screen-section-profiles-and-side",          # #65 screen sections
    "highdeff/wake-timer-backup-watcher-parallel",        # #58 wake-and-continue
    "highdeff/ai-directed-agent-crew-with-parallel",      # #60 agent crew + stop-plan
    "highdeff/ai-initiative-scan-self-test-create",       # #62 AI initiative
    "highdeff/goal-tracer-agent-with-per-operation",      # #68 goal tracer
    "highdeff/system-info-notifications-auto-act",        # #71 system info/notifications
    "highdeff/operations-agent-group-monitor-log-test",   # #73 operations agents
    "highdeff/project-lifecycle-engine-follow-up",        # #74 lifecycle engine
    "highdeff/empty-content-ai-resilience-and-master",    # #75 AI resilience + master prompt
    "highdeff/operation-database-with-cross",             # #76 operation database
    "highdeff/presentation-slideshows-movies-rich",       # #78 slideshows/movies (superset of #72)
    "highdeff/execution-modes-parallel-thoughtful",       # #82 execution modes
    "highdeff/ai-resolution-center-and-recovery",         # #80 resolution center
    "highdeff/real-interactive-screen-mirror-for-user",   # #79 interactive screen mirror
    "highdeff/main-app-bridge-client-with-capture-and",   # #63 main-app bridge client
    "highdeff/configurable-ai-thinking-toggle-default",   # #83 aiThink default off
    "highdeff/thinking-on-escalation-convo-updates",      # #84 thinking-on escalation
    "highdeff/saved-operations-30s-ai-playback-smart"     # #66 saved operations/playback
  ),
  [string]$Base = "main",
  [string]$Branch = "consolidate/pr-wave-$(Get-Date -Format yyyyMMdd-HHmm)",
  [switch]$Verify,
  [switch]$Push
)

$ErrorActionPreference = "Stop"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Git { git @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" } }

if (git status --porcelain) { throw "Working tree is dirty. Commit or stash first." }

$lockfiles = 'package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$'
$attrFile = Join-Path (git rev-parse --git-dir) "info/attributes"
$attrBackup = $null

Step "Fetching origin/$Base and $($Branches.Count) PR branch(es)"
Git fetch origin "+refs/heads/${Base}:refs/remotes/origin/$Base"
foreach ($b in $Branches) {
  git fetch origin "+refs/heads/${b}:refs/remotes/origin/$b"
  if ($LASTEXITCODE -ne 0) { Write-Host "  could not fetch $b (merge will be marked failed)" -ForegroundColor Yellow }
}

Step "Creating $Branch from origin/$Base"
Git checkout -B $Branch "origin/$Base"

# Union driver for every text file (git's "-X union"); lockfiles keep the consolidation side.
function Enable-Union {
  New-Item -ItemType Directory -Force (Split-Path $attrFile) | Out-Null
  Set-Content $attrFile "* merge=union`npackage-lock.json -merge`npnpm-lock.yaml -merge`nyarn.lock -merge"
}
function Disable-Union {
  if ($null -ne $attrBackup) { Set-Content $attrFile $attrBackup -NoNewline } else { Remove-Item $attrFile -ErrorAction SilentlyContinue }
}

# Returns clean / union-merged / failed for one branch; leaves a commit on success, nothing on failure.
function Merge-Branch($b) {
  if (-not (git rev-parse --verify --quiet "refs/remotes/origin/$b")) { return "failed" }
  git merge --no-ff --no-edit -m "Consolidate $b" "origin/$b"
  if ($LASTEXITCODE -eq 0) { return "clean" }
  git merge --abort

  Enable-Union
  try {
    git merge --no-ff --no-edit -m "Consolidate $b (union merge)" "origin/$b"
    if ($LASTEXITCODE -eq 0) { return "union-merged" }
    foreach ($f in @(git diff --name-only --diff-filter=U)) {
      if ($f -match $lockfiles) { git checkout --ours -- $f; git add -- $f; Write-Host "  lockfile: kept consolidation version of $f" }
    }
    $left = @(git diff --name-only --diff-filter=U)
    if ($left.Count -eq 0) { Git commit --no-edit; return "union-merged" }
    Write-Host "  still conflicting even under union:" -ForegroundColor Red
    $left | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    git merge --abort
    return "failed"
  } finally { Disable-Union }
}

if (Test-Path $attrFile) { $attrBackup = Get-Content $attrFile -Raw }
$results = @()
try {
  foreach ($b in $Branches) {
    Step "Merging $b"
    $status = Merge-Branch $b
    $color = @{ clean = "Green"; "union-merged" = "Yellow"; failed = "Red" }[$status]
    Write-Host "  $status" -ForegroundColor $color
    $results += [pscustomobject]@{ Branch = $b; Result = $status }
  }
} finally {
  if ($null -ne $attrBackup) { Set-Content $attrFile $attrBackup -NoNewline } else { Remove-Item $attrFile -ErrorAction SilentlyContinue }
}

Step "Per-PR result"
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object Result -eq "failed")
if ($failed.Count -gt 0) {
  Write-Host "FAILED even under union (merge by hand, then re-run with the remaining branches):" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host "  $($_.Branch)" -ForegroundColor Red }
}

if ($Verify -and (Test-Path "droid-assist/droid-assist-prototype/package.json")) {
  Push-Location "droid-assist/droid-assist-prototype"
  try {
    Step "Typecheck (tsc --noEmit)"
    npx tsc --noEmit
    $tscOk = ($LASTEXITCODE -eq 0)
    Step "Tests (vitest run)"
    npx vitest run
    $testOk = ($LASTEXITCODE -eq 0)
  } finally { Pop-Location }
  if (-not ($tscOk -and $testOk)) {
    Write-Host "`nVerification FAILED - expected after a union merge. Remove duplicate declarations/imports/keys, restore dropped wiring, then commit." -ForegroundColor Yellow
  }
}

if ($Push) {
  Step "Pushing $Branch"
  Git push -u origin $Branch
}

Write-Host "`n$Branch built from $($results.Count) branch(es); $($failed.Count) failed." -ForegroundColor Green
if ($failed.Count -gt 0) { exit 1 }
