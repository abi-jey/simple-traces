# Branch Setup Guide

## Created Branches

Four dedicated branches have been created for testing each header version:

### Branch List

1. **`header-v1-gradient-fade`** (based on commit `6e5b567`)
   - Version 1: Gradient fade from header to body
   - Smooth color transition effect

2. **`header-v2-blur-shadow`** (based on commit `1c8918e`)
   - Version 2: Blur/shadow fade effect
   - Creates depth with soft shadow

3. **`header-v3-glassmorphism`** (based on commit `e319f83`)
   - Version 3: Transparent glassmorphism
   - Modern glass-like appearance

4. **`header-v4-minimal-separator`** (based on commit `fc93a68`)
   - Version 4: Minimal design with subtle separator
   - Recommended default version

## Local Branches Created

All four branches have been created locally. To push them to the remote repository, run:

```bash
# Push all version branches at once
git push origin header-v1-gradient-fade header-v2-blur-shadow header-v3-glassmorphism header-v4-minimal-separator

# Or push them individually
git push origin header-v1-gradient-fade
git push origin header-v2-blur-shadow
git push origin header-v3-glassmorphism
git push origin header-v4-minimal-separator
```

## How to Test Each Version

After the branches are pushed to remote, anyone can test them:

```bash
# Checkout any version branch
git checkout header-v1-gradient-fade  # or v2, v3, v4

# Install dependencies and run
npm install
npm run dev

# Open http://localhost:5173 in browser
```

## Branch Details

All branches include:
- ✅ GitHub link with logo on the far right
- ✅ Removed harsh header border
- ✅ Seamless header-to-page transition
- ✅ Light and dark theme support
- ✅ Security best practices

Each branch represents a complete, working version ready for testing or deployment.
