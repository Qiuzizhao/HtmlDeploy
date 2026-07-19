# Admin Pagination Layout Design

## Problem

The project pagination footer places the text `每页` and its page-size select
inside a semantic `label`. The admin-wide form rule renders every `label` as a
grid, so these two pagination controls stack vertically. That makes the footer
unnecessarily tall and causes the page-size group to occupy excessive width.

## Design

Keep the existing accessible label and add a pagination-scoped layout override:

- `.site-pagination label` uses horizontal inline flex layout.
- The label text and page-size select are vertically centered with an 8 pixel
  gap and do not wrap independently.
- Desktop pagination remains one horizontal row: page size, previous button,
  page information, and next button.
- At the existing narrow-screen breakpoint, the overall pagination toolbar may
  use its current column layout, but `每页` and its select remain on one row.
- The global form-label grid rule and the forbidden-word pagination remain
  unchanged.

## Verification

A static regression assertion will require the scoped label selector to use
inline flex, centered alignment, an 8 pixel gap, and no wrapping. The existing
admin page tests and full suite will be run; no failure may be introduced beyond
the eight accepted baseline failures.

## Scope

Only `public/admin.html` and its static regression coverage in
`test/app.test.js` require implementation changes. No API, pagination data,
button behavior, select options, or responsive breakpoint changes are included.
