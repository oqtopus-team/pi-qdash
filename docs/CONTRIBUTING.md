# How to Contribute

Thank you for your interest in our project. This project is built by the community. Please refer to the following guidelines on how to contribute to the project.

## Code of Conduct

This project adopts the OQTOPUS [Code of Conduct](https://github.com/oqtopus-team/.github/blob/main/CODE_OF_CONDUCT.md). Please adhere to this Code of Conduct when participating, contributing, and communicating in the project.

## Reporting Bugs

If you find a bug, please create an issue following the [Bug Report Template](../.github/ISSUE_TEMPLATE/BUG_REPORT.yaml).

## Questions

If you have any questions, please create an issue following the [Question Template](../.github/ISSUE_TEMPLATE/QUESTION.yaml).

## Feature Requests

If you have a new feature request, please create an issue following the [Feature Request Template](../.github/ISSUE_TEMPLATE/FEATURE_REQUEST.yaml).

## Development

Install dependencies and run the type check before submitting a pull request:

```bash
npm install
npm run check
```

To try your changes locally with pi, run the following from the repository root:

```bash
pi -e .
```

## Development Flow

- `main` is the release branch. Create a feature branch from `main` and open a pull request.
- Pull requests are squash-merged. The PR title becomes the commit message on `main` and the changelog entry, so it must follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add qdash_dashboard tool`).
- CI runs the type check on every pull request.

## Release Flow

Releases are automated with [tagpr](https://github.com/Songmu/tagpr):

1. When pull requests are merged into `main`, tagpr opens (or updates) a release pull request that bumps the version in `package.json` and updates `CHANGELOG.md`.
2. The version bump is patch by default. Add the `tagpr:minor` or `tagpr:major` label to the release pull request to change it.
3. Merging the release pull request creates a `v*` tag, and the publish workflow releases the package to npm with provenance.

Do not bump the version in `package.json` or edit `CHANGELOG.md` manually; tagpr manages both.

Thank you for your contributions!
