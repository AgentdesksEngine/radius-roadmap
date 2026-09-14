import { supabase } from './supabaseClient';

/** Storage bucket created by supabase/migrations/0005_issue_attachments.sql. */
const BUCKET = 'issue-attachments';
const MAX_BYTES = 10 * 1024 * 1024;

export function isImage(file: File | null | undefined): boolean {
  return Boolean(file && file.type.startsWith('image/'));
}

/**
 * Puts an image in front of the issue rather than leaving it in Slack. Uploads go straight
 * from the browser to Supabase Storage — the API side is already at Vercel's function
 * ceiling, and an image never needs to pass through it.
 */
export async function uploadImage(file: File): Promise<string> {
  if (!isImage(file)) throw new Error('That file isn’t an image.');
  if (file.size > MAX_BYTES) {
    throw new Error(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is 10MB.`);
  }
  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext || 'png'}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Markdown for an uploaded image, named after the file it came from. */
export function imageMarkdown(file: File, url: string): string {
  return `![${file.name.replace(/\.[^.]+$/, '') || 'screenshot'}](${url})`;
}
