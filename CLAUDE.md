# Working on this repository

## English, everywhere

Code, comments, identifiers, test names, fixtures, documentation, commit messages, pull request
titles and bodies, and every string the CLI prints.

If you touch a file and find a word in another language, translate it in the same commit. Nobody
opens a pull request to fix three comments, so the moment you are already in the file is the only
moment it happens.

The exception is Anytype content: issue titles, descriptions and acceptance criteria live in the
owner's space and are theirs to write in whatever language they like. Keys are not content —
`state`, `priority`, `progress`, `dev_issue`, `dev_project` — and the CLI reads nothing else.

## Before changing behaviour

`CONTRIBUTING.md` carries the scope rule and the decisions a change cannot argue with: no Anytype
identifier is hardcoded, the `tag` property is never written to, and states are identified by tag key
rather than by display name. The CLI runs no Git command either — with one exception, `atl update`,
which updates its own clone and is the only file the structural guard in `test/router.test.ts`
exempts.

`docs/ANYTYPE-LIMITS.md` records what the Anytype API can and cannot do, measured one case at a
time, and the features deliberately given up. Read it before concluding that something is
impossible, and correct it when a measurement says otherwise.

## Verifying

```sh
npm test          # hermetic, no network and no Anytype
npm run typecheck
npm run test:live # contract tests against the real API, after an Anytype update
```

`npm test` proves the CLI behaves correctly given a spec-conformant API; it says nothing about
Anytype having changed. `npm run test:live` is what checks that.

`main` is protected: every change goes through a pull request, and `ci` must be green. Do not
rename the `ci` job in `.github/workflows/ci.yml` — branch protection stores that identifier, and
changing it leaves every pull request waiting for a check that is never reported.
