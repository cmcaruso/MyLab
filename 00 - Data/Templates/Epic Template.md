<%* const name = await tp.user.new_entity(tp, "EPC") -%>
---
type:
  - "[[Epics]]"
name: <% JSON.stringify(name) %>
aliases:
  - <% JSON.stringify(name) %>
projects:
archive: false
cssclasses:
  - wide
  - justify
  - hidden-css
---

## Stories
![[Stories.base#Related]]