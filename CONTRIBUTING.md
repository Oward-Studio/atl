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

**The CLI never runs a Git command.** It does not inspect the repository, does not check whether
one exists, opens no pull request. Git context is an input the caller supplies:

```sh
atl issue done "$(git branch --show-current)"
```

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

Code, comments, tests, documentation, commit messages, pull requests and CLI output. This is
enforced by `test/language.test.ts`, which scans strings and comments across the repository and
fails the build on French. It exists because reviewing by eye did not work: the switch to English
was declared finished several times while error messages, `--help` descriptions and number
formatting were still French.

If it flags a line where a foreign word is genuinely **data** rather than prose, add it to
`ALLOWED` with a comment stating why. A growing list means the rule is being worked around.

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
patch. One entry in that file was wrong for weeks: it claimed renaming a property key does not
propagate to objects. It does, and finding out allowed a whole class of workaround code to be
deleted.

## Commits

One issue, one branch, one pull request. Commit messages say **why**, not what the diff already
shows; a message explaining a trade-off or naming a measurement is worth more than a tidy subject
line. No emoji, no prefix beyond the conventional `feat:` / `fix:` / `docs:` / `test:` /
`refactor:` / `chore:`.
