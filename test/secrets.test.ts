// The capture-time secret scan (FR-035, research.md §6).
//
// Every secret-shaped fixture is assembled at run time from pieces, so no complete credential
// shape appears in this file — a public repository's push protection should never see one.

import { describe, expect, test } from "bun:test";
import { scanSecrets, SECRET_PATTERNS } from "../src/knowledge/secrets";

const j = (...parts: string[]) => parts.join("");
const scan = (text: string) => scanSecrets([["body", text]]).map((m) => m.pattern);

const SHAPES: Record<string, string> = {
  "private-key": j("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
  "aws-access-key-id": j("AKIA", "IOSFODNN7", "EXAMPLE"),
  "github-token": j("gh", "p_", "a1B2c3D4".repeat(5)),
  "slack-token": j("xo", "xb-", "1234567890-abcdefghij"),
  "bearer-token": j("Authorization: Bearer ", "eyJhbGciOiJI", "UzI1NiJ9abcdef"),
  "api-key-assignment": j("STRIPE_API", "_KEY=", "sk_live_", "4eC39HqLyjWDarjtT1zdp7dc"),
};

describe("secret patterns", () => {
  test("every published pattern has a fixture, and each fixture is caught by its pattern", () => {
    expect(Object.keys(SHAPES).sort()).toEqual(SECRET_PATTERNS.map((p) => p.id).sort());
    for (const [id, shape] of Object.entries(SHAPES)) expect(scan(`before ${shape} after`)).toContain(id);
  });

  test("placeholders, environment references and variable names are not secrets", () => {
    for (const text of [
      "api_key: <your-key-here-please>",
      "token = process.env.GITHUB_TOKEN_FOR_CI",
      "password: ${DATABASE_PASSWORD_VALUE}",
      "secret: $SESSION_SIGNING_SECRET",
      "API_KEY=GITHUB_TOKEN_FROM_ENVIRONMENT",
      "access_key: xxxxxxxxxxxxxxxxxxxxxxxx",
      "the session token is rotated every hour",
      "Authorization: Bearer <token>",
    ])
      expect(scan(text)).toEqual([]);
  });

  test("a placeholder earlier in a text does not hide a real secret later", () => {
    const real = j("sk_live_", "4eC39HqLyjWDarjtT1zdp7dc");
    expect(scan(`api_key: \${API_KEY_FROM_ENV} then api_key: ${real}`)).toEqual(["api-key-assignment"]);
  });

  test("a match reports field and pattern, and never echoes the secret in full", () => {
    const shape = SHAPES["aws-access-key-id"]!;
    const [m] = scanSecrets([["rejected[1]", `use ${shape}`]]);
    expect(m!.field).toBe("rejected[1]");
    expect(m!.preview).not.toContain(shape);
    expect(m!.preview.length).toBeLessThan(10);
  });
});
