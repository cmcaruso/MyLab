<%* const name = await tp.user.new_entity(tp, "PRJ") -%>
---
type:
  - "[[Projects]]"
name: <% JSON.stringify(name) %>
aliases:
  - <% JSON.stringify(name) %>
org:
activities:
status:
priority: Medium
archive: false
cssclasses:
  - wide
  - justify
  - hidden-css
---

## Epics
![[Epics.base#Related]]