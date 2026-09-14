-- Screenshots for issues and comments.
--
-- Bugs arrive from #product-critical-bugs with an image attached, and the tracker had no
-- way to carry one, so the evidence stayed in Slack. The browser uploads straight here:
-- the API side is at Vercel's 12-function ceiling, and an image never needs to go through
-- a serverless function to reach storage.
--
-- Public read, because the markdown that references an image is rendered by the same app
-- for the same signed-in team, and a signed URL would expire inside an open issue.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'issue-attachments',
  'issue-attachments',
  true,
  10485760, -- 10MB, matched by the client in src/lib/uploads.ts
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone signed in may add a file; nobody may overwrite or remove one through the client,
-- so a link inside an issue body cannot be swapped out underneath it.
drop policy if exists "issue attachments are readable" on storage.objects;
create policy "issue attachments are readable"
  on storage.objects for select
  using (bucket_id = 'issue-attachments');

drop policy if exists "signed-in users can attach" on storage.objects;
create policy "signed-in users can attach"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'issue-attachments');
