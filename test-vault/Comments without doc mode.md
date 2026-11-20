---
tags: [test]
---

# Comments without doc mode

This note has **no** `folio: true` in its frontmatter, so it keeps the normal Obsidian look. But it contains <!--c:nd1c-->comment markers<!--/c:nd1c-->, so the comments must still render: the markers stay hidden, the text is highlighted, and a card appears in the margin.

​<!--c:nd2c-->A second comment, at the start of a paragraph.<!--/c:nd2c--> It has a reply.

<!--folio:threads
{
  "nd1c": {
    "quote": "comment markers",
    "created": "2026-11-17T09:00:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-17T09:00:00Z", "body": "Comments are independent of doc mode." }
    ]
  },
  "nd2c": {
    "quote": "A second comment, at the start of a paragraph.",
    "created": "2026-11-17T09:05:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-17T09:05:00Z", "body": "Root." },
      { "id": "a2", "parent": "a1", "created": "2026-11-17T09:06:00Z", "body": "Reply." }
    ]
  }
}
-->
