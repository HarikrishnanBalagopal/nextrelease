import * as semver from 'semver';
import * as core from '@actions/core';
import { Octokit } from "@octokit/rest";
import { Endpoints } from '@octokit/types';

export { get_all_tags };

type listTagsRespT = Endpoints["GET /repos/{owner}/{repo}/tags"]["response"];
type tagsT = listTagsRespT['data'][0];

async function get_all_tags(owner: string, repo: string, octokit: Octokit | null = null, max_tags = 40): Promise<tagsT[]> {
    core.debug('get_all_tags');
    const tags: tagsT[] = [];
    if (!octokit) {
        octokit = new Octokit();
    }
    try {
        for (let page = 1; tags.length < max_tags; page++) {
            const resp: listTagsRespT = await octokit.repos.listTags({
                owner: owner,
                repo: repo,
                per_page: 100, // github returns a max of 100 tags at a time.
                page,
            });
            if (resp.data.length === 0) {
                core.debug(`stopping because we got no results for page ${page}`);
                return tags;
            }
            tags.push(...resp.data);
        }
        core.debug(`stopping because we hit the max number of tags. max: ${max_tags} got: ${tags.length}`);
        return tags;
    } catch (err) {
        core.info(`stopping because an error occurred. error: ${err}`);
        return tags;
    }
}

function get_related_info(release, prereleases) {
    const release_obj = semver.parse(release);
    const major_minor_prereleases = prereleases.filter(
        (x) =>
            semver.major(x) === release_obj.major &&
            semver.minor(x) === release_obj.minor
    );
    const latest_prerelease_on_given_release_branch =
        major_minor_prereleases.length > 0 ? major_minor_prereleases[0] : null;
    const next_minor_release = semver.inc(release, "minor");
    const next_major_release = semver.inc(release, "major");
    return {
        next_minor_release,
        next_major_release,
        latest_prerelease_on_given_release_branch,
    };
}

function get_major_minor_patch(v) {
    const x = semver.parse(v);
    return `v${x.major}.${x.minor}.${x.patch}`;
}

async function get_release_info(owner, repo) {
    /*
      assume that there is already at least one release and corresponding prerelease
      so data_to_return.current will not have nulls
      also assumes alpha -> beta -> rc -> release progression
      */
    const ctx = { owner, repo };
    const data_to_return = {
        current: { release: null, prerelease: null },
        next: { prerelease: null },
        next_next: { prerelease: null },
        next_release_is_minor: false,
        next_next_release_is_minor: false,
    };

    const tags = await get_all_tags(ctx);
    if (tags.length === 0) {
        return console.log("no tags found");
    }
    const valid_tags = tags.map((x) => x.name).filter(semver.valid);
    //valid_tags.push('v1.21.0-beta.0', 'v1.22.0-alpha.4') // for testing
    const sorted_tags = valid_tags.sort(semver.rcompare);
    const releases = sorted_tags.filter((x) => semver.prerelease(x) === null);
    const prereleases = sorted_tags.filter((x) => semver.prerelease(x) !== null);
    const latest_release = releases.length > 0 ? releases[0] : null;
    data_to_return.current.release = latest_release;
    if (latest_release === null) {
        console.error("no latest release. aborting");
        return data_to_return;
    }
    const info = get_related_info(latest_release, prereleases);
    data_to_return.current.prerelease = info.latest_prerelease_on_given_release_branch;
    if (info.latest_prerelease_on_given_release_branch === null) {
        console.error("no latest prerelease. aborting");
        return data_to_return;
    }

    const prereleases_after_current_release = prereleases.filter((x) =>
        semver.gt(x, latest_release)
    );
    if (prereleases_after_current_release.length === 0) {
        console.log("no prereleases after current release");
        return data_to_return;
    }

    const next_minor_prereleases = prereleases_after_current_release.filter(
        (x) =>
            semver.major(x) === semver.major(latest_release) &&
            semver.minor(x) === semver.minor(info.next_minor_release)
    );
    const next_major_prereleases = prereleases_after_current_release.filter(
        (x) => semver.major(x) === semver.major(info.next_major_release)
    );

    if (
        next_minor_prereleases.length === 0 &&
        next_major_prereleases.length === 0
    ) {
        console.error("next release is neither minor nor major");
        return data_to_return;
    }

    data_to_return.next_release_is_minor = next_minor_prereleases.length > 0;
    data_to_return.next.prerelease = next_minor_prereleases.length > 0 ? next_minor_prereleases[0] : next_major_prereleases[0];

    const next_next_minor = semver.minor(
        semver.inc(get_major_minor_patch(data_to_return.next.prerelease), "minor")
    );
    const next_next_major = semver.major(
        semver.inc(get_major_minor_patch(data_to_return.next.prerelease), "major")
    );
    const next_next_minor_prereleases = prereleases_after_current_release.filter(
        (x) =>
            semver.major(x) === semver.major(latest_release) &&
            semver.minor(x) === next_next_minor
    );
    const next_next_major_prereleases = prereleases_after_current_release.filter(
        (x) => semver.major(x) === next_next_major
    );

    if (
        next_next_minor_prereleases.length === 0 &&
        next_next_major_prereleases.length === 0
    ) {
        return data_to_return;
    }

    data_to_return.next_next_release_is_minor = next_next_minor_prereleases.length > 0;
    data_to_return.next_next.prerelease = next_next_minor_prereleases.length > 0 ? next_next_minor_prereleases[0] : next_next_major_prereleases[0];

    return data_to_return;
}

function helper(owner, repo) {
    const octokit = new Octokit();
    return async function (tag) {
        if (tag === null) return null;
        try {
            const resp = await octokit.repos.getReleaseByTag({
                owner,
                repo,
                tag,
            });
            return resp.data.html_url;
        } catch (err) {
            console.error(err);
        }
        return null;
    }
}

async function get_release_info_extra(owner, repo) {
    const data = await get_release_info(owner, repo);
    const get_release_url = helper(owner, repo);
    data.current.release_url = await get_release_url(data.current.release);
    data.current.prerelease_url = await get_release_url(data.current.prerelease);
    data.next.prerelease_url = await get_release_url(data.next.prerelease);
    data.next_next.prerelease_url = await get_release_url(data.next_next.prerelease);
    return data;
}

module.exports = { on_document_ready, get_major_minor_patch, get_release_info, get_release_info_extra };
