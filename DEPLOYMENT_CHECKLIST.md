# Pre-Deployment Checklist

## ✅ What's Been Done

- [x] Updated `.gitignore` to exclude sensitive files
- [x] Created Privacy Policy page (`/privacy-policy`)
- [x] Created Terms of Service page (`/terms-of-service`)
- [x] Cleaned up obvious AI-generated comments
- [x] Created Vercel deployment guide

## 📋 Before Deploying

### 1. Update Contact Information

- [ ] Update email in `app/privacy-policy/page.jsx` (line ~74)
- [ ] Update email in `app/terms-of-service/page.jsx` (line ~80)

### 2. Review Code

- [ ] Remove any remaining `// WHY:` comments if desired
- [ ] Remove `TODO:` comments you don't need
- [ ] Check for placeholder text (e.g., "example.com")

### 3. Test Locally

- [ ] Run `npm run build` to ensure build succeeds
- [ ] Test privacy policy page: `http://localhost:3000/privacy-policy`
- [ ] Test terms page: `http://localhost:3000/terms-of-service`
- [ ] Test OAuth flow locally

### 4. Prepare Environment Variables

Have these ready for Vercel:

- [ ] `DATABASE_URL` or database credentials
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_REDIRECT_URI` (will be your Vercel URL)
- [ ] `NEXT_PUBLIC_BASE_URL` (will be your Vercel URL)
- [ ] `GOOGLE_API_KEY` (optional)
- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY` (optional)

### 5. Git Setup

- [ ] Initialize git: `git init` (if not done)
- [ ] Add files: `git add .`
- [ ] Commit: `git commit -m "Ready for deployment"`
- [ ] Create GitHub repository
- [ ] Push to GitHub: `git push origin main`

### 6. Deploy to Vercel

- [ ] Sign up/login to Vercel
- [ ] Import GitHub repository
- [ ] Add all environment variables
- [ ] Deploy
- [ ] Get your Vercel URL

### 7. Update Google Cloud Console

- [ ] Add Vercel URL to OAuth redirect URIs
- [ ] Update OAuth consent screen URLs:
  - Home: `https://your-app.vercel.app/`
  - Privacy: `https://your-app.vercel.app/privacy-policy`
  - Terms: `https://your-app.vercel.app/terms-of-service`
- [ ] Add `vercel.app` to authorized domains

## 🚀 Quick Deploy Commands

```bash
# 1. Build test
npm run build

# 2. Git setup (if needed)
git init
git add .
git commit -m "Initial commit"

# 3. Push to GitHub (replace with your repo)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Then go to [vercel.com](https://vercel.com) and import your repository.

## 📚 Documentation

- **Vercel Deployment:** See `docs/VERCEL_DEPLOYMENT.md`
- **Google OAuth Setup:** See `docs/GOOGLE_AUTHENTICATION_SETUP.md`
- **Privacy Policy Setup:** See `docs/PRIVACY_POLICY_AND_TERMS_SETUP.md`

## ⚠️ Important Notes

1. **Never commit `.env` files** - They're in `.gitignore`
2. **Documentation is excluded** - `/docs` folder is in `.gitignore`
3. **Service account keys excluded** - `*.json` (except package files) in `.gitignore`
4. **HTTPS required** - Vercel provides this automatically

## 🆘 Troubleshooting

**Build fails?**
- Check Vercel build logs
- Test `npm run build` locally first
- Verify all dependencies in `package.json`

**OAuth not working?**
- Verify redirect URI matches exactly
- Check environment variables in Vercel
- Ensure HTTPS is used (not HTTP)

**Database connection fails?**
- Verify `DATABASE_URL` includes SSL
- Check database allows Vercel IPs
- Some databases require IP whitelisting

