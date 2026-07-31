export interface ExplicitPrReviewTarget {
  kind: "explicit";
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface BarePrReviewTarget {
  kind: "bare";
  pullNumber: number;
}

export type ParsedPrReviewTarget = ExplicitPrReviewTarget | BarePrReviewTarget;

export interface RepositoryIdentity {
  owner: string;
  repo: string;
  nodeId?: string;
}

export interface ResolvedPrReviewTarget {
  owner: string;
  repo: string;
  pullNumber: number;
}

const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const OWNER_SEGMENT = /^[A-Za-z0-9-]+$/;

function pullNumber(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("pull request number must be a positive integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("pull request number is out of range");
  return parsed;
}

function repository(owner: string, repo: string): RepositoryIdentity {
  const normalizedRepo = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
  if (
    normalizedRepo === "."
    || normalizedRepo === ".."
    || !OWNER_SEGMENT.test(owner)
    || !REPOSITORY_SEGMENT.test(normalizedRepo)
  ) {
    throw new Error("repository identity is invalid");
  }
  return { owner, repo: normalizedRepo };
}

export function parsePrReviewTarget(value: string): ParsedPrReviewTarget {
  const bare = /^([1-9]\d*)$/.exec(value);
  if (bare) return { kind: "bare", pullNumber: pullNumber(bare[1]!) };

  const shorthand = /^([^/\s]+)\/([^/#\s]+)#([1-9]\d*)$/.exec(value);
  if (shorthand) {
    const identity = repository(shorthand[1]!, shorthand[2]!);
    return { kind: "explicit", ...identity, pullNumber: pullNumber(shorthand[3]!) };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("target must be a GitHub PR URL, owner/repo#number, or bare number");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.search || url.hash) {
    throw new Error("target must be an exact https://github.com pull request URL");
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/.exec(url.pathname);
  if (!match) throw new Error("target must be an exact GitHub pull request URL");
  const identity = repository(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!));
  return { kind: "explicit", ...identity, pullNumber: pullNumber(match[3]!) };
}

export function parseRemoteRepository(value: string): RepositoryIdentity {
  const trimmed = value.trim();
  const scp = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(trimmed);
  if (scp) return repository(scp[1]!, scp[2]!);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("origin remote is not a supported GitHub repository URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "ssh:")
    || url.hostname.toLowerCase() !== "github.com"
    || url.port
    || url.search
    || url.hash
    || (url.username && url.protocol === "https:")
    || url.password
  ) {
    throw new Error("origin remote is not a supported GitHub repository URL");
  }
  const match = /^\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new Error("origin remote is not a supported GitHub repository URL");
  return repository(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!));
}

export function resolvePrReviewTarget(
  target: ParsedPrReviewTarget,
  remote: RepositoryIdentity | undefined,
  authenticatedRepository: RepositoryIdentity | undefined,
): ResolvedPrReviewTarget {
  if (target.kind === "explicit") {
    return { owner: target.owner, repo: target.repo, pullNumber: target.pullNumber };
  }
  if (!remote || !authenticatedRepository || !authenticatedRepository.nodeId) {
    throw new Error("bare pull request target requires authenticated repository and origin identities");
  }
  if (
    remote.owner.toLowerCase() !== authenticatedRepository.owner.toLowerCase()
    || remote.repo.toLowerCase() !== authenticatedRepository.repo.toLowerCase()
  ) {
    throw new Error("authenticated repository does not match origin remote");
  }
  return { owner: remote.owner, repo: remote.repo, pullNumber: target.pullNumber };
}
