# Security

Report a vulnerability in Filament Shelf privately through GitHub:

https://github.com/Manaiakalani/filament-shelf/security/advisories/new

Include what you found, how to reproduce it, and what it affects. Do not open a public issue for a security problem. Do not include a live password, a setup key, or a tunnel token.

The maintainer aims to acknowledge a report within 7 days, and to ship a fix or a mitigation once the report is understood. You will hear back on the same advisory when it is fixed, or when it is not a vulnerability.

The sign-in password, the session cookie, an optional setup key, and an optional Cloudflare tunnel are the controls in front of the shelf. `data/` is not encrypted. Keep that folder on a machine that uses disk encryption.

Changing a password in the app signs every other device out and keeps the one you are using. The terminal `passwd` command signs that account out everywhere. A backup in `data/backups/` is the shelf itself, so treat a copied `data/` folder as private.
