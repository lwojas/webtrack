---
name: Obsidian Signal
colors:
  surface: '#111318'
  surface-dim: '#111318'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#1e2024'
  surface-container-high: '#282a2e'
  surface-container-highest: '#333539'
  on-surface: '#e2e2e8'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#ffc384'
  on-secondary: '#482900'
  secondary-container: '#fe9d00'
  on-secondary-container: '#663c00'
  tertiary: '#dbffde'
  on-tertiary: '#003918'
  tertiary-container: '#34f885'
  on-tertiary-container: '#006e35'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#ffdcbb'
  secondary-fixed-dim: '#ffb869'
  on-secondary-fixed: '#2c1700'
  on-secondary-fixed-variant: '#673d00'
  tertiary-fixed: '#62ff96'
  tertiary-fixed-dim: '#00e475'
  on-tertiary-fixed: '#00210b'
  on-tertiary-fixed-variant: '#005226'
  background: '#111318'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
typography:
  headline-lg:
    fontFamily: JetBrains Mono
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: JetBrains Mono
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.375rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: JetBrains Mono
    fontSize: 1rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0em
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0em
  body-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.875rem
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.04em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.75rem
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.5625rem
    fontWeight: '500'
    lineHeight: 0.625rem
    letterSpacing: 0.06em
spacing:
  gutter: 0.25rem
  margin: 0.5rem
  space-xs: 0.125rem
  space-sm: 0.25rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system embodies high-precision audio engineering, technical tracker sequencing, and tactical digital studio control. It merges the ruthless functional clarity of retro tracker software (such as Renoise and FastTracker II) with cutting-edge cyberpunk telemetry consoles.

### Target Audience & Psychological Intent
- **Audience:** Sound designers, electronic music producers, modular synthesists, and live tracker performers who operate under complex, mission-critical constraints.
- **Atmosphere:** Deep focus, surgical control, and zero visual clutter. Every pixel communicates signal state, timeline telemetry, or parameter values.
- **Visual Personality:** Utilitarian, razor-sharp, dense, and phosphorescent.

### Design Movement
- **Precision Brutalism & Tactical Telemetry:** Characterized by strict tabular columns, micro-borders, flat surface stacking, hard-edged containers, and phosphor-reactive signal glow against deep spatial darkness.

## Colors

The palette is engineered for prolonged sessions in low-light environments, prioritizing immediate spectral recognition and high contrast without inducing chromatic eye fatigue.

### Surface Architecture
- **Base Canvas (`#0a0c10`):** Pitch-black slate void for maximum background depth.
- **Surface Elevation 1 (`#101319`):** Track lanes, pattern matrices, and channel strips.
- **Surface Elevation 2 (`#151922`):** Parameter cards, popover inspectors, and active module headers.
- **Surface Elevation 3 (`#1a202c`):** Dropdown surfaces, hover states, and control backdrops.
- **Precision Border (`#1e2430`):** Structural 1px separation lines across all matrix cells and pane dividers.
- **Active Structural Border (`#2d3748`):** Focused pane boundaries and pinned channel envelopes.

### Signal & Phosphor Telemetry
- **Phosphor Cyan (`#00f0ff`):** Primary system focus, active parameter sliders, selected track indicators, pitch readouts, and primary callouts.
- **Retro Amber (`#ff9d00`):** Secondary modulation flags, filter envelopes, pattern loop boundaries, warn thresholds, and automation nodes.
- **Emerald Pulse (`#00e676`):** Audio level meters (nominal signal), playhead sweeps, sync status, active routing gates, and valid clock pulses.
- **Critical Peak Crimson (`#ff3366`):** Audio clipping (>0dB), mute states, destructive events, and MIDI clock desync.
- **Muted Gray-Blue (`#6b7c96`):** Tabular headers, row numbers, inactive step ticks, hexadecimal indices, and unit suffixes (`dB`, `Hz`, `ms`).
- **Dim Inactive Matrix (`#242b38`):** Off-state step sequencer nodes and empty track cells.

## Typography

The typography is built around strict monospaced alignment using `JetBrains Mono`. Monospaced characters ensure zero layout shift during real-time parameter streaming, automated values, and hexadecimal pattern manipulation.

### Execution Standards
- **Tabular Alignment:** All numeric and hexadecimal readouts must align horizontally across channels and vertically along row indices.
- **Letter Spacing:** Tighter negative tracking on headers reduces footprint; micro-labels take positive tracking for legibility at sub-12px sizes.
- **Case Rule:** Technical labels, hexadecimal values, and status metadata (`BPM`, `LPF`, `0x7F`, `TRK-01`) must always render in uppercase.
- **No Smoothing Drift:** Text rendering must leverage subpixel or antialiased pixel-perfect snapping to prevent fuzziness on dense grid displays.

## Layout & Spacing

Space is treated as precious screen real estate. The interface operates on an ultra-dense 4px/2px spatial unit scale rather than conventional web scale.

### Layout Model
- **Modular Docking Grid:** The workspace spans 100% viewport width and height with zero overflow body scroll. Panels use a multi-pane split model (Tracker Pattern Matrix, DSP Effect Chain, Mixer Channels, Sample Waveform).
- **Gutter Rule (`0.25rem` / 4px):** Gaps between distinct tool panels are kept at 4px using 1px structural separators to maximize working canvas.
- **Canvas Margins (`0.5rem` / 8px):** Minimal outer bounds framing status bars and transport docks.
- **Step Height & Column Widths:** Tracker rows maintain a fixed height of `18px` or `20px` to guarantee predictable scrolling during continuous 120+ BPM pattern sweeps.

### Adaptation Strategy
- **Desktop (>= 1440px):** Full simultaneous display of tracker matrix (up to 16 channels), vertical peak meters, envelope editors, and sample instruments.
- **Studio Compact (1024px - 1439px):** Auto-collapse non-active channels into mini-telemetry meters; dock sample waveform into a modal drawer.
- **Field Terminal (< 1024px):** Dedicated single-focus viewports (Matrix vs. Mixer vs. Waveform) selectable via global function keys (`F1`-`F4`).

## Elevation & Depth

This system intentionally rejects ambient blur shadows and soft diffusion in favor of planar architectural stacking and phosphor luminescence.

### Depth Mechanics
- **Zero Drop-Shadows:** Standard drop shadows cause visual mud in high-density tracker matrices. All depth transitions rely on solid surface color shifts (`#0a0c10` -> `#101319` -> `#151922`).
- **Phosphor Bloom:** Focus states and active playheads use sharp, localized luminescence (e.g., `box-shadow: 0 0 4px rgba(0, 240, 255, 0.4)` or single-pixel inset borders) rather than diffuse floating shadows.
- **Inset Tooling:** Knobs, toggle wells, and inactive matrix cells feature 1px inset borders (`#0e1117`) to simulate sunken physical hardware racks.
- **Overlay Panels:** Floating HUD inspectors and context menus use a crisp 1px border (`#2d3748`) backed by an opaque `#101319` fill.

## Shapes

The design system enforces a pure sharp (`0px`) aesthetic across all interactive surfaces, cells, inputs, and modular containers.

### Design Principles
- **Right-Angle Purity:** Crisp 90-degree corners maximize functional content space and allow adjacent cells to share single-pixel dividing boundaries.
- **Chamfer Exception:** Optional 45-degree micro-chamfers (2px to 3px) may be applied strictly to module tab headers and transport status badges to invoke industrial avionics and tactical rack hardware.
- **Zero Border-Radius:** Buttons, sliders, switches, table cells, and menus must never use rounded pills or soft arcs.

## Components

### Buttons & Transport Controls
- **Structure:** Monospaced label, compact padding (`space-xs` vertical, `space-md` horizontal), 1px solid border (`#1e2430`), background `#101319`.
- **States:** Hover reveals background `#1a202c` with text `#00f0ff`. Active/Pressed shifts background to `#00f0ff` with text `#0a0c10`.
- **Transport Toggles:** Play/Stop/Record toggles display an active state with phosphor background fills: `#00e676` for Play, `#ff3366` for Record, and `#ff9d00` for Loop.

### Tracker Step Matrix & Data Cells
- **Structure:** 18px-high tabular rows displaying Note, Instrument Index, Volume, and Effect columns (e.g., `C-4 01 v64 0F01`).
- **Current Step / Playhead:** Spans the entire active row in `#00e676` with 15% opacity background and a solid 1px top/bottom accent line.
- **Cursor Selection:** Distinct `#00f0ff` bounding box with high-contrast inverted cell text.

### Parameter Sliders & Encoders
- **Faders / Value Bars:** Horizontal or vertical tracks framed in `#1e2430` filled with stepped segmented ticks or solid phosphor fills (`#00f0ff` for core audio values, `#ff9d00` for FX wet/dry).
- **Inline Numeric Drag Inputs:** Plain text fields where scrubbing horizontally increments/decrements value with zero latency, styled with a micro bottom border in `#6b7c96`.

### VU & Peak Level Meters
- **Segmentation:** Hard-edged bar segments (1px vertical gap).
- **Zoning:** -inf to -6dB in `#00e676` (Emerald), -6dB to -0.1dB in `#ff9d00` (Amber), >= 0dB in `#ff3366` (Crimson Peak with 1.5s hold indicator).

### Toggles, Switches & Checkboxes
- **Toggle Matrix:** Flush, sharp button segments grouped horizontally. Active segment features a filled background `#00f0ff` with text `#0a0c10`.
- **Checkboxes:** 10px x 10px sharp square, `#101319` interior, 1px `#1e2430` border. Active state renders a solid 6px x 6px `#00f0ff` center square.

### Chips & Metadata Badges
- **Display:** Used for routing nodes (e.g., `OUT 1/2`, `MIDI CH 10`, `44.1kHz`).
- **Styling:** Micro typography (`label-sm`), 1px solid `#1e2430`, text in `#6b7c96`. Hover states highlight border to `#00f0ff`.

### Popover Inspectors & HUD Cards
- **Panels:** Pure `#101319` background, 1px solid `#2d3748` border. Header bars styled with `#151922` background and uppercase `label-md` titles.