---
name: Kinetic Glass Terminal
colors:
  surface: '#0e1416'
  surface-dim: '#0e1416'
  surface-bright: '#343a3c'
  surface-container-lowest: '#090f11'
  surface-container-low: '#161d1e'
  surface-container: '#1a2122'
  surface-container-high: '#252b2c'
  surface-container-highest: '#2f3637'
  on-surface: '#dde3e5'
  on-surface-variant: '#bbc9cc'
  inverse-surface: '#dde3e5'
  inverse-on-surface: '#2b3133'
  outline: '#869396'
  outline-variant: '#3c494c'
  surface-tint: '#44d8f1'
  primary: '#44d8f1'
  on-primary: '#00363e'
  primary-container: '#00bcd4'
  on-primary-container: '#004650'
  inverse-primary: '#006876'
  secondary: '#7dffa2'
  on-secondary: '#003918'
  secondary-container: '#05e777'
  on-secondary-container: '#00622e'
  tertiary: '#ffb87b'
  on-tertiary: '#4c2700'
  tertiary-container: '#f19640'
  on-tertiary-container: '#633400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a1efff'
  primary-fixed-dim: '#44d8f1'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e59'
  secondary-fixed: '#62ff96'
  secondary-fixed-dim: '#00e475'
  on-secondary-fixed: '#00210b'
  on-secondary-fixed-variant: '#005226'
  tertiary-fixed: '#ffdcc2'
  tertiary-fixed-dim: '#ffb77b'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#6d3a00'
  background: '#0e1416'
  on-background: '#dde3e5'
  surface-variant: '#2f3637'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.2'
  data-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
  data-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.2'
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 24px
  container-max: 1440px
---

## Brand & Style

The design system is a high-performance, premium trading environment that blends the data density of a classic Bloomberg Terminal with the modern depth of Glassmorphism. It is built for professional traders who require institutional-grade precision without the visual fatigue of legacy software.

The style is **Modern Glassmorphic**. It utilizes a sophisticated layering system where semi-transparent surfaces sit atop a deep navy void. The UI feels ethereal yet grounded, using tactical glow effects and subtle grid textures to imply a digital "workbench." The emotional response is one of calm focus, high-stakes clarity, and technological edge. High-contrast indicators for market movements (bullish/bearish) are balanced by the soft, diffused nature of the containers.

## Colors

The palette is anchored by a deep navy foundation (`#0a0e1a`), providing maximum contrast for vibrant semantic indicators. 

- **Primary Action (Cyan):** Used for navigation, active states, and focus.
- **Bullish (Green):** High-saturation green for positive breakouts and uptrends.
- **Bearish (Red):** High-saturation red for breakdowns and downtrends.
- **Surface Geometry:** Rather than solid fills, surfaces use a 4% white opacity with a 12px backdrop blur to create the "glass" effect.
- **Texture:** A subtle 16px dot-grid pattern in `rgba(255, 255, 255, 0.02)` should be applied to the base background to provide a sense of scale and precision.

## Typography

This system employs a dual-font strategy. **Inter** handles all UI chrome, navigation, and descriptive text, ensuring high legibility and a contemporary feel. **JetBrains Mono** is reserved strictly for quantitative data—prices, percentages, and tickers. The monospaced nature of JetBrains Mono prevents "jumping" numbers during real-time updates and reinforces the terminal's technical utility.

Large display sizes are kept tight with negative letter spacing, while small labels use uppercase with tracking to ensure clarity at small scales.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model. The main dashboard uses a 12-column grid that snaps to a 1440px maximum width, centering on ultra-wide monitors to maintain ergonomic eye lines. 

- **Gutter Strategy:** A consistent 16px gutter is used between glass cards to allow the background blur and dot-grid to "breathe" between modules.
- **Density:** The system allows for high-density information layouts. Padding inside glass cards should be 16px or 20px, while data tables should use a compressed 8px vertical cell padding.
- **Adaptation:** On mobile, the 12-column grid collapses to a single column, and the glass cards lose their external glow to save on rendering performance, retaining only the internal blur.

## Elevation & Depth

Depth is conveyed through **refraction and luminance** rather than traditional black shadows. 

1.  **Level 0 (Base):** Deep navy `#0a0e1a` with a subtle dot-grid texture.
2.  **Level 1 (Cards):** Glass surface (4% white) with 12px blur and 1px border.
3.  **Level 2 (Modals/Popovers):** Glass surface (8% white) with 24px blur and a subtle outer glow using the primary cyan color at 10% opacity.
4.  **Active Indicators:** Elements like the market status use a soft pulse animation (0.5 to 1.0 scale) with a 10px spread glow in the semantic color (Green for Open, Red for Closed).

## Shapes

The shape language is "Softly Technical." We avoid sharp corners to keep the glass aesthetic from feeling aggressive, but we stop short of fully rounded pill shapes to maintain a professional "terminal" feel.

- **Cards:** 12px corner radius creates a distinct, modern container.
- **Buttons/Inputs:** 8px and 6px radii provide a tighter, more precise appearance for interactive elements.
- **Charts:** Use a 2px stroke width for line charts with "smooth" interpolation (Catmull-Rom) to contrast against the rigid grid.

## Components

### Buttons
Primary buttons use a solid Cyan fill with dark text. Secondary buttons are "Ghost Glass"—the same 4% white fill as cards, but with a 1px border that brightens to 20% white on hover.

### Progress & Score Bars
Breakout scores are visualized as horizontal bars. They use a 4px height with a fully rounded track. The fill is a gradient (Green, Amber, or Red) and features a subtle "inner glow" to appear as if the bar is illuminated from within.

### Data Tables
Tables are the heart of the terminal. Rows should have a 1px bottom border of `rgba(255,255,255,0.04)`. Hovering over a row should increase the background opacity to 8% and trigger a 1px Cyan left-edge highlight.

### Input Fields
Inputs are dark with a 1px `rgba(255,255,255,0.1)` border. On focus, the border glows Cyan and the backdrop blur increases slightly to 16px to "lift" the input toward the user.

### Market Status Pulse
A small 8px circle. When the market is "Live," it pulses with `#00e676`. The pulse consists of two expanding concentric rings that fade out, suggesting real-time connectivity.