# Update LSRW Bucket for Video Support

## Problem
The `lsrw` storage bucket in Supabase doesn't allow `video/mp4` MIME type, causing upload failures with error:
```
mime type video/mp4 is not supported
```

## Solution

### Option 1: Update via Supabase Dashboard (Recommended)

1. Go to your **Supabase Dashboard**
2. Navigate to **Storage** → **Buckets**
3. Click on the **`lsrw`** bucket
4. Click **Edit bucket** or **Settings**
5. In the **Allowed MIME types** field, add the following video MIME types:
   - `video/mp4`
   - `video/mpeg`
   - `video/quicktime` (for .mov files)
   - `video/x-msvideo` (for .avi files)
   - `video/webm`
   - `video/ogg`

6. Also ensure these audio MIME types are included:
   - `audio/mpeg`
   - `audio/mp3`
   - `audio/wav`
   - `audio/webm`
   - `audio/ogg`
   - `audio/m4a`

7. **Save** the changes

### Option 2: Remove MIME Type Restrictions (Less Secure)

If you want to allow all file types:
1. Go to **Storage** → **Buckets** → **lsrw**
2. **Clear** the "Allowed MIME types" field (leave it empty)
3. **Save** the changes

⚠️ **Note**: This allows any file type, which is less secure but more flexible.

### Option 3: Use Supabase Management API

If you have access to the Supabase Management API, you can update the bucket programmatically. However, the JavaScript Storage API doesn't support updating bucket configuration directly.

## Verification

After updating the bucket configuration:
1. Try uploading a video file through the Listening upload form
2. The upload should succeed without the MIME type error
3. Check the Supabase Storage to confirm the video file was uploaded

## Related Files

- Backend Controller: `Academic_Service_backend-main/controllers/lsrwController.js`
- Upload Middleware: `Academic_Service_backend-main/middleware/lsrwUpload.js`
- Update Script: `Academic_Service_backend-main/scripts/updateLSRWBucketForVideo.js`




