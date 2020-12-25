import * as semver from 'semver';
import * as core from '@actions/core';
import { Octokit } from "@octokit/rest";
import { Endpoints } from '@octokit/types';

export { get_all_tags, get_major_minor_patch };

type listTagsRespT = Endpoints["GET /repos/{owner}/{repo}/tags"]["response"];
type tagsT = listTagsRespT['data'][0];
type releaseInfoT = {
    current: { release: string | null, prerelease: string | null },
    next: { prerelease: string | null },
    next_next: { prerelease: string | null },
    next_release_is_minor: boolean,
    next_next_release_is_minor: boolean,
};

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

function get_major_minor_patch(v: string): string {
    core.debug('get_major_minor_patch');
    const x = semver.parse(v);
    if (x === null) return '';
    return `${x.major}.${x.minor}.${x.patch}`;
}

async function get_release_info(owner: string, repo: string): Promise<releaseInfoT> {
    core.debug('get_release_info');
    /*
        assume that there is already at least one release and corresponding prerelease so release_info.current will not have nulls
        assume alpha -> beta -> rc -> release progression
    */
    const release_info: releaseInfoT = {
        current: { release: null, prerelease: null },
        next: { prerelease: null },
        next_next: { prerelease: null },
        next_release_is_minor: false,
        next_next_release_is_minor: false,
    };

    const tags = await get_all_tags(owner, repo);
    const valid_tags = tags.map(x => x.name).filter(x => semver.valid(x));
    if (valid_tags.length === 0) {
        core.info("stopping because we did not find any valid semantic version tags");
        return release_info;
    }

    //valid_tags.push('v1.21.0-beta.0', 'v1.22.0-alpha.4') // for testing
    const sorted_tags = valid_tags.sort(semver.rcompare);

    const releases = sorted_tags.filter((x) => semver.prerelease(x) === null);
    const prereleases = sorted_tags.filter((x) => semver.prerelease(x) !== null);
    const latest_release = releases.length > 0 ? releases[0] : null;
    release_info.current.release = latest_release;
    if (latest_release === null) {
        console.error("no latest release. aborting");
        return release_info;
    }
    // start get_related_info
    const release_obj = semver.parse(latest_release);
    const major_minor_prereleases = prereleases.filter((x) => semver.major(x) === release_obj!.major && semver.minor(x) === release_obj!.minor);
    const latest_prerelease_on_given_release_branch = major_minor_prereleases.length > 0 ? major_minor_prereleases[0] : null;
    const next_minor_release = semver.inc(latest_release, "minor");
    const next_major_release = semver.inc(latest_release, "major");
    // end get_related_info

    release_info.current.prerelease = latest_prerelease_on_given_release_branch;
    if (latest_prerelease_on_given_release_branch === null) {
        console.error("no latest prerelease. aborting");
        return release_info;
    }

    const prereleases_after_current_release = prereleases.filter((x) =>
        semver.gt(x, latest_release)
    );
    if (prereleases_after_current_release.length === 0) {
        console.log("no prereleases after current release");
        return release_info;
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
        return release_info;
    }

    release_info.next_release_is_minor = next_minor_prereleases.length > 0;
    release_info.next.prerelease = next_minor_prereleases.length > 0 ? next_minor_prereleases[0] : next_major_prereleases[0];

    const next_next_minor = semver.minor(
        semver.inc(get_major_minor_patch(release_info.next.prerelease), "minor")
    );
    const next_next_major = semver.major(
        semver.inc(get_major_minor_patch(release_info.next.prerelease), "major")
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
        return release_info;
    }

    release_info.next_next_release_is_minor = next_next_minor_prereleases.length > 0;
    release_info.next_next.prerelease = next_next_minor_prereleases.length > 0 ? next_next_minor_prereleases[0] : next_next_major_prereleases[0];

    return release_info;
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
