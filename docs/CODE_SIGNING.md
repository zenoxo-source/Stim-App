# Windows Code Signing (optional)

Stim App builds work without a certificate. For fewer SmartScreen warnings, sign with a code-signing cert.

## Environment variables (electron-builder)

| Variable | Meaning |
|----------|---------|
| `CSC_LINK` | Path to `.pfx` / `.p12` **or** base64 of the certificate file |
| `CSC_KEY_PASSWORD` | Certificate password |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Set to `false` to skip auto discovery if you want unsigned local builds |

### Local signed build

```powershell
cd backend
$env:CSC_LINK = "C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "••••"
npm run build:app
```

### GitHub Actions

Add repository secrets:

- `CSC_LINK` (base64 of the pfx)
- `CSC_KEY_PASSWORD`

Then in `.github/workflows/release.yml` on the build step:

```yaml
env:
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
```

## Notes

- Use a cert from a trusted CA (e.g. SSL.com, DigiCert, Sectigo) for best SmartScreen reputation.
- EV certificates typically establish reputation faster.
- Never commit `.pfx` / passwords to git.
