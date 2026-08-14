# Database contract tests

These pgTAP tests are written before the migrations they specify.

Run with:

```bash
supabase test db
```

The first suite defines the minimum SwiftPay financial schema surface. A RED result is expected until the corresponding migration is introduced; migrations must make existing tests green without weakening the contracts.
