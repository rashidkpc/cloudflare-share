import { text } from "../lib/http";
import { deletePost, getPost, type PostRow } from "../lib/posts";

/**
 * Load a share owned by the Access identity, or the response to send back.
 *
 * Ownership is the only edit authorisation: there is no edit cookie and no
 * password. `email` comes from `accessIdentity()`, so it is already lowercased.
 */
export async function requireOwnedPost(
  env: Env,
  postId: string,
  email: string | null,
): Promise<PostRow | Response> {
  const post = await getPost(env.DB, postId);
  if (!post) return text("Not found", 404);

  if (post.expires_at <= Date.now()) {
    await deletePost(env, post.id);
    return text("Gone — this share has expired", 410);
  }

  if (!email || post.owner_email.toLowerCase() !== email) {
    return text("This account does not own this share", 403);
  }

  return post;
}
