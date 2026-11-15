import { verifyEditToken } from "../lib/edit";
import { text } from "../lib/http";
import { deletePost, getPost, type PostRow } from "../lib/posts";

/**
 * Load a share the caller may edit, or the response to send back.
 *
 * Edit rights come from the per-share cookie set on the uploading browser, or
 * from a Cloudflare Access identity that matches the share owner.
 */
export async function requireEditablePost(
  env: Env,
  request: Request,
  postId: string,
  accessEmail: string | null,
): Promise<PostRow | Response> {
  const post = await getPost(env.DB, postId);
  if (!post) return text("Not found", 404);

  if (post.expires_at <= Date.now()) {
    await deletePost(env, post.id);
    return text("Gone — this share has expired", 410);
  }

  if (accessEmail && post.owner_email === accessEmail) return post;
  if (await verifyEditToken(request, post)) return post;

  return text("This browser does not have edit access to this share", 403);
}
