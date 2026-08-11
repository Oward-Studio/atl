# Anytype as seen by `atl` — measured limits and frozen decisions

This file replaces the original specification, which became useless once the project shipped. It
does not describe what `atl` does — `atl --help` and the code say it better — but **what the API
cannot do** and **what we decided not to do**, with the measurement or the reasoning behind it.

Every finding carries its date and its method. That is what makes it re-verifiable rather than
merely believable, and what prevents probing the same API again in six months — or reintroducing a
command that was ruled out because it destroyed data.

Anytype content stays in French throughout: state names, property keys and the acceptance-criteria
heading are data stored in the owner's space, not interface strings.

## 1. What the API cannot do

### 1.1 Comments do not exist

The API does not expose an object's discussion. To pass a detail along on an issue, write it in the
**body** (`atl issue edit --description`), not in the discussion: nothing there will be read.

Accepted consequence: the `atl-issue-comments` issue stays in the backlog, blocked upstream.

### 1.2 Markdown does not survive a round trip

`update-object` accepts a markdown body only, and what comes back is not what was written.

- **Tables come back damaged**: cells return separated by `<br>`. `atl issue ac` and
  `edit --description` therefore **refuse** to rewrite a body containing a table rather than degrade
  it — in that case, point the user to the application.
- **Escapes accumulate**, one level per write → read cycle: measured 2 → 3 → 4 backslashes on the
  real space. Hence `forWriting` (`src/model/acceptance.ts`), which unescapes to a fixed point
  instead of making a single pass. Verified: 4 → 1, then stable.
- **Checkboxes do survive**, which is what makes acceptance criteria viable at all.

### 1.3 HTML entities are stored, not merely displayed

A probe named `sonde <marqueur> html` came back **verbatim**: the API re-encodes nothing. An `&amp;`
in a title is therefore **real data corruption**, not a display artefact. `atl ls` reports it
instead of hiding it — five titles had been damaged before this was understood.

### 1.4 A template's blocks are invisible

Re-read on 2026-08-10: `GET /types/{id}/templates` followed by `get-object` on each returns

| Template | `markdown` |
|---|---|
| `dev_project` | `"<the intro paragraph>   \n   \n"` |
| `dev_issue` | `"   \n"` |

One line of text, and an empty string. The dynamic table block listing linked issues — the whole
point of the template — **does not exist for the API**, and cannot: markdown has no way to express
a view block.

**Two consequences.** Updating a template does not benefit objects already created, and *no command
will ever fix that*: a resynchronisation would replace project bodies with a line of text and delete
their table. And **`atl project new` never passes a custom body** to a project — the body comes from
the template, and a custom one would overwrite it. For an issue, by contrast, the body *is* the
description.

A brand-new type has **no** template, and none can be created: neither `template_id` nor
`is_template` on `create-object` produces one. `project new` and `issue new` degrade cleanly — they
create without one.

### 1.5 `update-type` cannot remove a property

It accepts the call and does nothing. It can **add** one (`github_link` was added that way).
Removing happens in the application.

This matters for `atl init`: Anytype attaches `tag` and `backlinks` to every new type, and `tag` is
the owner's personal vocabulary — **the CLI never writes to it**, it uses `dev_label`. Removing
`tag` from the created types is therefore a manual chore, which `atl init` announces.

### 1.6 The palette has no green

`bad input: invalid color: "green"` — measured across the eleven colours, `green` alone is refused,
even though the MCP schema advertises it. `lime` stands in for the Done state.

### 1.7 A fresh space is not empty

**34 native properties** exist before any bootstrapping, including `linked_projects` with format
`objects` — exactly what the schema expects. `atl init` therefore creates only 10, and reuses the
existing one.

Reuse is intended, but conditional: if a same-named property exists **with a different format**,
`atl init` fails with exit code 1 and names the conflict. Building on top of it would produce a
space the CLI reads wrongly, silently.

### 1.8 There is no `delete-space`

`create-space` exists, its inverse does not. Any space created for a test has to be deleted by hand
in the application. That is why the `atl init` acceptance run happened on a space the owner had
created himself.

### 1.9 The API does not know which space is open

`/v1/spaces` returns `id, name, icon, description, gateway_url, network_id`. Neither "current" nor
"last opened".

The one nearby signal is a trap: `last_opened_date` belongs to **objects**, and also fires on those
`atl` creates. The last thing the CLI wrote would therefore look like the space being worked in, and
a write command would nominate itself on the next run. **No guessing**: the space comes from the
configuration (`atl space` to change it, `ATL_SPACE` to target one for a single call).

### 1.10 A missing type fails without saying so

On a space that was never bootstrapped, `create-object` answers `HTTP 500 — failed to create
object`, and a search by type returns **zero results silently** — indistinguishable from an empty
space. Hence the guard: `issue new`, `project new` and `ls` exit with **4** and name `atl init`.

### 1.11 Relations have no reciprocal

Writing `A.blocked_by = [B]` leaves `B.blocking` **empty**. Verified on the real space. The CLI
therefore writes **both sides**, otherwise `atl issue view B` would not show that B blocks A.

A live contract test locks this finding down: if it ever fails, Anytype now maintains the inverse
and the double write can go.

### 1.12 `backlinks` exists, but cannot serve here

Anytype does **maintain** `backlinks` (already declared on `dev_issue`), in real time, and a
relation value feeds it. It is read-only: `property 'backlinks' cannot be set directly as it is a
reserved system property`.

It still cannot carry the reciprocal, for two measured reasons:

- **it loses direction**: with `A.blocked_by = [B]` and `A.blocking = [C]`, one reads
  `B.backlinks = [A]` **and** `C.backlinks = [A]`;
- **it aggregates everything**: 28 backlinks on a project, one per issue declaring it in
  `linked_projects`, plus body mentions.

No property format offers a configurable inverse — `objects` is a bare link, there is no equivalent
of Notion's synced relation.

### 1.13 Renaming: what follows, what does not

Measured on the real space, with the delay that first fooled me.

**Renaming a tag propagates** to every object carrying it, in **under 300 ms**. The name is resolved
from the tag id at read time, so no object needs rewriting. That is how the six state names moved to
English across 234 issues without touching one of them. My first probe read the object immediately
after the patch and concluded the opposite — the propagation is asynchronous, and reading at 0 ms
catches the stale value.

**Renaming a tag key propagates too**, and so does **renaming a property key** — measured, and it
corrects what this section claimed before. `etat` became `state`, `priorite` became `priority`,
`branche_git_hub` became `github_branch`: every object reported the new key immediately afterwards,
and the CLI read them without a migration. Objects therefore reference properties and tags **by id**,
the key being a label on the definition rather than a copy stored per object.

That is what allowed the French keys Anytype had minted from the original French names to be dropped
from the code entirely. A space bootstrapped in French needs its keys renamed once — through the API,
since the application exposes a type's or property's **name** but not its key.

**Renaming a type key** goes through `update-type`, which means passing the full property list back
(see below), and is the one rename this project has not exercised.

**Renaming a property display name is free.** The CLI resolves properties by key, never by name.

**`update-type` replaces the property list, it does not merge it.** Passing `properties: [one]`
dropped `ref` and `backlinks` from `dev_issue` — a declaration lost in one call, and only noticed
because the type was read back. Any call must pass the **complete** desired list, rebuilt from
`list-properties`.

Whether renaming a property **key** follows on objects is **not established**: both attempts to
measure it were inconclusive, the property never appearing on the object within the observation
window. Until it is measured, treat a key rename as unsafe — the keys are internal identifiers,
invisible in the application, so there is nothing to gain by trying.

### 1.14 Deleting does not free a key

Deletion is logical, not physical, and the key stays reserved for good. Measured on the real space:

| | after `DELETE` |
|---|---|
| a property | no longer listed, yet `create-property` refuses its key |
| a type | **still listed**, and `create-type` refuses its key |

Two consequences.

**The live contract suite appends a per-run token** to its throwaway keys. A fixed key would make
the suite pass exactly once, then fail forever with `property key "…" already exists` — which is
precisely how it failed the first time.

**`atl init` cannot re-bootstrap a type that was deleted.** Worse, since a deleted type is still
listed, `init` sees it as present and creates nothing: the space is left with an archived type the
CLI believes in. Deleting a dev type is therefore not an undo — recovering means a new space, or a
new key, neither of which the CLI can do.

## 2. Frozen decisions

### 2.1 The CLI runs no Git command

`atl` drives Anytype. It does not inspect the repository, does not know whether it is inside one,
performs no `checkout`, opens no pull request. **The caller supplies the context**:

```sh
atl issue done "$(git branch --show-current)"
```

`atl issue start` records the branch name derived from the `ref` and the link to the project's
repository, the way Linear suggests a name without creating the branch. If the user picks a
different one, that is their choice.

Three guards hold this rather than a code review: no file under `src/` references `child_process`,
`execFile`, `execSync` or `spawn`; no command summary promises a Git operation; no operand
advertises its `ref` as optional.

Corollary: **automatic merge detection is out of scope**. It would require `gh` and a network
dependency.

### 2.2 Refs stay slugs

No `ATL-123` counter. `atl-relations` reads well in a branch name where `ATL-42` says nothing, and
the branch is precisely where a `ref` is used most. A counter would need a monotonic sequence Anytype
does not provide: a full scan of every issue, and a race between two simultaneous creations. Linear
has short refs because it has teams and no slugs.

### 2.3 No TOON format

Measured on 21 issues: `--json` 1,983 tokens, TOON with every field 1,015, TOON reduced to the
table's columns 513, **the existing table 598**. At equal information TOON gained only 14 % over the
table — and that gap came from alignment padding, not from the format. The real lever was elsewhere:
`--fields` gives 48 % (§3.5).

### 2.4 No interactive pickers

A prompt only serves a human, blocks any non-interactive call, and would require a hand-written TUI.
Refs are quick to type and resolve by prefix.

### 2.5 A relation whose blocker is closed is not deleted

Like Linear, whose documentation states that once the blocker is resolved *"the relationship moves
under Related"*: the relation is **demoted** under "Lié" in `issue view`, never erased — it is
history. Cancelling an issue does not touch its relations.

Original measurement: across 219 issues, a single dependency pointed at a cancelled issue, both of
them closed, and **no still-open issue** carried one. Nothing to report in `ls`, therefore: a closed
relation is not an anomaly.

### 2.6 `atl init` is not a migration

The plan starts from the **missing types** and creates only the properties they need; an existing
type is left untouched. Creating a property without attaching it would leave an orphan — and since
`update-type` cannot properly amend an existing type, bootstrapping an empty space and evolving a
populated one are two different jobs.

### 2.7 No build step

`tsx` runs `src/` directly. The cost is measurable: of the 160 ms it takes a command to start, Node
accounts for 65 and `tsx` for 80 to recompile on every call — the remaining 15 ms being module
loading. A build step would recover those 80 ms.

Ruled out: 270 ms for a command querying a local API is not felt, and a `dist/` introduces the risk
of running stale JS. Direct iteration is worth more than a third of the latency.

## 3. Rules that govern the code

### 3.1 No hardcoded identifiers

No `bafyrei…` anywhere in the code. Space, types, properties, tags and projects all resolve **by
name** at run time, with a 24-hour cache (`~/.cache/atl/`) partitioned per space
(`property:{spaceId}:{key}`).

**Semantic keys** are accepted, however: `dev_issue`, `state`, `priority`, `dev_label`,
`linked_projects`, `blocked_by`, `blocking`, `github_branch`, `github_link`, `ref`, `progress`,
`repo`. They are stable and readable. States and priorities are identified by their **tag key**,
never by a display name; the CLI additionally accepts the Linear terms (`todo`, `started`,
`review`, `done`, `high`, `none`).

`No priority` is a **real** priority as much as an absence: `--priority none` must match both.

### 3.2 Icon = state colour

⚪ Backlog · 🔵 Todo · 🟡 In Progress · 🟣 In Review · 🟢 Done · 🔴 Canceled.

Transition commands set the icon themselves. Drift comes from edits made by hand in the application:
`atl ls` **reports** it for free, since the information is already in the fetched objects, and
`atl issue icons` fixes it. That command writes **in bulk**: it refuses to act without a target
project, the convention holding for one project and not for an entire space — 191 personal icons
were overwritten the day it ran without a target.

### 3.3 Acceptance criteria

Convention: a `## Acceptance criteria` heading followed by markdown checkboxes. Heading detection
ignores case, accents and apostrophe style. Free text found inside the section returns to the
description rather than disappearing.

### 3.4 Progress formula

```
progress = done / (total − cancelled − backlog)
```

Rounded, and 0 when the denominator is zero. Recomputed on every event that changes it — the six
transitions and `issue new` — from the issues **already loaded**, so nothing is re-read; only the
projects are fetched, 6,102 tokens absorbed against 268,655 for the issues. The variation is printed:
an implicit, silent write is what destroyed 191 icons. `atl project stats` remains useful for drift
coming from the application. Backlog is excluded from the calculation, which is what allows parking
a thought there without dragging the percentage down. A newly created issue therefore starts in
**Todo**, not in the backlog.

### 3.5 Output: table by default, `--json` to parse

The table is readable as it stands; `--json` triples the cost. `--fields ref,state,title` trims it
further: measured on 221 issues, `--json` 20,838 tokens, reduced to the table's five columns 10,869
(−48 %), reduced to `ref,state` 3,503 (−83 %). The `id` field alone weighs **31 %**, for information
almost never used.

`--json` returns relations as they are stored, without the grouping the display applies: data for a
script, where the view is a reading aid.

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | generic error |
| 2 | usage |
| 3 | not found or ambiguous |
| 4 | incomplete install: missing app key, or space without the dev types |
| 5 | API unreachable |

### 3.6 Current-folder scope

A path → project association, held in `atl`'s own configuration (never a versioned file), applies a
default project to commands that do not name one. Precedence: `--project`, then `ATL_PROJECT`, then
the closest association, otherwise the whole space. The longest prefix wins, on folder boundaries —
`/Sites/atl` must not capture `/Sites/atl-autre`.

It applies to `issue list`, `issue new`, `issue icons`, and to `project view` / `project stats` when
the project is not named. It does **not** apply to commands naming an issue by its `ref`: refs are
unique within the space, and restricting would turn an issue from another project into "not found".

### 3.7 Branch name

Derived from the `ref`, phase prefix removed. `atl issue start` always writes it to
`github_branch`, and the full link to `github_link` — derived from the project's `repo`, never
hardcoded. Since `atl issue pr` was abandoned, replacing that link with the pull request's is up to
the caller (`atl issue edit --link`).

### 3.8 Token calibration (`atl gain`)

`rtk` **proxies** the real command: it sees the raw output and the filtered output, and the
difference is a measurement. `atl` replaces MCP calls **that never happen** — there is no raw output
to compare against. The command therefore keeps two kinds of number apart.

**Measured**, one JSON line per invocation in `~/.local/state/atl/usage.jsonl`: `in` (characters
returned by the API), `out` (characters written), `calls`, `ms`. Never an argument, never issue
content, no network call, and `ATL_NO_USAGE=1` disables recording. Counted in **characters / 4**,
`rtk`'s heuristic, in characters rather than bytes.

**Estimated**: the MCP equivalent. `absorbed − rendered` would flatter — `atl ls` sweeps the whole
space where an agent wanting *one* issue would have read a single object. Savings are therefore
counted against a per-command baseline, **capped twice**:

| Baseline | Value | How it was obtained |
|---|---|---|
| one object read through MCP | **1,964 tokens** (7,857 chars) | `GET /objects/{id}` on a real `dev_issue`, 2026-08-10 — the body embeds the type schema |
| reading a set | absorbed volume | the API cannot return less than a full page |
| ceiling per invocation | **50,000 tokens** | convention, not measurement: a quarter of a 200,000 context |

The ceiling is what makes the figure defensible. Without it `atl ls` counts 261,000 tokens of
baseline: the volume is real, but nobody would have paid it — a response that size fits in no
context. The MCP alternative was not expensive, it was **impossible**, and counting the impossible as
a saving yields 1,326,613 tokens claimed against 326,646 once capped. `atl gain` states how many
invocations it capped; the absorbed volume itself stays displayed raw.

**Re-measuring** a baseline: run a command, read `in` in the journal — the same instrumentation
produces the figure.

### 3.9 Time budget of a command

Measured over five repetitions, the first invocation discarded — the local API has a warm-up effect
that doubles it.

| | time |
|---|---|
| Node alone | 65 ms |
| `tsx` recompiling on every call | +80 ms |
| loading the 47 modules | +15 ms |
| **floor** | **160 ms** |
| `atl gain` (no API call) | 158 ms |
| `atl ls`, `issue view`, `project view` | 270 to 285 ms |

**More than half of a command's time is startup**, not the API. Optimising calls therefore only
touches the remaining hundred milliseconds, and gets lost there quickly: taking `atl ls` from four
calls down to two gained 20 ms of internal time, invisible end to end.

What was tried without success, and should not be tried again:

- **no projection.** `properties: [ref, state]` and `fields=ref` are ignored; the response weighs
  229,817 tokens either way. The absorbed volume is structural.
- **full-text search does not index `ref` values.** `query=atl-sobriete` returns zero results where
  `query=sobriete` returns one: resolving a reference through a narrow query is impossible, so
  reading every issue is unavoidable.

### 3.10 What the tests prove, and what they cannot

The hermetic suite talks to a **fake Anytype server**. It proves the CLI behaves correctly given a
spec-conformant API, which is what most of the code is about. It cannot prove the spec still holds:
if Anytype changes a response shape, the fake keeps agreeing with the CLI and everything stays green.

That is the job of the contract suite, which talks to the real API and exists to confront the fake
with it. Each claim the fake makes about Anytype should have a test there. The ones that matter
today: resolvable property keys, states and priorities covering what the CLI knows, tags matching
the fake's, the acceptance-criteria round trip, the absent reciprocal relation, and the four
behaviours `atl init` depends on — inline tags on `create-property`, `green` refused, an existing
property linked by `create-type` without duplication, `tag` and `backlinks` attached by default.

The contract suite **cannot run in CI**: it needs the desktop application and a paired app key. So
nothing detects an Anytype change automatically — run `npm run test:live` after an Anytype update.
The gap is structural, and naming it is the only honest way to live with it.
