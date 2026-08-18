# Contributing

This is a personal tool, opened because it may be useful to someone else. Issues and pull
requests are welcome; **no support is promised**, and a change may be declined for reasons of
scope rather than quality. The rules below are what those decisions rest on, so nothing comes
as a surprise after the work is done.

## Scope

**Linear is the reference, not the ceiling.** The project exists to make a terminal interface
whose habits carry over from Linear, deliberately lighter in features. That shape is what keeps
the CLI learnable and cheap enough for an agent to drive — a reading of one issue costs about ten
tokens — and features accumulated for their own sake are what would cost it.

So the bar is high rather than closed. What clears it is a **workflow that is currently
awkward**, described as such: what you were trying to do, where the CLI made you stop, and what
you did instead. What rarely clears it is a capability named in the abstract, because there is no
way to weigh it against the cost it adds to every other command.

Ideas belong in [Discussions](https://github.com/Oward-Studio/atl/discussions/categories/ideas)
rather than in the issue list, so that the issues stay a list of things that are broken. A
discussion becomes an issue when it has convinced someone — which may well be you convincing me.

**The CLI never runs a Git command on your repository.** It does not inspect it, does not check
whether one exists, opens no pull request. Git context is an input the caller supplies:

```sh
atl issue done "$(git branch --show-current)"
```

The single exception is `atl update`, which runs Git and npm on **its own clone** — there is no
caller to supply that context when the thing being updated is the CLI. `test/router.test.ts`
exempts that one file and no other, so an accidental `git checkout` anywhere else fails the suite.

**No Anytype identifier is hardcoded.** Spaces, types, properties, tags and projects resolve by
name or by key at run time, cached for 24 h. A patch containing a `bafyrei…` literal will be
declined: it would work on one space only.

**Never write to the `tag` property.** Anytype attaches it to every new type, and it holds the
space owner's personal vocabulary, shared across all their objects. Dev labels live in
`dev_label`.

**States and priorities are identified by their tag key, never by a display name.** The owner of
a space renames tags freely; the key survives. Comparing names is what once took the whole CLI
down (`docs/ANYTYPE-LIMITS.md` §1.13).

## Everything is written in English

Code, comments, tests, documentation, commit messages, pull requests and CLI output. If you touch a
file and find a stray word in another language, translate it in the same commit — nobody opens a
pull request to fix three comments, so passing through is the only moment it happens.

Anytype content is the exception, and not the repository's to translate: the issue titles,
descriptions and acceptance criteria stored in a space belong to whoever owns it.

## Running the tests

```sh
npm test          # hermetic: no network, no Anytype, no app key
npm run typecheck
npm run test:live # contract tests against the real API — needs Anytype running
```

`npm test` proves the CLI behaves correctly **given a spec-conformant API**; it runs against a
fake Anytype server and says nothing about Anytype having changed. `npm run test:live` is what
checks that, and it is the one to run after an Anytype update. It creates a disposable project
and a throwaway schema, then deletes both.

CI runs the hermetic suite and the typecheck on Node 20.11 and 22. There is no build step: `tsx`
runs `src/` directly.

## Measurements belong in the documentation

`docs/ANYTYPE-LIMITS.md` records the API limits measured one by one, and the features
deliberately given up with the reasoning. It is the most valuable file in the repository, because
rediscovering any of it costs hours.

If you measure something that contradicts it, **say so in an issue** — that is more useful than a
patch. An entry that turns out to be wrong is worth more attention than a bug: the CLI carries
code shaped around each of these limits, and a limit that does not hold is a whole branch of that
code with no reason to exist.

## Commits, and how a version comes out

One issue, one branch, one pull request. Commit messages say **why**, not what the diff already
shows; a message explaining a trade-off or naming a measurement is worth more than a tidy subject
line. No emoji, and the prefix is a Conventional Commit type: `feat`, `fix`, `docs`, `test`,
`refactor`, `chore`, `ci`, `perf`, `build`, `style`, `revert`.

**The pull request title is the one that counts.** `main` is squash-merged, so the title becomes
the commit message on `main` — and that is what release-please reads to work out the next version.
CI rejects a title that is not a Conventional Commit, because a mistyped one would not fail
anything, it would quietly skip a release.

`feat` produces a minor version and `fix` a patch; `feat!` or a `BREAKING CHANGE` footer produces a
major. Every other type ships without a new version, which is the intended outcome for
documentation or a test.

Nobody chooses the number. release-please keeps a pull request holding the bump and the changelog,
and merging it tags the release. Deciding *when* to release is that merge; deciding *what* the
version is belongs to the commits.

**That release pull request accumulates, so leave it open.** Three features merged before it goes
out produce one minor version, not three — what makes the numbers run is not how much ships but how
often that pull request is merged. Treat it as a decision to publish rather than a formality to
clear, and a busy week reads as one version instead of five.

**A major version is never a keystroke.** `feat!:` alone does not pass CI: it wants a
`BREAKING CHANGE: <what breaks>` footer in one of the branch's commit messages, which is also where
release-please reads it from — squashing takes the commit body from the branch, not from the pull
request description. Renaming a flag or a `--json` key is exactly what the footer is for.
