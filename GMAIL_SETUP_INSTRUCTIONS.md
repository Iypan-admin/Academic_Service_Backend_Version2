# Gmail Email Setup Instructions

## Error Fix: Gmail Authentication

If you're getting this error:
```
❌ Email sending failed: Error: Invalid login: 535-5.7.8 Username and Password not accepted
```

This means you need to use a **Gmail App Password** instead of your regular Gmail password.

---

## Step-by-Step Setup

### 1. Enable 2-Step Verification
1. Go to: https://myaccount.google.com/security
2. Find "2-Step Verification" section
3. Click "Get started" and follow the steps
4. Complete the setup (you'll need your phone)

### 2. Generate App Password
1. Go to: https://myaccount.google.com/apppasswords
2. If prompted, sign in again
3. Under "Select app", choose **"Mail"**
4. Under "Select device", choose **"Other (Custom name)"**
5. Type: **"ISML Server"** (or any name you want)
6. Click **"Generate"**
7. You'll get a 16-character password like: `abcd efgh ijkl mnop`
8. **Copy this password** (you won't see it again!)

### 3. Update .env File

In `Academic_Service_backend-main/.env` file, add/update:

```env
MAIL_USER=your-email@gmail.com
MAIL_PASSWORD=abcdefghijklmnop
```

**Important:**
- `MAIL_USER` = Your full Gmail address (e.g., `ismlteam@gmail.com`)
- `MAIL_PASSWORD` = The 16-character App Password (remove spaces if any)
- Do NOT use your regular Gmail password
- Do NOT include spaces in the App Password

### 4. Restart Server

After updating `.env`:
```bash
# Stop the server (Ctrl+C)
# Then restart:
node index.js
```

---

## Example .env Configuration

```env
# Gmail Configuration
MAIL_USER=ismlteam@gmail.com
MAIL_PASSWORD=abcdefghijklmnop

# Other environment variables...
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

---

## Troubleshooting

### Still getting authentication error?
1. ✅ Make sure 2-Step Verification is enabled
2. ✅ Make sure you're using App Password (16 characters), not regular password
3. ✅ Check `.env` file is in `Academic_Service_backend-main/` folder
4. ✅ Make sure there are no spaces in `MAIL_PASSWORD`
5. ✅ Restart the server after changing `.env`

### App Password not working?
- Try generating a new App Password
- Make sure you copied all 16 characters
- Check if "Less secure app access" is enabled (older Gmail accounts)

### Need help?
- Gmail App Password guide: https://support.google.com/accounts/answer/185833
- Check server logs for detailed error messages

---

## Security Note

⚠️ **Never commit `.env` file to Git!**
- The `.env` file is already in `.gitignore`
- App Passwords are safer than regular passwords
- Each App Password can be revoked individually

