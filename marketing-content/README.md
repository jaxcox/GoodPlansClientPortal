# Marketing Site Content — Review Draft

Full content set for **thegoodplansco.com**, rebuilt from the ground up after a real interview with Jackie about audience, offer, wedge, voice, and content topics.

This folder is the **review-and-edit surface.** Read through, mark up, push back, rewrite anything that doesn't sound like you. Once you sign off, these files get loaded into the Astro site as page content.

## What's here

```
marketing-content/
├── README.md                   (this file)
├── pages/
│   ├── home.md                 (8 sections)
│   ├── about.md                (your story + principles + credentials)
│   ├── coaching.md             (the offer in detail)
│   ├── contact.md              (simple contact + form spec)
│   └── faq.md                  (full FAQ — superset of the Home FAQ)
├── blog/
│   ├── the-work-harder-trap.md
│   ├── bank-account-as-scoreboard.md
│   ├── goals-too-big-too-far-out.md
│   ├── loans-and-draws-come-from-profit.md
│   └── kpi-diagnostic-series-intro.md
└── kpis/
    ├── gross-margin.md
    ├── operating-margin.md
    ├── cost-of-goods-sold.md
    ├── average-ticket.md
    ├── close-rate.md
    ├── customer-acquisition-cost.md
    ├── lifetime-value.md
    ├── labor-efficiency.md
    ├── labor-utilization.md
    └── revenue-per-employee.md
```

## Positioning foundation

The content in this folder is built around the following positioning. If any of this drifts, content in this folder will need to be updated too.

**Audience.** Small business owners with a team who provide a real product or service. Trades and trade-adjacent in most cases. Go-getters who've hit a ceiling, work harder to compensate, and want growth they can actually see. The site is written to attract these people without industry-specific targeting.

**Offer.** A bi-weekly working relationship. Custom dashboard portal as the centerpiece. Bi-weekly sessions. Budgeting and strategic planning. Profit First as a methodology in the practice (kept in the bio, not as a Home page service).

**Wedge.**
- Real financial fluency (most coaches don't have it)
- 7 years coaching, 200+ businesses (anti-AI-coach experience)
- Facts over hopes (no fluff coaching)
- Socratic — insights and questions, not prescriptions
- The portal (the dashboard most coaches don't offer)
- Rooted in reality

**Voice.** Direct + fun, Mike M-adjacent. Casual but polished. "Wowza" energy where it fits. Socratic diagnostic questions. Reframes when stuck. Warm without coddling. Uses "we" for partnership. No "should" statements. No earth-shattering promises. No AI-generic language.

**Tagline.** Understand your numbers, understand your business.

## How to review

1. **Open each file** in any text editor (TextEdit on Mac shows the formatting; VS Code or any code editor renders Markdown more cleanly).
2. **Read through and mark up:**
   - Lines you want cut: prefix with `// CUT:`
   - Lines you want changed: prefix with `// CHANGE: <what to>`
   - Sections you want rewritten: prefix the whole block with `// REWRITE: <direction>`
   - Anything you'd like added: drop a `// ADD: <idea>` note where you want it
3. **When you're done with a file, save it.** I'll pick up your edits next session.
4. **Or** send specific notes in chat — whichever feels faster.

## What's NOT in this draft (intentional)

- **Pricing** — not disclosed on V1 site. "We'll talk on the discovery call if it makes sense to work together." Easy to add a pricing page later if you change your mind.
- **Testimonials** — you don't have real ones yet with explicit permission. Home page uses a "Before / After" block + the boat client story as substitute proof. Swap when real testimonials come in.
- **Industry pages** (`/industries/hvac`, etc.) — out of V1 scope. Your positioning is industry-agnostic by design. We may add vertical-flavored pages later as SEO surface area, but not at launch.
- **Client names** — all stories are anonymized ("a remodeler I work with"). When you have explicit permission to name names, we'll swap in.

## Voice and style rules applied

- No em dashes anywhere in user-facing copy
- Coach-led tone: you're driving, not asking the client to self-serve
- Positive voice: state what the number signals, not "without X you fail"
- Specific numbers in the open, not vague hand-waving
- No filler: "I'd love to," "Just circling back," "Hope this finds you well" all cut
- No "should" statements (you provide insights and questions; the reader builds answers)
- No generic AI-coach giveaway language
- No earth-shattering promises or guarantees
- Stay in lane: you're not the reader's marketer, accountant, tax pro, or lawyer

If anything reads as off-voice when you scan it, flag it and I'll rewrite.

## Status

| Section | Draft status |
|---|---|
| Home page | ✅ Complete |
| About page | ✅ Complete |
| Coaching page | ✅ Complete |
| Contact page | ✅ Complete |
| FAQ page | ✅ Complete |
| 5 blog posts | ✅ Complete |
| 10 KPI glossary entries | ✅ Complete |

## What's next (after your review)

- You mark up / edit anything that needs to change
- I incorporate your edits
- When content is signed off, we move to **scaffolding the Astro site** and loading the content in
- That part is in OPERATIONS.md → the marketing site deploy section
