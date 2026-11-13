/**
 * Clerk issues the sign-in tokens Convex checks. CLERK_JWT_ISSUER_DOMAIN is the
 * issuer URL from the Clerk dashboard (the Convex integration page). Set it on
 * the deployment before pushing, or the push fails.
 *
 * The applicationID must match the `aud` claim of the JWT template named
 * "convex" that the Clerk app provides.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
