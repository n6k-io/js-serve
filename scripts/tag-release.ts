// Creates annotated tag v<version> (version from package.json at the target commit). Does not push.
// Target: USE_REF (must be on origin/main), else HEAD, which must be a clean `main` equal to origin/main.
// Fails unless ci.yml's push run on the target succeeded and the version is not on npm.
// Exits 0 without tagging if the tag already points at the target; fails if it points elsewhere.
// DRY_RUN=1 runs every check (fetch, gh, npm) but does not create the tag.
import { $ } from "bun";

class TagError extends Error {}

const fail = (message: string): never => {
  throw new TagError(message);
};

const text = async (command: ReturnType<typeof $>): Promise<string> => {
  const result = await command.nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
};

const exitCode = async (command: ReturnType<typeof $>): Promise<number> => {
  const result = await command.nothrow().quiet();
  return result.exitCode;
};

const resolveSha = async (): Promise<string> => {
  const reference = process.env.USE_REF;
  if (reference) {
    const sha =
      (await text($`git rev-parse --verify ${reference + "^{commit}"}`)) ||
      fail(`USE_REF '${reference}' is not a commit`);
    if (
      (await exitCode($`git merge-base --is-ancestor ${sha} origin/main`)) !== 0
    ) {
      fail(`${sha} is not on origin/main`);
    }
    return sha;
  }
  if ((await text($`git rev-parse --abbrev-ref HEAD`)) !== "main") {
    fail("not on main");
  }
  if (await text($`git status --porcelain`)) {
    fail("working tree is not clean");
  }
  const sha = await text($`git rev-parse HEAD`);
  if (sha !== (await text($`git rev-parse origin/main`))) {
    fail(`HEAD (${sha}) is not origin/main`);
  }
  return sha;
};

const checkCi = async (sha: string): Promise<void> => {
  const run = await text(
    $`gh api ${`repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main`} --jq ${String.raw`.workflow_runs[0] | "\(.status) \(.conclusion) \(.html_url)"`}`,
  );
  if (!run) {
    fail(`no ci.yml push run for ${sha}`);
  }
  const [status, conclusion, url] = run.split(" ");
  if (status !== "completed" || conclusion !== "success") {
    fail(`ci.yml for ${sha} is ${status}/${conclusion}: ${url}`);
  }
};

const readVersion = async (
  sha: string,
): Promise<{ name: string; version: string }> => {
  const packageJson: unknown = JSON.parse(
    await text($`git show ${sha + ":package.json"}`),
  );
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("name" in packageJson) ||
    !("version" in packageJson) ||
    typeof packageJson.name !== "string" ||
    typeof packageJson.version !== "string"
  ) {
    return fail("package.json has no string name/version");
  }
  if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
    fail(`package.json version '${packageJson.version}' is not x.y.z`);
  }
  return { name: packageJson.name, version: packageJson.version };
};

const checkTag = async (tag: string, sha: string): Promise<boolean> => {
  const localSha = await text(
    $`git rev-parse -q --verify ${`refs/tags/${tag}^{commit}`}`,
  );
  const remoteLines = await text(
    $`git ls-remote origin ${`refs/tags/${tag}^{}`} ${`refs/tags/${tag}`}`,
  );
  const remoteSha = remoteLines.split("\n").at(-1)?.split("\t", 1)[0] ?? "";
  if (localSha && remoteSha && localSha !== remoteSha) {
    fail(`${tag} differs locally (${localSha}) and on origin (${remoteSha})`);
  }
  const existing = remoteSha || localSha;
  if (!existing) {
    return true;
  }
  if (existing !== sha) {
    fail(`${tag} already exists on ${existing}`);
  }
  console.log(`${tag} already on ${sha}`);
  return false;
};

const main = async (): Promise<void> => {
  $.cwd(await text($`git rev-parse --show-toplevel`));

  if ((await exitCode($`gh auth status`)) !== 0) {
    fail("gh is not authenticated (run: gh auth login)");
  }
  await $`git fetch --quiet origin main --tags`;

  const sha = await resolveSha();
  await checkCi(sha);
  const { name, version } = await readVersion(sha);

  const registry = await fetch(
    `https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`,
  );
  if (registry.status !== 404) {
    fail(
      registry.ok
        ? `${name}@${version} is already published to npm`
        : `npm registry returned ${registry.status} for ${name}@${version}`,
    );
  }

  const tag = `v${version}`;
  if (!(await checkTag(tag, sha))) {
    return;
  }

  console.log(`will tag ${sha}: ${tag}`);
  if (process.env.DRY_RUN === "1") {
    return;
  }
  await $`git tag -a ${tag} -m ${tag} ${sha}`;
  console.log(`created: ${tag}`);
  console.log(`push with: git push origin ${tag}`);
};

try {
  await main();
} catch (error) {
  if (!(error instanceof TagError)) {
    throw error;
  }
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
