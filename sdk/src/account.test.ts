import { expect, test } from "bun:test";
import { setUpVenue, submitPermit, type SetupProgress } from "./account.ts";
import { createClient } from "./client.ts";
import { registrationMessage, TAKER_API_KEY } from "./protocol/lighter.ts";
import { ASTER_CHAIN_ID, CHAINS, EIP712Domain, ESCROW, schemas, UNLIMITED_ALLOWANCE } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import type { TypedDataRequest } from "./signer.ts";

const owner = `0x${"11".repeat(20)}` as const;

test("a permit the relay refuses at once stops there, before any margin moves for it", async () => {
  const chain = required(CHAINS.polymarket);
  const typed = {
    types: { EIP712Domain, ...schemas.Permit }, primaryType: "Permit",
    domain: { name: required(chain.permit), version: required(chain.version), chainId: chain.id, verifyingContract: chain.token },
    message: { owner, spender: ESCROW, value: UNLIMITED_ALLOWANCE.toString(), nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 300) },
  };
  const step = { step: "permit", status: "required", reason: null, to_sign: { kind: "permit", signer: owner, ref: "permit-1", typed_data: typed } };
  const submitted: unknown[] = [];
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = await new Request(input, init).json().catch(() => ({}));
    if (typeof body === "object" && body !== null && "signature" in body) submitted.push(body);
    // Prepared, then submitted: the relay failed, and the step is required again.
    return Response.json(step);
  }, { preconnect: globalThis.fetch.preconnect });
  const signer = { address: owner, signMessage: async () => "0x00" as const, signTypedData: async () => "0x00" as const };
  await expect(submitPermit(createClient({ apiUrl: "http://localhost:8080", fetch }), "polymarket", signer)).rejects.toThrow("Payment authorization failed");
  expect(submitted).toHaveLength(1);
});

const agent = `0x${"22".repeat(20)}`;
type Step = { step: string; status: string; reason: string | null; expires_at: string | null; needed_for: string[]; to_sign: unknown; hash: string | null };
const status = (step: string, patch: Partial<Step> = {}): Step => ({ step, status: "required", reason: null, expires_at: null, needed_for: ["pay"], to_sign: null, hash: null, ...patch });

function approval() {
  const nonce = String(BigInt(Date.now()) * 1000n + 11n);
  const message = `user=${owner}&nonce=${nonce}&agentName=LaMarge&agentAddress=${agent}&expired=${BigInt(nonce) / 1000n + 365n * 86_400_000n}&signatureChainId=${ASTER_CHAIN_ID}&canSpotTrade=false&canPerpTrade=true&canWithdraw=false`;
  return { kind: "aster_approval", signer: owner, ref: nonce, expires_at: new Date(Date.now() + 60_000).toISOString(), typed_data: {
    types: { EIP712Domain, Message: [{ name: "msg", type: "string" }] }, primaryType: "Message",
    domain: { name: "AsterSignTransaction", version: "1", chainId: ASTER_CHAIN_ID, verifyingContract: "0x0000000000000000000000000000000000000000" }, message: { msg: message },
  } };
}

/** One venue's steps as the server answers them, and every request and signature the setup made. */
function fixture(venue: string, steps: Step[], submit: (step: Step, attempt: number) => Step | { status: number; code: string; message: string }, lighterOwner: string = owner) {
  const calls: string[] = [], typed: { chainId: number; msg: unknown }[] = [], messages: string[] = [];
  let attempts = 0;
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/account") return Response.json({ code: 200, accounts: [{ index: Number(url.searchParams.get("value")), l1_address: lighterOwner }] });
    if (url.pathname === "/v1/balances") return Response.json([{ venue, venue_wallet: "42" }]);
    if (request.method === "GET") { calls.push("read"); return Response.json({ venue, address: owner, ready: steps.every(step => step.status === "done"), steps }); }
    const id = required(url.pathname.split("/").at(-1));
    const index = steps.findIndex(step => step.step === id);
    const step = required(steps[index]);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("signature" in body)) {
      calls.push(`prepare ${id}`);
      if (step.status !== "required") return Response.json(step);
      const to_sign = id === "agent" ? approval()
        : { kind: "lighter_api_key", signer: owner, ref: "3", message: registrationMessage({ account: 42, apiKey: TAKER_API_KEY, publicKey: new Uint8Array(40).fill(171), nonce: 3 }) };
      return Response.json({ ...step, to_sign });
    }
    calls.push(`submit ${id}`);
    const answer = submit(step, ++attempts);
    if ("code" in answer) return Response.json({ error: { code: answer.code, message: answer.message } }, { status: answer.status });
    steps[index] = answer;
    return Response.json(answer);
  }, { preconnect: globalThis.fetch.preconnect });
  const signer = {
    address: owner,
    signMessage: async ({ message }: { message: string }) => { messages.push(message); return `0x${"cd".repeat(64)}1b` as const; },
    signTypedData: async (request: TypedDataRequest) => { typed.push({ chainId: request.domain.chainId, msg: request.message.msg }); return `0x${"ab".repeat(64)}1b` as const; },
  };
  const progress: SetupProgress[] = [];
  // A wait lets the venue show the step it was awaiting.
  const sleep = async () => { const pending = steps.findIndex(step => step.status === "pending"); if (pending >= 0) steps[pending] = { ...required(steps[pending]), status: "done" }; };
  const run = () => setUpVenue(createClient({ apiUrl: "http://localhost:8080", fetch }), venue, signer, { onProgress: value => progress.push(value), sleep });
  return { calls, typed, messages, progress, run };
}

test("Aster approves its checked agent with one signature at BSC's chain id, with no transaction", async () => {
  const flow = fixture("aster", [status("agent")], step => ({ ...step, status: "done", expires_at: "2027-10-16T00:00:00Z" }));
  expect((await flow.run()).ready).toBe(true);
  expect(flow.calls).toEqual(["read", "prepare agent", "submit agent", "read"]);
  expect(flow.typed.map(({ chainId }) => chainId)).toEqual([ASTER_CHAIN_ID]);
  expect(String(flow.typed[0]?.msg)).toContain("canPerpTrade=true&canWithdraw=false");
  expect(flow.progress).toEqual([{ step: "agent" }]);
});

test("an approval Aster did not answer is sent again unchanged; a stale one is prepared once more", async () => {
  const unanswered = fixture("aster", [status("agent")], (step, attempt) => attempt < 3 ? { status: 502, code: "VENUE_UNAVAILABLE", message: "no answer" } : { ...step, status: "done" });
  await unanswered.run();
  expect(unanswered.calls.filter(call => call.startsWith("prepare"))).toHaveLength(1);
  expect(unanswered.calls.filter(call => call.startsWith("submit"))).toHaveLength(3);
  expect(unanswered.typed).toHaveLength(1);

  const stale = fixture("aster", [status("agent")], (step, attempt) => attempt === 1 ? { status: 502, code: "VENUE_REJECTED", message: "Aster refused the approval: nonce expired" } : { ...step, status: "done" });
  await stale.run();
  expect(stale.calls.filter(call => call.startsWith("prepare"))).toHaveLength(2);
  expect(stale.typed).toHaveLength(2);
});

test("a step already submitted is awaited, never signed again", async () => {
  const flow = fixture("lighter", [status("api_key", { status: "pending", hash: "0xabc" })], () => ({ status: 500, code: "UNKNOWN", message: "not submitted" }));
  await flow.run();
  expect(flow.calls).toEqual(["read", "prepare api_key", "read", "read"]);
  expect(flow.messages).toEqual([]);
  expect(flow.progress).toEqual([{ step: "api_key" }, { step: "api_key", confirming: true, hash: "0xabc" }]);
});

test("Lighter's key is registered by the owner's signature of Lighter's own message, then awaited", async () => {
  const flow = fixture("lighter", [status("api_key", { reason: "LaMarge's key was replaced on Lighter" })], step => ({ ...step, status: "pending", reason: null }));
  expect((await flow.run()).ready).toBe(true);
  expect(flow.messages).toHaveLength(1);
  expect(flow.messages[0]?.startsWith("Register Lighter Account")).toBe(true);
});

test("a Lighter account that Lighter says is someone else's gets no key registration", async () => {
  const flow = fixture("lighter", [status("api_key")], step => ({ ...step, status: "done" }), `0x${"99".repeat(20)}`);
  await expect(flow.run()).rejects.toThrow("another account than yours");
  expect(flow.messages).toEqual([]);
});

test("a step refused again after its submission stops the setup with its reason", async () => {
  const flow = fixture("lighter", [status("api_key")], step => ({ ...step, status: "required", reason: "LaMarge's key was replaced on Lighter" }));
  await expect(flow.run()).rejects.toThrow("lighter setup failed");
  expect(flow.messages).toHaveLength(1);
});
