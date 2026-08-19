---
name: atl
metadata:
  last_updated: 2026-08-11
description: |
  Drive the dev issues and projects stored in Anytype through the `atl` CLI ("Anytype as Linear")
  instead of raw Anytype MCP calls. Use it whenever a request concerns a dev issue, a dev project, a
  state (backlog, todo, in progress, in review, done, canceled), a priority, a dev label, an
  acceptance criterion, a dependency between issues, project progress, or the branch attached to an
  issue. Triggers: ticket, issue, backlog, sprint, progress, acceptance criterion, AC, dev project,
  atl.
---

# atl — Anytype as Linear

`atl` drives the `dev_issue` issues and `dev_project` projects of an Anytype space from the terminal.
**Prefer `atl` over the Anytype MCP tools** for everything it covers: one MCP `update-object`
response is **1,964 tokens** — measured, the whole object plus the type's full schema — where
`atl issue done <ref>` returns 11.

The CLI prints English throughout. State and priority names come from the space's tags, so they read
as whatever the space owner named them — the CLI keys off tag keys, never display names.

## Requirements

The Anytype desktop application must be running (local API on `127.0.0.1:31009`) and `atl auth` must
have been run once. Otherwise the CLI exits with code 4 or 5 and an explicit message: say so, do not
push through it.

## Saving tokens

**Table output by default, `--json` only to parse.** Measured on a real space:

| Command | tokens rendered |
|---|---|
| `atl ls` (folder scope) | 189 |
| `atl ls --json` | 601 |
| `atl ls --all-projects` | 598 |
| `atl ls --all-projects --json` | 2,081 |
| `atl issue view <ref>` | 180 to 673 depending on the body |
| `atl issue done <ref>` | 11 |

The table is readable as it stands. Asking for `--json` triples the cost and adds nothing when the
result is merely read.

**If `--json` is needed, trim the fields.** `--fields ref,state,title` cuts between half and five
sixths. Measured on 221 issues: `--json` alone 20,838 tokens, the table's five columns 10,869,
`--fields ref,state` 3,503. The `id` field alone weighs 31 % — useless, since the CLI resolves
everything by `ref`.

**Always restrict.** `--state`, `--priority`, `--label` and `--project` all filter `atl ls`, and
combine as AND — there is no need to list everything and sift afterwards, nor to fall back on
`project view` to see one state. They cut the output by a factor of 3. Without a filter, `atl ls`
lists the entire space, unrelated projects included.

**Folder scope does that for you.** If the current folder is linked to a project, `atl ls` and
`atl issue new` restrict to it automatically and announce it on stderr
(`project: AnyTypeLinear (/Users/…/atl)`). Do not add `--project` on top: it is already done.
`--all-projects` ignores the scope when the whole space really is needed.

**The default order is what deserves attention**: In Review, In Progress, Todo, Backlog, and by
priority inside each group. The top of the list is therefore what to talk about first; `--sort
updated` restores chronological order.

**`atl ls` already says what is blocked** (`⊘` = blocked by an unfinished issue), and `issue view`
gives the blocker's state. Do not run a `view` per row to find out what is startable.

**Do not re-read to check.** Write commands return the resulting state: `atl issue done x` prints the
transition, `atl project stats x` prints the computation. An `atl issue view` afterwards is waste.

## Commands

### Issues

```sh
atl ls                                  # active issues (neither done nor canceled)
atl ls --state review                   # -s, one of backlog todo started review done canceled
atl ls --priority high                  # -p, one of urgent high medium low none
atl ls --label Bug                      # -l, any name the dev_label property carries
atl ls --state todo --priority high     # filters combine as AND
atl ls --all --sort priority            # includes done and canceled
atl issue view <ref>                    # detail, acceptance criteria, relations
atl issue new "title" -p high -l Bug --project X --ac "criterion" --ac "another"
atl issue edit <ref> --title "…" --priority low --label Feature --link <url>
atl issue delete <ref> [<ref>…] --yes  # to Anytype's bin; --yes required off a terminal
```

`issue delete` sends issues to Anytype's bin. Nothing brings them back through the API, so from
here it is final — only the application can restore them. It resolves every reference before
removing anything, so an unknown one exits 3 having deleted nothing, and it recomputes project
progress afterwards. **Never pass `--yes` on the user's behalf**: propose the command and let them
run it, unless they asked for the deletion in those terms.

State transitions, one command per target. Each aligns the issue icon with the state colour,
**recomputes project progress** and prints the variation, and rewrites nothing if the issue is
already there. `atl issue new` recomputes too — one more issue changes the denominator. So no need to
follow up with `project stats`: it only serves to catch drift caused by edits made in the app.

| Command | Target state | Alias |
|---|---|---|
| `atl issue start <ref>` | In Progress | `atl start` |
| `atl issue todo <ref>` | Todo | |
| `atl issue review <ref>` | In Review | `atl review` |
| `atl issue done <ref>` | Done | `atl done` |
| `atl issue cancel <ref>` | Canceled | |
| `atl issue backlog <ref>` | Backlog | |

Other top-level aliases: `atl ls`, `atl new`, `atl view`.

Blocking relations — Anytype does **not** maintain the reciprocal, the CLI writes both sides: go
through it rather than MCP, or the relation stays half-posted.

```sh
atl issue block <ref> --by <ref2>       # ref is blocked by ref2
atl issue block <ref> --blocks <ref2>   # ref blocks ref2
atl issue unblock <ref> --by <ref2>     # removes it, on both sides
```

Idempotent; a direct cycle is refused; `issue start` warns without refusing to start. A relation
posted by hand in the app fills only one side: `issue view` marks it `(inferred: …)` and `atl ls` offers
the command that repairs it.

A blocker that is done or cancelled no longer blocks: like Linear, the relation is not deleted but
demoted under `Related` in `issue view`. Do not offer to remove it — it is history.

Acceptance criteria:

```sh
atl issue ac <ref>                      # numbered list with progress
atl issue ac check <ref> 1 3            # several numbers at once
atl issue ac add <ref> "new criterion"
```

### Projects

```sh
atl project list
atl project view <project>
atl project new "name" --repo <url>
atl project stats <project> [--dry-run] # recomputes and writes progress
atl project delete <project> [--with-issues] --yes
```

Deleting a project asks what becomes of its issues, because Anytype does not: archiving a project
there leaves every issue behind with **no project**, invisible outside `--all-projects`. Off a
terminal the menu is replaced by an error naming both commands, since `--yes` alone does not say
which outcome it picks. Issues go first and the project last, so a failure midway leaves a project
holding fewer issues rather than issues holding no project. Same rule as `issue delete`: **propose
the command, never run it with `--yes` unprompted**.

### Bootstrapping

```sh
atl init --dry-run                      # what is missing in an empty space
atl init                                # creates both dev types and their properties
```

For a fresh space without the `dev_issue` / `dev_project` types. Without bootstrapping, `issue new`,
`project new` and `ls` **exit with 4** and name `atl init` — otherwise the API would return an opaque
`HTTP 500`, or zero results as though the space were empty. Idempotent, and it **does not migrate**:
an existing type is left alone. Two steps stay manual, and it lists them — creating each type's
template, and removing the `tag` property Anytype attaches by default.

### Maintenance

```sh
atl project link <project>              # links the current folder
atl project link                        # lists the links
atl project unlink                      # removes the current folder's link
atl issue icons --dry-run               # misaligned icons, within the folder's project
atl issue icons                         # realigns them, idempotent
atl space                               # lists spaces, marks the default one
atl space "<name>"                      # changes the default space, without re-pairing
atl auth --status                       # config and connection, writes nothing
atl cache clear                         # clears the name-resolution cache
atl gain                                # tokens absorbed by atl instead of the context
atl update                              # pulls and reinstalls this installation
```

`atl update` is the one command that runs Git and npm, on its own clone. It fast-forwards or
refuses, never merges, and runs `npm ci` only when the lockfile moved or a previous install left no
trace. It also refuses when the clone sits on a working branch rather than the default one, since
pulling there would update a branch nobody is installing from. The global binary reads the clone live, so a pull is enough — nothing has to be re-linked.
**Propose it rather than running it**: it writes to the owner's working tree.

`atl gain` keeps the measured apart from the estimated: absorbed and rendered are counted per
invocation, the MCP equivalent is calibrated (one object ≈ 1,964 tokens, measured) and capped both by
the absorbed volume and by 50,000 tokens — beyond that the MCP call would not have been expensive but
impossible. `ATL_NO_USAGE=1` disables recording, which stays local — no network call.

On a terminal, and at most once a day, `atl` asks GitHub for the latest release tag and says when an
update exists — after any command, and on `atl --version`. It runs only when stderr is a terminal, so an agent makes no request and sees no notice;
`ATL_NO_UPDATE_CHECK=1` switches it off, `ATL_UPDATE_CHECK=1` forces it on.

`atl ls` **reports** icons misaligned from their state, for free since the information is already in
the fetched objects. It fixes nothing: `atl issue icons` is what writes. The drift comes from edits
made by hand in the app, transition commands setting the icon themselves.

`issue icons` writes **in bulk**: it refuses to act without a target project, from folder scope or
`--project`. The "icon = state colour" convention holds for one project, not for a whole space —
other projects may carry personal icons. `--all-projects` would overwrite them.

Clearing the cache is only useful when a tag or a project has just been renamed and the CLI does not
see it yet.

Scope applies to `issue list`, `issue new`, `issue icons`, and to `project view` / `project stats`
when the project is not named. It does **not** apply to commands naming an issue by its `ref` — refs
are unique within the space, and restricting would turn an issue from another project into "not
found".

Scope is **personal and machine-local**: it lives in `~/.config/atl/config.json`, never in a
versioned file. Precedence: explicit `--project`, then `ATL_PROJECT`, then the closest linked folder,
otherwise the whole space.

The space comes from the config, never from the application: the API has no notion of a current
space. `ATL_SPACE="<name>"` targets another one for a single command.

## Conventions to respect

**An error names what to do next; read it before concluding.** A misspelled option or command
answers with the nearest match — `--status` gets `Did you mean \`--state\`?`, `atl isue list` gets
`atl issue list`. Exit code 2 means the call was wrong, never that `atl` cannot do the thing:
`atl <command> --help` lists every option that command accepts, with its accepted values. Reporting
a capability as absent without having read that help is how a request gets filed for something the
CLI already does.

**Resolution by name.** States, priorities, labels, projects and refs are given by name or by a
Linear alias (`todo`, `started`, `review`, `done`, `high`, `none`). Never an Anytype identifier. An
ambiguous reference exits with code 3 and lists the candidates: narrow it down, do not guess.

**Acceptance criteria.** Every created issue carries some: `--ac` is repeatable. Without them the
command warns, and the warning is deserved.

**Default state: Todo.** A created issue is committed work. To park a thought without committing
to it, `-s backlog` — which also takes it out of the progress computation.

**One issue, one branch.** `atl issue start <ref>` moves the state to In Progress and records the branch
name. **The CLI never touches Git**: running `git checkout` is up to the caller. From an existing
branch:

```sh
atl issue done "$(git branch --show-current)"
```

**Dev labels**: `Bug`, `Feature`, `Refactor`, `Improvement`, `QA`. One per issue (`dev_label`
is a select). Never write to `tag`, the owner's personal vocabulary, shared by all their objects.

**Never pass a custom body to a project.** `atl project new` handles it: the template's body carries
a dynamic table that a custom body would overwrite.

## Exit codes

| Code | Meaning | Reaction |
|---|---|---|
| 2 | usage | read the suggestion the message carries, or run `atl <command> --help`; never conclude from it that the capability is missing |
| 3 | not found or ambiguous | narrow the reference, do not guess |
| 4 | incomplete install: no app key, or space without the dev types | run `atl auth` or `atl init`, per the message; do not work around it |
| 5 | API unreachable | say to open Anytype, do not retry in a loop |

## Known limits

The Anytype API **does not expose an object's comments**: to pass a detail along on an issue, write it
in the body (`atl issue edit --description`), not in the discussion.

**Deleting does not free a key.** A deleted property stops being listed but its key stays refused
for good; a deleted type stays listed *and* keeps its key. So `atl init` cannot re-create a dev type
someone deleted — it sees the archived one and creates nothing. Say so rather than retrying.

**A template cannot be resynchronised.** The API does not see a template's blocks — it returns one
line of text, never the dynamic table — because `update-object` accepts markdown only, which cannot
express a view block. Updating a template therefore does not benefit existing objects, and no command
will fix it: point the user to the app.

The markdown the API returns is unfaithful — tables come back damaged. `atl issue ac` and
`edit --description` **refuse** to rewrite a body containing a table rather than degrade it: point the
user to the app.

Full list of measured limits and frozen decisions: `docs/ANYTYPE-LIMITS.md`.
