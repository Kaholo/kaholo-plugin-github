const { CREATE_REPO_NOT_FOUND_ERROR_MESSAGE, CREATE_ORG_WEBHOOK_NOT_FOUND_ERROR_MESSAGE } = require("./consts");
const {
  sendToGithub, listGithubRequest, getRepo, parseAndHandleGithubError,
  createListCommitsSearchParams, validateAuthenticationToken,
} = require("./helpers");
const parsers = require("./parsers");

async function sendStatus(action, settings) {
  const {
    state, linkedUrl, description, context,
  } = action.params;
  const repo = getRepo(action.params);
  const sha = parsers.autocomplete(action.params.sha);
  const token = action.params.token || settings.token;
  if (!token || !sha || !state) {
    throw new Error("One of required parameters was not given");
  }
  const reqUrl = `/repos/${repo}/statuses/${sha}`;
  const body = {
    state,
    target_url: parsers.string(linkedUrl),
    description: parsers.string(description),
    context: parsers.string(context),
  };

  const res = await sendToGithub(reqUrl, "POST", token, body);
  if (res.message && res.message.includes("No commit found for SHA")) {
    throw res;
  }
  return res;
}

async function createRepo(action, settings) {
  const {
    name, private: paramPrivate, autoInit, gitignoreTemplate, description,
  } = action.params;
  const owner = parsers.autocomplete(action.params.owner);
  const token = action.params.token || settings.token;
  if (!token || !name) {
    throw new Error("One of required parameters was not given");
  }
  const reqPath = owner && owner !== "user" ? `/orgs/${owner}/repos` : "/user/repos";
  const body = {
    name: parsers.string(name),
    private: parsers.boolean(paramPrivate),
    auto_init: parsers.boolean(autoInit),
    gitignore_template: parsers.string(gitignoreTemplate),
    description: parsers.string(description),
  };

  return sendToGithub(reqPath, "POST", token, body).catch(
    parseAndHandleGithubError(CREATE_REPO_NOT_FOUND_ERROR_MESSAGE),
  );
}

async function createRepoFromTemplate(action, settings) {
  const {
    templateRepo, name, description, private: paramPrivate,
  } = action.params;
  const owner = parsers.autocomplete(action.params.owner);
  const token = action.params.token || settings.token;
  if (!token || !templateRepo || !name) {
    throw new Error("One of required parameters was not given");
  }
  if (!templateRepo.includes("/")) {
    throw new Error("Bad template repository name format.\nRepository Name should be in the format of {owner}/{repo}");
  }
  const reqPath = `/repos/${templateRepo}/generate`;
  const body = {
    name: parsers.string(name),
    private: parsers.boolean(paramPrivate),
    owner: owner === "user" ? undefined : owner,
    description: parsers.string(description),
  };

  return sendToGithub(reqPath, "POST", token, body);
}

async function createRepoWebhook(action, settings) {
  const {
    url, secret, insecureSsl, notActive,
  } = action.params;
  const repo = getRepo(action.params);
  const contentType = action.params.contentType || "json";
  const events = parsers.array(action.params.events);
  const token = action.params.token || settings.token;
  if (!token || !url) {
    throw new Error("One of required parameters was not given");
  }
  const reqPath = `/repos/${repo}/hooks`;
  const body = {
    name: "web",
    config: {
      url: parsers.string(url),
      content_type: parsers.string(contentType),
      insecure_ssl: parsers.boolean(insecureSsl) ? 1 : 0,
      secret,
    },
    events: events.length > 0 ? events : undefined,
    active: !parsers.boolean(notActive),
  };

  return sendToGithub(reqPath, "POST", token, body);
}

async function updateOrganizationWebhook({
  org, token, hookId, body,
}) {
  return sendToGithub(`/orgs/${org}/hooks/${hookId}`, "PATCH", token, body);
}

async function createOrganizationWebhook(action, settings) {
  const {
    url, secret, insecureSsl, notActive, username, password,
  } = action.params;
  const org = parsers.autocomplete(action.params.org);
  const contentType = action.params.contentType || "json";
  const events = parsers.array(action.params.events);
  const token = action.params.token || settings.token;
  if (!token || !org || !url) {
    throw new Error("One of required parameters was not given");
  }
  const reqPath = `/orgs/${org}/hooks`;
  const body = {
    name: "web",
    config: {
      url: parsers.string(url),
      content_type: parsers.string(contentType),
      insecure_ssl: parsers.boolean(insecureSsl) ? 1 : 0,
      secret: parsers.string(secret),
      username: parsers.string(username),
      password: parsers.string(password),
    },
    events: events.length > 0 ? events : undefined,
    active: !parsers.boolean(notActive),
  };

  const webhookResult = await sendToGithub(reqPath, "POST", token, body).catch(
    parseAndHandleGithubError(CREATE_ORG_WEBHOOK_NOT_FOUND_ERROR_MESSAGE),
  );
  if (!body.active) {
    await updateOrganizationWebhook({
      org,
      token,
      hookId: webhookResult.id,
      body: {
        active: false,
      },
    });
    webhookResult.active = false;
  }
  return webhookResult;
}

async function setBranchProtectionRule(action, settings) {
  const { params } = action;
  const repo = getRepo(params);
  const branch = parsers.autocomplete(params.branch);
  const reqPath = `/repos/${repo}/branches/${branch}/protection`;
  const body = {
    required_status_checks: {
      strict: true,
      contexts: Array.isArray(params.contexts) ? params.contexts : params.contexts.split("\n"),
    },
    enforce_admins: parsers.boolean(params.enforceAdmins),
    required_pull_request_reviews: {
      dismissal_restrictions: { users: [], teams: [] },
      dismiss_stale_reviews: parsers.boolean(params.dismissStaleReviews),
      require_code_owner_reviews: parsers.boolean(params.requireOwnerReview),
      required_approving_review_count: parsers.number(params.approvingCount),
      bypass_pull_request_allowances: { users: [], teams: [] },
    },
    restrictions: null,
  };

  const token = action.params.token || settings.token;
  return sendToGithub(reqPath, "PUT", token, body);
}

async function getAuthenticatedUser(params, settings) {
  return sendToGithub("/user", "GET", params.token || settings.token);
}

async function getRepository(params, settings) {
  return sendToGithub(`/repos/${getRepo(params)}`, "GET", params.token || settings.token);
}

async function getPullRequest(params, settings) {
  const pr = parsers.pullRequest(params.pr);
  if (!pr || pr.paramType !== "pulls") {
    throw new Error("Must provide the pull request either from autocomplete or it's ID from code.");
  }
  if (pr.url) { return sendToGithub(pr.url.pathname, "GET", params.token || settings.token); }
  return sendToGithub(`/repos/${getRepo(params)}/pulls/${pr.id}`, "GET", params.token || settings.token);
}

async function postPRComment(params, settings) {
  const pr = parsers.pullRequest(params.pr);
  const comment = parsers.string(params.comment);
  if (!pr || !comment) {
    throw new Error("One of required parameters was not given");
  }
  let path;
  if (pr.paramType === "issues") {
    path = pr.url.pathname;
    if (!path.endsWith("/comments")) {
      path += "/comments";
    }
  } else {
    const pullRequest = await getPullRequest(params, settings);
    path = new URL(pullRequest.comments_url).pathname;
  }
  return sendToGithub(path, "POST", params.token || settings.token, { body: comment });
}

async function searchRepos(params, settings) {
  const query = await createGithubSearchQuery(params, settings);
  const bigQuery = parsers.boolean(params.bigQuery);
  if (bigQuery) {
    validateAuthenticationToken(params, settings);
  }
  const repos = await listGithubRequest(params, settings, "/search/repositories", {
    q: query,
  }, bigQuery);
  return repos;
}

async function listOrgs(params, settings) {
  const bigQuery = parsers.boolean(params.bigQuery);
  if (bigQuery) {
    validateAuthenticationToken(params, settings);
  }
  return listGithubRequest(params, settings, "/user/orgs", {}, bigQuery);
}

async function listBranches(params, settings) {
  const repo = getRepo(params);
  const bigQuery = parsers.boolean(params.bigQuery);
  if (bigQuery) {
    validateAuthenticationToken(params, settings);
  }
  return listGithubRequest(params, settings, `/repos/${repo}/branches`, {}, bigQuery);
}

async function listCommits(params, settings) {
  const repo = getRepo(params);
  const searchParams = createListCommitsSearchParams(params);
  const bigQuery = parsers.boolean(params.bigQuery);
  if (bigQuery) {
    validateAuthenticationToken(params, settings);
  }
  return listGithubRequest(params, settings, `/repos/${repo}/commits`, searchParams, bigQuery);
}

async function listPullRequests(params, settings) {
  const repo = getRepo(params);
  return listGithubRequest(params, settings, `/repos/${repo}/pulls`);
}

async function createGithubSearchQuery(params, settings) {
  const querySegments = [];
  if (params.query) {
    querySegments.push(encodeURIComponent(params.query));
  }
  let owner = parsers.autocomplete(params.owner);
  if (owner === "user") {
    const { login: userLogin } = await getAuthenticatedUser(params, settings);
    owner = userLogin;
  }
  if (owner) {
    querySegments.push(`org:${owner}`);
  }
  const repoType = parsers.string(params.repoType);
  if (repoType) {
    switch (repoType) {
      case "all":
        querySegments.push("fork:true");
        break;
      case "forks":
        querySegments.push("fork:only");
        break;
      case "private":
        querySegments.push("is:private");
        break;
      case "public":
        querySegments.push("is:public");
        break;
      case "archived":
        querySegments.push("archived:true");
        break;
      case "mirror":
        querySegments.push("mirror:true");
        break;
      default:
        break;
    }
  }
  return querySegments.join("+");
}

module.exports = {
  sendStatus,
  createRepo,
  createRepoFromTemplate,
  createRepoWebhook,
  createOrganizationWebhook,
  postPRComment,
  setBranchProtectionRule,
  // list/get funcs
  getAuthenticatedUser,
  getRepository,
  getPullRequest,
  listOrgs,
  listBranches,
  listCommits,
  listPullRequests,
  searchRepos,
};
