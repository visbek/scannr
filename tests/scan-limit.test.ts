import test from "node:test";
import assert from "node:assert/strict";
import { scanLimitResponse } from "../lib/scan-limit";

test("durable quota permits, denies with retry timing, and fails closed", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  const headers = new Headers({ "x-forwarded-for": "192.0.2.1" });
  const allow = async (subject: string, action: string) => {
    assert.match(subject, /^[a-f0-9]{64}$/);
    assert.equal(action, "run");
    return [{ allowed: true, retry_after: 0 }];
  };
  assert.equal(await scanLimitResponse(headers, "run", allow), null);
  const denied = await scanLimitResponse(headers, "run", async () => [{ allowed: false, retry_after: 42 }]);
  assert.equal(denied?.status, 429);
  assert.equal(denied?.headers.get("Retry-After"), "42");
  for (const consume of [async () => { throw new Error("offline"); }, async () => null, async () => []]) {
    assert.equal((await scanLimitResponse(headers, "run", consume))?.status, 503);
  }
  assert.equal((await scanLimitResponse(new Headers(), "run", allow))?.status, 503);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await scanLimitResponse(headers, "run", allow))?.status, 503);
});
