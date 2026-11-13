/**
 * Test-only helpers for signed-in fixtures. Account ownership is keyed by the
 * token identifier (issuer plus subject), so a fixture that owns a character
 * must use the same issuer as the identity it acts as.
 */
export const TEST_ISSUER = "https://clerk.test.example";

export function testIdentity(subject: string) {
  return { subject, issuer: TEST_ISSUER };
}

export function ownerFor(subject: string): string {
  return `${TEST_ISSUER}|${subject}`;
}
