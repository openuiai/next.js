# Comprehensive CI Fix Plan for OpenNext.js

## Goal

Fix ALL CI issues in a single PR to get a fully working CI pipeline for the OpenNext.js fork.

## Phase 1: Discovery (YOU validate each)

### Step 1.1: Identify ALL Failing Jobs

**Your Action Required:**

1. Go to your GitHub Actions tab
2. List all jobs that are:
   - ❌ Failing
   - ⏳ Timing out
   - 🔄 Hanging indefinitely
3. Note the error messages for each

**Validation Checkpoint:**

- [ ] You provide me the complete list of failing jobs
- [ ] You provide error messages/symptoms for each

### Step 1.2: Categorize Issues

Based on your list, I'll categorize them into:

- Permission issues (like docs validation)
- Timeout/hanging issues (like build jobs)
- Vercel dependency issues (Turbo cache, environment vars)
- Actual code/test failures

**Validation Checkpoint:**

- [ ] You confirm the categorization is accurate

## Phase 2: Fix Implementation

### Step 2.1: Environment & Infrastructure Fixes

**Changes to make:**

1. **Disable Turbo Remote Cache**

   - Remove `TURBO_TEAM` and `TURBO_CACHE` from workflows
   - Or set `TURBO_CACHE: local` to use local cache only

2. **Remove Vercel-specific variables**

   - Remove `VERCEL_TEST_TOKEN`
   - Remove `VERCEL_TEST_TEAM`
   - Remove other Vercel-specific configs

3. **Fix DataDog/monitoring dependencies**
   - Remove or make optional `DATADOG_API_KEY`
   - Remove or make optional `TEST_TIMINGS_TOKEN`

**Validation Checkpoint:**

- [ ] You review the environment variable changes
- [ ] You confirm which services you want to keep/remove

### Step 2.2: Timeout Fixes for ALL Jobs

**Changes to make:**

1. Add reasonable timeouts to every job:

   - Build jobs: 60 minutes
   - Test jobs: 45 minutes
   - Simple jobs: 30 minutes

2. Find ALL workflow files and add timeouts systematically

**Validation Checkpoint:**

- [ ] You review the timeout values
- [ ] You confirm they're reasonable for your infrastructure

### Step 2.3: Permission Fixes

**Changes to make:**

1. Add proper permissions to all jobs that interact with GitHub API:

   ```yaml
   permissions:
     contents: read
     checks: write
     pull-requests: write
   ```

2. Identify which jobs need these permissions

**Validation Checkpoint:**

- [ ] You confirm which jobs need GitHub API access
- [ ] You approve the permission levels

### Step 2.4: Test Framework Fixes

**For any actual test failures:**

1. Identify if tests are Vercel-specific
2. Either:
   - Comment them out with clear documentation
   - Modify them for OpenNext.js
   - Add skip conditions

**Validation Checkpoint:**

- [ ] You decide: skip, modify, or fix each failing test
- [ ] You approve the approach for each

## Phase 3: Testing Strategy

### Step 3.1: Local Validation

**What YOU need to validate:**

- [ ] Build commands work locally
- [ ] No references to Vercel infrastructure remain
- [ ] Environment variables make sense for self-hosted

### Step 3.2: Branch Testing

**Your validation process:**

1. I create all fixes in a single branch
2. You push the branch
3. You create ONE PR with all fixes
4. We monitor CI results together
5. You validate each job passes or fails cleanly (no hangs)

## Phase 4: Documentation

### Step 4.1: Document All Changes

Create a comprehensive changelog:

- Every environment variable changed/removed
- Every timeout added
- Every permission fixed
- Every test modified/skipped
- Rationale for each change

**Validation Checkpoint:**

- [ ] You review and approve the documentation
- [ ] You confirm it's clear for future maintainers

## Your Input Needed Now

To start Phase 1, please provide:

1. **Complete list of failing/hanging jobs** from your GitHub Actions
2. **Specific error messages** you're seeing
3. **Your preferences:**
   - Keep or remove DataDog integration?
   - Keep or remove Turbo cache entirely?
   - Keep or skip Vercel-specific tests?

## Success Criteria

✅ All CI jobs either:

- Pass successfully, OR
- Fail quickly with clear errors (no hanging)
- Are explicitly skipped with documentation

✅ No jobs hang for more than their timeout
✅ No "Resource not accessible" errors
✅ CI provides useful feedback for PRs
✅ Everything is documented

---

**Ready to start?** Please provide the failing jobs list and we'll systematically fix everything in one go!
