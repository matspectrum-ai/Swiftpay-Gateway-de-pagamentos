# SwiftPay — Brand System v0

Status: Design baseline for exploration; not a final immutable brand lock

## Brand objective

SwiftPay should be recognizable as a modern revenue/payments technology product rather than another generic banking dashboard.

The brand must communicate:

- speed;
- precision;
- confidence;
- technological competence;
- financial clarity;
- modern digital-selling culture.

It must avoid looking:

- like a traditional bank;
- like a crypto casino;
- overly corporate;
- excessively neon;
- childish;
- visually interchangeable with generic blue/purple fintechs.

## Brand idea

Working conceptual line:

> **Fast money. Clear revenue.**

This is a positioning aid, not an approved final slogan.

The stronger product identity is:

> SwiftPay helps digital sellers sell, understand conversion and move money with less friction.

## Visual personality

- dark, precise base;
- generous whitespace/negative space;
- high-contrast typography;
- restrained use of a distinctive electric accent;
- data visualization treated as a first-class brand surface;
- minimal decorative effects;
- strong numerical hierarchy.

## Candidate core palette

### Swift Ink

`#0B0D0F`

Primary dark canvas and high-authority surface.

### Swift Lime

`#C6FF3D`

Primary brand accent. Use for brand recognition, selected actions, highlights and signature moments.

Swift Lime is **not** the semantic success color. A payment-approved state must remain semantically distinct from the brand accent.

### Cloud

`#F7F8F5`

Primary light canvas / inverse surface.

### Graphite

`#202327`

Elevated dark surfaces, cards and secondary backgrounds.

### Muted

`#8D9399`

Secondary text/metadata baseline. Contrast must be verified before implementation.

## Semantic palette

Semantic tokens are independent from brand tokens.

Candidate baseline:

- Success: `#22C55E`
- Warning: `#F59E0B`
- Danger: `#EF4444`
- Information: `#3B82F6`

Exact production values require accessibility/contrast validation.

## Color usage rules

1. Do not flood screens with Swift Lime.
2. Use the accent to create recognition and hierarchy, not decoration everywhere.
3. Do not encode financial status using brand color alone.
4. Charts should favor clarity and comparability over rainbow palettes.
5. Merchant checkout branding may replace SwiftPay brand color on the merchant-facing payment surface.

## Typography direction

The interface needs a neutral, highly legible modern sans with strong numeric rendering.

Candidate families to evaluate:

- Geist;
- Inter;
- another appropriately licensed modern grotesk/geometric sans if the final identity requires more distinction.

Requirements:

- tabular numerals available for financial tables;
- excellent BRL currency readability;
- strong small-text rendering;
- broad UI weight range;
- mobile readability;
- no dependence on proprietary font files unavailable to deploy targets.

## Numerical hierarchy

Money and conversion numbers are core visual assets.

Examples:

```text
R$ 184.920,42
```

and

```text
74,8%
```

should receive stronger visual hierarchy than card labels or decorative headings.

Use tabular numerals where alignment matters.

## Logo direction

Avoid literal fintech clichés:

- dollar signs;
- coins;
- cards;
- generic lightning bolts;
- obvious bank buildings;
- literal Pix diamonds used as the SwiftPay identity.

Explore an abstract mark capable of suggesting some combination of:

- movement;
- flow;
- speed;
- conversion;
- upward momentum;
- the geometry of an `S` without requiring a literal lettermark.

The mark must remain recognizable at favicon/app-icon size and work in monochrome.

No final logo shape is approved by this document.

## Dashboard visual language

The SwiftPay application should not be a wall of cards.

Default page composition should favor:

- one clear primary metric/question;
- editorial spacing;
- strong number typography;
- one dominant chart/funnel when appropriate;
- small number of actionable insights;
- drill-down rather than permanent information overload.

Example hierarchy:

```text
R$ 284.320
Revenue

[primary trend visualization]

+24% vs previous comparable period
```

followed by conversion and operational context.

## Data visualization principles

Charts are part of the product identity because revenue/conversion intelligence is a primary product capability.

Rules:

1. Every chart answers a specific business question.
2. Always define time range and metric denominator.
3. Use direct labels where possible.
4. Avoid 3D, ornamental gradients and unnecessary animation.
5. Tooltips must expose exact values.
6. Comparison views must maintain consistent scales when comparison would otherwise be misleading.
7. Conversion funnels must distinguish visitors, Pix creation and approved payment clearly.
8. Estimated recoverable revenue must be visually labeled as an estimate.

## Merchant checkout branding

The checkout is primarily the seller's brand, not SwiftPay's.

Merchant customization baseline:

- logo;
- primary color;
- light/dark/automatic mode where appropriate;
- checkout title/description;
- custom domain in an approved plan/configuration.

SwiftPay attribution should be discreet, e.g. a small "Powered by SwiftPay" treatment where commercially/product-wise appropriate.

The first checkout implementation should **not** become a generic page builder. Keep customization constrained and high quality.

## Motion direction

Motion should communicate state and continuity, not spectacle.

Appropriate uses:

- payment pending -> approved transition;
- chart/funnel state changes;
- panel expansion;
- successful copy action;
- automation execution progress.

Avoid motion that delays access to financial information.

## Iconography

Use one coherent icon family with simple geometry and consistent stroke/fill treatment.

Do not mix multiple icon systems casually.

Icons support labels; they should not force users to guess the meaning of primary financial actions.

## Voice and microcopy

SwiftPay language is concise, direct and seller-oriented.

Prefer:

- `R$ 8.720 in Pix expired without payment.`
- `Recover sales`
- `Available now`
- `Payment approved`

Avoid vague growth-hacking copy or infrastructure jargon.

For uncertain financial states, be explicit:

- `Confirmation pending`
- `Provider result unknown — funds remain blocked`

Never rewrite unknown state as success/failure for cosmetic simplicity.

## Brand architecture

### SwiftPay application

Uses the full SwiftPay visual identity.

### Merchant checkout/payment link

Uses merchant identity first, with SwiftPay infrastructure attribution second.

### Developer documentation

Uses SwiftPay brand system but prioritizes technical readability, code examples and contract clarity.

### Transactional communication

Should clearly identify both merchant context and SwiftPay's role when needed for trust/security.

## Design-token direction

Implementation should expose semantic tokens rather than scatter hex values through components.

Conceptual hierarchy:

```text
brand.accent
surface.canvas
surface.elevated
text.primary
text.secondary
border.default
status.success
status.warning
status.danger
status.info
chart.primary
chart.secondary
```

The final token schema will be defined with the UI framework choice.

## Validation before brand lock

Before promoting this from v0 to an approved Brand System v1:

1. produce representative Home/Dashboard concept;
2. produce Checkout concept;
3. produce Payment Link concept;
4. test palette in light and dark contexts;
5. test WCAG contrast for text/actions;
6. validate financial charts with realistic dense data;
7. test mobile-first checkout;
8. select/validate logo direction;
9. verify typography licensing/deployment;
10. ensure the identity does not resemble a specific competitor too closely.