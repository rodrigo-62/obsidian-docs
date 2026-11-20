---
folio: true
folio-font: "Tinos"
folio-font-size: 12
---

# Footnotes and embeds

A sentence with a normal footnote.[^note] Another with an inline footnote.^[Inline footnotes are converted to numbered ones in the export.] A third reuses the first.[^note]

A footnote with a long, multi-paragraph definition.[^long]

## Embeds

The next line embeds a whole note:

![[Embedded note]]

And this embeds one section of it:

![[Embedded note#Second section]]

An image with alt text:

![[diagram.png|A small test diagram]]

A Markdown image: ![A remote image](https://example.com/picture.png)

A link that is not an embed: [[Embedded note]].

%% A private note-to-self that the export should drop by default. %%

Some <!--c:fe1x-->commented text next to a footnote<!--/c:fe1x-->[^note].

[^note]: The first footnote definition.

[^long]: The first paragraph of a long footnote.

    The second paragraph, indented to belong to the footnote.

<!--folio:threads
{
  "fe1x": {
    "quote": "commented text next to a footnote",
    "created": "2026-11-16T12:00:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-16T12:00:00Z", "body": "Footnote and comment side by side." }
    ]
  }
}
-->
