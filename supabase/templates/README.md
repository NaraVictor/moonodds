# Email templates

The sign-in code emails. **Both must render `{{ .Token }}` and neither may
contain a link.**

## Why there is no link

Supabase's defaults send `{{ .ConfirmationURL }}`. Following one produces
`PKCE code verifier not found in storage`: the link opens in whichever browser
the mail client hands it to, while the verifier cookie lives in the browser
that made the request. A typed code carries no browser state and works from any
device, which is why it is the only route in.

## Why there are two

Supabase picks the template by whether the account already exists:

| File | Supabase template | Fires when |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | address never seen — **everyone, once** |
| `magic-link.html` | Magic Link | account already exists |

Fixing only Magic Link is the easy mistake. It looks correct when you test with
your own account and sends a link to every genuinely new person.

## Deploying them

`config.toml` points at these files for LOCAL Supabase only. The deployed
project stores its own copies, so after editing either file:

```bash
pnpm templates:push
```

That patches the two content fields and their subjects through the Management
API — not `supabase config push`, which would send the whole config file
including a locally generated SMS hook secret.

Keep the HTML plain. No comments, no `<script>`, no `<style>` blocks: the
Management API sits behind a WAF that rejects payloads resembling injection,
and the failure is an opaque `403 error code: 1010` rather than a validation
message. Inline `style` attributes are fine, and are what email clients want
anyway.
