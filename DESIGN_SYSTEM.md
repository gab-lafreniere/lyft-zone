# Lyft Zone Design V2

Status: normative  
Scope: components rendered beneath `.lz-v2`  
Source: approved Lyft Zone onboarding screens, with their generated design values used only to resolve measurable visual details

The terms **MUST**, **SHOULD**, and **MAY** are normative. Design V2 is additive: it MUST NOT change existing Lyft Zone screens until a screen explicitly adopts `DesignV2Scope`.

## Integration contract

- A Design V2 subtree MUST be wrapped in `DesignV2Scope`, which renders `.lz-v2`.
- Design V2 CSS variables MUST use the `--lz-v2-*` prefix and MUST be declared on `.lz-v2`, never `:root`.
- Component selectors MUST begin with `.lz-v2`.
- Tailwind extensions MUST use the `lz-v2-` namespace. Existing tokens such as `primary`, `accent`, `surface`, and `display` MUST NOT be repurposed.
- Design V2 components MUST remain presentation-focused. Product validation, persistence, routing, analytics, and onboarding state do not belong in this package.
- Screens MAY override semantic tokens on a nested Design V2 scope, but MUST NOT consume raw palette tokens directly when a semantic token exists.

## Color

### Raw palette

Raw values describe the approved palette. Application components SHOULD consume semantic colors instead.

| Token | Value | Intended source use |
| --- | --- | --- |
| `--lz-v2-raw-black` | `#0E0E0E` | Deepest tonal layer |
| `--lz-v2-raw-charcoal` | `#131313` | Page background |
| `--lz-v2-raw-graphite-1` | `#1C1B1B` | Low surface |
| `--lz-v2-raw-graphite-2` | `#201F1F` | Standard surface |
| `--lz-v2-raw-graphite-3` | `#2A2A2A` | Raised/interactive surface |
| `--lz-v2-raw-graphite-4` | `#353534` | Strong interactive surface |
| `--lz-v2-raw-graphite-5` | `#3A3939` | Hovered/highest surface |
| `--lz-v2-raw-white` | `#FFFFFF` | Strong text |
| `--lz-v2-raw-off-white` | `#E5E2E1` | Default text |
| `--lz-v2-raw-sage` | `#C6C9AB` | Muted text |
| `--lz-v2-raw-olive` | `#909378` | Strong outline |
| `--lz-v2-raw-olive-dark` | `#454932` | Subtle outline |
| `--lz-v2-raw-lime` | `#D2F000` | Primary action and selection |
| `--lz-v2-raw-lime-dim` | `#B8D300` | Pressed action and progress end |
| `--lz-v2-raw-lime-ink` | `#191E00` | Content on lime |
| `--lz-v2-raw-cyan` | `#63F7FF` | Informational emphasis |
| `--lz-v2-raw-cyan-strong` | `#00DCE5` | Progress start and secondary accent |
| `--lz-v2-raw-cyan-ink` | `#002021` | Content on cyan |
| `--lz-v2-raw-error` | `#FFB4AB` | Error content/border |
| `--lz-v2-raw-error-container` | `#93000A` | Error surface |
| `--lz-v2-raw-error-ink` | `#FFDAD6` | Content on error surface |

### Semantic colors

| Token | Value | Required use |
| --- | --- | --- |
| `--lz-v2-color-bg` | `#131313` | Page canvas |
| `--lz-v2-color-bg-deep` | `#0E0E0E` | Recessed background |
| `--lz-v2-color-surface` | `#1C1B1B` | Cards and fields |
| `--lz-v2-color-surface-raised` | `#201F1F` | Disclosures and grouped controls |
| `--lz-v2-color-surface-interactive` | `#2A2A2A` | Buttons and selectable controls |
| `--lz-v2-color-surface-strong` | `#353534` | Selected neutral segments |
| `--lz-v2-color-surface-hover` | `#3A3939` | Pointer hover |
| `--lz-v2-color-text-strong` | `#FFFFFF` | Headings and critical values |
| `--lz-v2-color-text` | `#E5E2E1` | Default copy |
| `--lz-v2-color-text-muted` | `#C6C9AB` | Supporting copy and labels |
| `--lz-v2-color-text-disabled` | `rgba(229,226,225,.38)` | Disabled content only |
| `--lz-v2-color-border` | `#2A2A2A` | Default border |
| `--lz-v2-color-border-strong` | `#454932` | Strong separation |
| `--lz-v2-color-action` | `#D2F000` | Primary CTA, selected border, focus |
| `--lz-v2-color-action-pressed` | `#B8D300` | Pressed primary action |
| `--lz-v2-color-on-action` | `#191E00` | Content on action fill |
| `--lz-v2-color-info` | `#63F7FF` | Secondary numeric/informational emphasis |
| `--lz-v2-color-info-strong` | `#00DCE5` | Progress gradient start |
| `--lz-v2-color-on-info` | `#002021` | Content on info fill |
| `--lz-v2-color-danger` | `#FFB4AB` | Error content and outline |
| `--lz-v2-color-danger-surface` | `#93000A` | Destructive/error surface |
| `--lz-v2-color-on-danger` | `#FFDAD6` | Content on danger surface |
| `--lz-v2-color-focus` | `#D2F000` | Keyboard focus outline |

Lime MUST be reserved for primary action, selection, progress completion, and focus. Cyan MUST indicate secondary data or informational emphasis; it MUST NOT compete with the primary CTA.

## Typography

Sora is the display family. Inter is the body and UI family. A scoped fallback to Inter and system sans-serif is required while Sora loads.

| Role | Family | Size / line height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Display XL | Sora | `48 / 56px` | 800 | `-0.02em` |
| Heading LG | Sora | `32 / 40px` | 700 | `-0.01em` |
| Heading LG mobile | Sora | `28 / 34px` | 700 | normal |
| Heading MD | Sora | `24 / 32px` | 600 | normal |
| Body LG | Inter | `18 / 28px` | 400 | normal |
| Body MD | Inter | `16 / 24px` | 400 | normal |
| Label | Inter | `14 / 20px` | 700 | `0.02em` |
| Label caps | Inter | `12 / 16px` | 700 | `0.1em` |
| Stat numeric | Sora | `48 / 52px` | 800 | `-0.02em` |

- Heading levels MUST reflect document hierarchy; visual roles do not determine HTML heading rank.
- Body copy MUST use Inter even when placed inside a display-heavy card.
- Labels MUST NOT rely on capitalization alone to communicate meaning.

## Spacing

The primary rhythm is 8px. Four-pixel increments are allowed for compact internal alignment.

| Token | Value | Typical use |
| --- | --- | --- |
| `--lz-v2-space-1` | `4px` | Tight icon/label adjustment |
| `--lz-v2-space-2` | `8px` | Compact internal gap |
| `--lz-v2-space-3` | `12px` | Control gap |
| `--lz-v2-space-4` | `16px` | Standard padding/gutter |
| `--lz-v2-space-5` | `20px` | Mobile page gutter |
| `--lz-v2-space-6` | `24px` | Element group spacing |
| `--lz-v2-space-8` | `32px` | Large card padding |
| `--lz-v2-space-10` | `40px` | Section spacing |
| `--lz-v2-space-12` | `48px` | Desktop gutter |
| `--lz-v2-space-16` | `64px` | Hero/major separation |

## Radii

| Token | Value | Use |
| --- | --- | --- |
| `--lz-v2-radius-xs` | `4px` | Compact indicator |
| `--lz-v2-radius-sm` | `8px` | Inputs and small controls |
| `--lz-v2-radius-md` | `12px` | Buttons and cards |
| `--lz-v2-radius-lg` | `16px` | Large cards |
| `--lz-v2-radius-xl` | `24px` | Prominent containers |
| `--lz-v2-radius-2xl` | `32px` | Hero/profile containers |
| `--lz-v2-radius-full` | `9999px` | Chips and circular controls |

Nested components SHOULD use a smaller radius than their containing surface.

## Borders and surfaces

- Default controls use a 1px `--lz-v2-color-border` border.
- Selected controls use a 1px action border. Do not change border width on selection because that causes layout shift.
- Invalid controls use `--lz-v2-color-danger` for border and supporting message.
- Surfaces communicate depth through tonal layers. General-purpose drop shadows MUST NOT be used.
- Selected or primary elements MAY use `--lz-v2-shadow-action-glow`. Informational emphasis MAY use `--lz-v2-shadow-info-glow`.
- Dividers use a 1px border color and MUST not be the only way to group related content.

## Interaction states

Every interactive primitive MUST define default, hover, pressed, keyboard-focus, selected where applicable, disabled, and busy states.

- Hover is an enhancement and MUST NOT carry information unavailable on touch.
- Pressed controls MAY scale to `0.98`; layout dimensions MUST remain stable.
- Keyboard focus MUST use the shared 3px focus outline with a 3px offset.
- Disabled controls MUST expose native `disabled` semantics where supported and MUST not fire actions.
- Busy controls MUST set `aria-busy="true"`, remain disabled, and expose a useful loading label.
- Selected controls MUST expose `aria-pressed` or `aria-checked`, matching their interaction model.

## Component contracts

### Button

- Minimum height is 48px; large CTA height is 56px.
- Primary uses action fill and on-action content.
- Secondary uses an interactive surface and visible border.
- Ghost has no persistent fill but retains a minimum 44px target.
- Icon-only buttons require an accessible label supplied by the consumer.

### Field

- A visible label is required unless the consumer supplies an equally clear accessible name.
- Hint and error text MUST be connected with `aria-describedby`.
- Invalid controls MUST set `aria-invalid="true"`.
- Text controls use the standard surface, 1px border, 12px radius, and a minimum 48px height.
- Placeholder text MUST not replace a label.

### Selectable card

- Minimum height is 88px.
- Cards use a native button and expose either `aria-pressed` or `role="radio"` plus `aria-checked`.
- Selected cards use the action border and subtle action glow.
- A selected state MUST include more than color, such as the exposed state attribute and optional indicator.

### Chip

- Minimum interactive height is 44px.
- Interactive chips use a native button and expose `aria-pressed`.
- Chips MUST wrap rather than force horizontal page overflow.

### Segmented control

- Use for two or more short, mutually exclusive choices that benefit from compact comparison.
- The group MUST expose `role="radiogroup"`; each native button exposes `role="radio"` and `aria-checked`.
- Every option retains a minimum 44px target, and labels MUST remain readable without horizontal page overflow.
- Do not use when option descriptions are required to understand the choice; use selectable cards instead.

### Stepper

- Increment/decrement controls are circular 64px targets in prominent numeric controls.
- Each control requires a value-specific accessible label supplied by the consumer.
- The value uses an `aria-live="polite"` region.
- A boundary control MUST be disabled, not silently ignored.

### Progress indicator

- Use native progressbar semantics with current, minimum, and maximum values.
- The track is 4px high. Fill uses the cyan-to-lime gradient.
- Progress MUST have a programmatic label. It MUST NOT be communicated by color alone.
- Width changes use the standard progress duration unless reduced motion is requested.

### Disclosure

- The trigger is a native button with `aria-expanded` and `aria-controls`.
- The content region is labelled by the trigger and removed from interaction while collapsed.
- The disclosure MUST support both controlled and uncontrolled state.

## Mobile page layout

- `MobilePage` owns the scoped page canvas and a centered content column.
- Default mobile horizontal gutter is 20px. Desktop gutter is 48px.
- Content width defaults to 640px and MUST remain fluid below that width.
- Major sections use 40px vertical separation; related elements use 16–24px.
- The page minimum height is `100dvh`, with `100vh` as fallback.
- Pages with sticky actions MUST reserve bottom content space so controls are never obscured.

## Sticky bottom actions and safe areas

- `StickyBottomActions` anchors actions to the viewport bottom and constrains their inner width to the page content width.
- Bottom padding is `max(24px, env(safe-area-inset-bottom))` plus the component's internal padding.
- A background gradient MUST protect CTA contrast while content scrolls beneath it.
- Sticky actions MUST remain usable at 200% zoom and MUST allow actions to wrap vertically.
- Top-level page shells expose safe-area tokens for consumers with fixed headers.

## Accessibility and focus

- Text and meaningful graphics MUST meet WCAG 2.2 AA contrast.
- Interactive targets MUST be at least 44 by 44 CSS pixels unless adjacent layout supplies equivalent spacing.
- Native elements are preferred over recreated roles.
- Keyboard order MUST match visual and reading order.
- Focus MUST remain visible over all Design V2 surfaces.
- Error text MUST identify the affected field and remain available to assistive technology.
- Icons that do not add meaning MUST be `aria-hidden="true"`.
- Content MUST reflow without horizontal scrolling at 320 CSS pixels and at 200% zoom, except intrinsically two-dimensional content.

## Motion and reduced motion

| Token | Value | Use |
| --- | --- | --- |
| `--lz-v2-motion-fast` | `160ms` | Color, border, press feedback |
| `--lz-v2-motion-standard` | `240ms` | Disclosure and surface transitions |
| `--lz-v2-motion-progress` | `500ms` | Progress fill |
| `--lz-v2-ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | Standard transition |

- Motion MUST reinforce state changes and MUST NOT be required to understand them.
- Under `prefers-reduced-motion: reduce`, transitions and animations within `.lz-v2` MUST become effectively immediate and smooth scrolling MUST be disabled.
- Loading indicators MAY rotate under normal motion. Under reduced motion they MUST remain visible without rotation.
- No autoplaying decorative motion is permitted in forms.

## Tailwind namespace

Namespaced Tailwind utilities are available for composition, including `bg-lz-v2-bg`, `text-lz-v2-text`, `text-lz-v2-action`, `font-lz-v2-display`, `font-lz-v2-body`, `rounded-lz-v2-md`, and `shadow-lz-v2-action-glow`. They resolve to scoped variables and therefore only have valid Design V2 values beneath `.lz-v2`.
