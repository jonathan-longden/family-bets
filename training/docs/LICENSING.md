# Data licensing and provenance

Defect Log may become a commercial product. That makes the licence of every
training image a real question rather than a formality: a model trained on
material we were not entitled to use is a model that cannot be shipped, and
the problem is discovered late and is expensive to unwind.

So every image in this dataset traces to a row in `dataset/sources.csv`, via
its session in `dataset/sessions.csv`. There is no route into the dataset that
skips that — `dl.py validate` errors on a session citing a source that does
not exist.

## The register

`dataset/sources.csv`:

| column | meaning |
|---|---|
| `source_id` | referenced by `sessions.csv` |
| `kind` | `own-capture`, `external-dataset`, or `third-party-supplied` |
| `name` | what it is called |
| `url` | where it came from |
| `licence` | the licence, by name: `owner`, `CC-BY-4.0`, `CC-BY-NC-4.0`, … |
| `commercial_use` | `yes`, `no`, or `unknown` |
| `obtained_on` | when |
| `evidence` | **where the proof is kept** — a saved licence page, an email, a signed permission |
| `notes` | anything a later reader needs |

`commercial_use` is a **judgement we have recorded**, not a guess. If it is
`unknown`, that is the honest answer and the tooling treats it as such:

- `dl.py validate` warns for every session on a source that is not `yes`
- `dl.py build --commercial` **excludes** those sessions outright and lists
  what it dropped

So a commercial build and an experimental one come from the same repository
without anyone having to remember which sessions were which.

## Our own captures

Photographs taken by us are recorded separately, with `kind: own-capture`, a
`licence` of `owner` and `commercial_use: yes`. That is the strongest
position available and the reason in-vehicle capture is the priority source in
[CAPTURE.md](CAPTURE.md) twice over — it is both the best-matched data and the
only data whose licence is not somebody else's decision.

Two things still need recording for our own captures:

- **Who took them.** If a contractor or an employee took the photographs, note
  it. Ownership of a photograph does not always sit where people assume.
- **What is in them.** Number plates and faces are personal data under UK GDPR
  whoever pressed the shutter. Training on them is normally defensible; publishing
  them is a different question, which is why `images/` is gitignored and this
  repository is published as-is by GitHub Pages. Blurring plates and faces
  before any external sharing is the safe default, and it does not harm the
  model — the road is the subject.

## Externally sourced datasets

**Do not assume an internet image is usable.** Three traps, in order of how
often they catch people:

1. **"Public" is not a licence.** Visible on a web page says nothing about
   reuse. A dataset with no stated licence is `commercial_use: unknown`, which
   means it stays out of a commercial build.
2. **Non-commercial licences mean it.** `CC-BY-NC` material cannot go into a
   model that ships in a paid product. Nor can most "research use only"
   academic sets — a large share of published pothole datasets carry exactly
   that restriction.
3. **Attribution is a condition, not a suggestion.** `CC-BY` requires credit.
   If a set is used, the attribution has to appear somewhere real in the
   product, and `notes` should say where.

Also worth knowing: aggregator platforms host datasets under a mix of
licences, and the platform's own terms are not the dataset's licence. Read the
dataset's.

Before adding an external source, save the licence page — the actual page, as
a PDF or a screenshot, dated — and name that file in `evidence`. A link is not
evidence; pages change.

## Scraped and third-party images

- **Do not scrape image search.** Almost all of it is someone else's
  copyright, and no amount of "it's only for training" changes that.
- **Council and authority photographs** are usually the authority's property.
  Ask, and keep the reply. An email granting permission is `evidence`.
- **Images a customer sends** are theirs. If they are to be used for training,
  say so where they can see it, and record the agreement.
- **Synthetic and augmented images** inherit the licence of what they were
  made from. Augmenting a non-commercial image does not launder it.

## When something is wrong

If a source turns out to be unusable, the sessions citing it are the unit of
removal — that is why sessions are the unit of everything here. Set the
source's `commercial_use` to `no`, rebuild, and the images are gone from the
training set. If a model was already trained on them, it has to be retrained;
there is no way to remove an image from a trained model.

Which is the argument for getting this right at intake rather than at release.
