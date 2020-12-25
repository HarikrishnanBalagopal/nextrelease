import * as core from '@actions/core'
import { Octokit } from '@octokit/rest'
import { rcompare } from 'semver'

type Ctx = { octokit: Octokit, owner: string, repo: string, release_type: string }

async function get_last_release(ctx: Ctx): Promise<string> {
  const resp = await ctx.octokit.repos.listBranches({ owner: ctx.owner, repo: ctx.repo })
  const branches = resp.data;
  if (!branches || branches.length === 0) { return "" }
  // branches have the format release-0.1, release-0.2, release-1.2, etc.

  return branches.filter(x => x.name.startsWith('release-')).map(x => x.name.replace(/^release-/, '')).sort(rcompare)[0]
}

async function alpha(ctx: Ctx) {
  core.info('creating an alpha release')
  const release = get_last_release(ctx)
}

async function beta() {
  core.info('Error: WIP')
}

async function release_candidate() {
  core.info('Error: WIP')
}

async function normal_release() {
  core.info('Error: WIP')
}

async function main() {
  const token: string = core.getInput('token', { required: true })
  const owner: string = core.getInput('owner', { required: true })
  const repo: string = core.getInput('repo', { required: true })
  const release_type: string = core.getInput('release_type', { required: true })

  const octokit = new Octokit({ auth: token })
  const ctx = { octokit, owner, repo, release_type }
  switch (release_type) {
    case 'alpha': await alpha(ctx); break;
    case 'beta': await beta(); break;
    case 'rc': await release_candidate(); break;
    case 'normal': await normal_release(); break;
    default: return core.setFailed(`unknown release type ${release_type}`);
  }
}

async function run(): Promise<void> {
  try {
    await main()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
