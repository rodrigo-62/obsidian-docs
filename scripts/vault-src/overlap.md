---
folio: true
folio-theme: dark
folio-font-size: 12
folio-width: 40
---

# Overlapping, nested and tricky comments

This note exercises the edge cases of the anchor format. It is in doc mode with the **dark** page theme.

## Overlap

{ZW}<!--c:ov1a-->Overlapping ranges are allowed: this sentence starts the first range, <!--c:ov2b-->and this clause belongs to both ranges<!--/c:ov1a-->, while this one is only in the second.<!--/c:ov2b--> The overlapping middle should look darker.

## Nesting

{ZW}<!--c:ns1o-->An outer comment covers this whole sentence, including <!--c:ns2i-->a nested inner phrase<!--/c:ns2i--> in the middle of it.<!--/c:ns1o-->

## Across paragraphs

The next range <!--c:xp7p-->starts in this paragraph,

continues through this one,

and ends here<!--/c:xp7p--> before the full stop.

## Block starts

- {ZW}<!--c:li4s-->A comment on a list item<!--/c:li4s--> (the marker sits after the bullet).
- [ ] {ZW}<!--c:tk9x-->A comment on a task item<!--/c:tk9x-->

> {ZW}<!--c:bq3e-->A comment at the start of a blockquote.<!--/c:bq3e-->

## Code is ignored

Markers inside code must be treated as plain text:

```html
<p>Not a comment: <!--c:zz99-->literal<!--/c:zz99--></p>
```

And inline: `<!--c:zz98-->` is also literal.

## Damaged data

This paragraph has a lone start marker <!--c:lone-->with no end marker, which the plugin should repair or drop without crashing.

The thread "dt5k" below has no markers at all: it should appear under **Detached comments**.

<!--folio:threads
{
  "ov1a": {
    "quote": "Overlapping ranges are allowed: this sentence starts the first range, and this clause belongs to both ranges",
    "created": "2026-11-15T10:00:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:00:00Z", "body": "First of two overlapping comments." }
    ]
  },
  "ov2b": {
    "quote": "and this clause belongs to both ranges, while this one is only in the second.",
    "created": "2026-11-15T10:01:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:01:00Z", "body": "Second overlapping comment. Its body contains a tricky sequence: --\u003e which must not end the HTML comment." }
    ]
  },
  "ns1o": {
    "quote": "An outer comment covers this whole sentence, including a nested inner phrase in the middle of it.",
    "created": "2026-11-15T10:02:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:02:00Z", "body": "Outer." }
    ]
  },
  "ns2i": {
    "quote": "a nested inner phrase",
    "created": "2026-11-15T10:03:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:03:00Z", "body": "Inner." },
      { "id": "a2", "parent": "a1", "created": "2026-11-15T10:04:00Z", "body": "A reply to the inner comment." }
    ]
  },
  "xp7p": {
    "quote": "starts in this paragraph,\n\ncontinues through this one,\n\nand ends here",
    "created": "2026-11-15T10:05:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:05:00Z", "body": "A range spanning three paragraphs." }
    ]
  },
  "li4s": {
    "quote": "A comment on a list item",
    "created": "2026-11-15T10:06:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:06:00Z", "body": "List item comment." }
    ]
  },
  "tk9x": {
    "quote": "A comment on a task item",
    "created": "2026-11-15T10:07:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:07:00Z", "body": "Task item comment." }
    ]
  },
  "bq3e": {
    "quote": "A comment at the start of a blockquote.",
    "created": "2026-11-15T10:08:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:08:00Z", "body": "Blockquote comment." }
    ]
  },
  "lone": {
    "quote": "with no end marker, which the plugin should repair or drop without crashing.",
    "created": "2026-11-15T10:09:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-15T10:09:00Z", "body": "Thread whose end marker is missing." }
    ]
  },
  "dt5k": {
    "quote": "a sentence that was deleted long ago",
    "created": "2026-11-01T08:00:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-01T08:00:00Z", "body": "This comment's text was deleted, so it is detached." }
    ]
  }
}
-->
