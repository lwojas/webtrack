---
name: frontend-visual-review
description: Visual QA and correction pass for this repo's UI — reviews the rendered frontend (not just source) against DESIGN.md/the design-system tokens/existing component conventions, finds spacing, alignment, sizing, hierarchy, consistency, and responsive issues, categorizes them (Critical/Consistency/Polish), and fixes the high-value ones with minimal targeted CSS. Run this proactively, without being asked, right after finishing any implementation that touched CSS, styles, layout, or visual component markup in this repo — treat it as the visual counterpart to a code-review pass: implementation done + CSS changed is itself the trigger. Also use it whenever the user explicitly asks for a visual review, UI polish, or to check spacing/alignment/consistency.
---

# Frontend Visual Review

## Purpose

Perform a visual quality review of the frontend, identify issues with spacing, alignment, sizing, hierarchy, consistency, and responsive behaviour, then implement the appropriate fixes.

This is a **visual QA and correction skill**, not a redesign exercise.

The goal is to make the existing interface feel deliberate, consistent, and aligned with the repository's established visual language.

---

## Workflow

Follow this process in order.

### 1. Understand the house rules

Before reviewing the UI:

* Inspect `DESIGN.md`, design-system documentation, style guides, token definitions, CSS variables, component conventions, and other relevant project documentation.
* Identify the repository's established rules for:

  * spacing
  * typography
  * colours
  * borders
  * radii
  * control heights
  * alignment
  * layout
  * responsive behaviour
  * component states
* Inspect existing components and patterns to understand how those rules are actually implemented.
* Treat existing design-system conventions as the source of truth rather than inventing new visual rules.

If a rule is explicitly documented, follow it.

If it is not documented, infer patterns from the existing UI and prefer consistency over invention.

---

### 2. Inspect the actual frontend

Run the application using the repository's normal development workflow.

Review the UI at realistic viewport sizes.

Prioritise the screens and components relevant to the current task, but also inspect surrounding UI where a change could affect layout or consistency.

Look at the rendered result rather than relying only on source code.

Pay particular attention to:

* inconsistent spacing
* elements that are almost, but not quite, aligned
* inconsistent control heights
* uneven padding
* inconsistent gaps
* misaligned labels and controls
* incorrect vertical centering
* inconsistent margins between sections
* text that sits at different baselines when it should align
* buttons or inputs that do not line up with neighbouring controls
* inconsistent widths
* unexpected stretching or shrinking
* awkward empty space
* cramped areas
* visual hierarchy that is unclear
* elements that appear accidentally offset
* inconsistent use of borders, dividers or containers
* overflow
* clipping
* wrapping that creates awkward layouts
* responsive breakage
* controls that become difficult to use at smaller widths
* duplicated or conflicting visual patterns

Do not treat every difference as a bug.

Some differences may be intentional because of hierarchy, interaction state, content, or component type.

---

### 3. Make a visual review

Before making changes, create a concise internal review.

Group findings into:

#### Critical

Issues that visibly break the interface, cause overlap, clipping, unusable controls, or significant responsive problems.

#### Consistency

Issues where an element conflicts with an established design-system or house pattern.

Examples:

* one control is taller than equivalent controls
* one section uses a different spacing scale
* one label is aligned differently from equivalent labels
* one component uses a different radius or border treatment

#### Polish

Minor visual issues such as:

* 2–4px alignment problems
* slightly uneven spacing
* inconsistent optical alignment
* unnecessary whitespace
* small hierarchy problems

Do not fix something merely because it could theoretically be different.

There should be a clear visual reason for every change.

---

## House Rules

### Spacing

Prefer the repository's existing spacing scale.

Do not introduce arbitrary spacing values when an existing token or established value provides the same result.

Look for relationships between elements rather than isolated margins.

Prefer:

```css
gap: var(--space-2);
```

over introducing a new one-off value when the project already provides the appropriate token.

Avoid accumulating compensating margins.

If several elements need individual margin adjustments to align correctly, investigate the parent layout first.

---

### Alignment

Prefer structural alignment over visual nudges.

Fix the layout mechanism before adding positional offsets.

For example, prefer:

* flex alignment
* grid alignment
* shared container widths
* consistent gaps
* common padding

over:

```css
transform: translateY(...);
```

or arbitrary negative margins.

Small optical corrections are acceptable when genuinely required, but they should be the exception.

---

### Sizing

Equivalent controls should normally share:

* height
* padding
* border treatment
* typography
* alignment

Avoid arbitrary widths unless the content or interaction requires them.

Do not make controls wider merely to fill available space if that conflicts with the established UI.

---

### Typography

Check:

* font family
* font size
* weight
* line height
* letter spacing
* text colour
* wrapping
* baseline alignment

Use existing typography tokens and patterns.

Do not introduce new typography styles simply to solve a local problem.

---

### Layout

Prefer fixing the parent layout when several children exhibit alignment problems.

Avoid absolute positioning for ordinary layout.

Avoid adding containers solely to make one visual adjustment unless the container represents a meaningful layout boundary.

Maintain clear relationships between:

* page
* section
* group
* control
* label
* content

---

### Responsive behaviour

Check at least:

* desktop
* narrow desktop/tablet
* mobile

Look for:

* overflow
* clipped content
* controls becoming unusably small
* unexpected wrapping
* broken grid/flex layouts
* excessive horizontal scrolling
* inconsistent spacing at breakpoints

Follow existing responsive conventions rather than creating new breakpoints unnecessarily.

---

### Existing patterns

When an existing component already solves the problem, reuse it.

Do not create a new visual pattern when an equivalent established pattern exists elsewhere in the application.

Consistency is more important than local optimisation.

---

## Implementation

After the review:

1. Fix the highest-value visual issues.
2. Keep the changes focused.
3. Preserve existing functionality.
4. Do not redesign unrelated areas.
5. Do not change content or interaction behaviour unless required to resolve the visual issue.
6. Do not introduce new dependencies.
7. Avoid broad CSS rewrites when a local structural fix is sufficient.
8. Remove obsolete CSS created by the change.

Prefer the smallest implementation that produces the correct visual result.

---

## Verification

After implementing fixes:

* Run the relevant tests/build/lint checks.
* Re-open the affected UI.
* Review the same viewport sizes used during the initial inspection.
* Confirm that the original issues are actually resolved.
* Check that the fix did not introduce new alignment, spacing, overflow, or responsive problems.
* Check nearby components for unintended visual changes.

If a visual issue cannot be reliably verified, say so rather than assuming it is fixed.

---

## Final report

Finish with a concise report containing:

### Reviewed

The screens/components reviewed.

### Findings

The important visual issues discovered.

### Fixed

The issues actually changed.

### Not changed

Any findings intentionally left alone, with a brief reason.

### Verification

Tests/checks performed and whether the affected UI was visually rechecked.

Keep this report concise.

---

## Important constraints

This skill is not a redesign prompt.

Do not:

* invent a new design language
* introduce unnecessary gradients, shadows, animations, or decorative elements
* make arbitrary aesthetic changes
* replace established components without reason
* refactor unrelated code
* "improve" things simply because they differ from personal preference
* make large changes based solely on source-code inspection

The repository's existing design rules and visual patterns take precedence.

The desired outcome is:

**same interface, better execution.**
