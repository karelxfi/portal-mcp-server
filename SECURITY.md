# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's vulnerability reporting for this repository: open the **Security** tab and choose **Report a vulnerability**. Include the affected version (from `/health` or `_server.version` in any tool result), the steps to reproduce, and the impact you observed.

You will receive an acknowledgement, and a fix or a mitigation will be released through the normal release process. Please give us reasonable time to respond before any public disclosure.

## Supported versions

Only the latest released version on the `main` branch receives fixes. Pin a release tag in production and follow the release notes in `CHANGELOG.md`.

## Scope

In scope: this repository, the published Docker image, the Claude Desktop bundle, and the plugin packages built from it.

Out of scope: the SQD Portal API itself and third-party data sources such as public token lists. Report problems in those services to their maintainers.
