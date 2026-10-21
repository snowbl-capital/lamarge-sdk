import { expect, test } from "bun:test";
import { canRefundPayment, checkCloseOffer, checkFundingPlan, checkLinkChallenge, checkPaymentRefund, checkRefundLocks, checkRegistry, checkSetupKind, CHAINS, EIP712Domain, ESCROW, required, schemas, type SignItem } from "./index.ts";

const address = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A", master = "0x14791697260E4c9A71f18484C9f997B308e59325";

test("a link challenge names the venue asked, the address and the master", () => {
  const expires = new Date(Date.now() + 300_000).toISOString();
  const challenge = (venue: string) => ({ nonce: "n1", expires_at: expires, message: [`LaMarge: link a ${venue} account`, "", `Account: ${address}`, `Master account: ${master}`, "Nonce: n1", `Expires: ${expires}`].join("\n") });
  expect(() => checkLinkChallenge(challenge("Polymarket Perps"), address, master, "polymarket")).not.toThrow();
  expect(() => checkLinkChallenge(challenge("Hyperliquid"), address, master, "polymarket")).toThrow("account-link challenge");
  expect(() => checkLinkChallenge(challenge("Polymarket Perps"), address, master, "dydx")).toThrow("account-link challenge");
});

test("a setup step asks the one kind of signature it is signed with", () => {
  for (const [step, kind] of [["permit", "permit"], ["agent", "aster_approval"], ["api_key", "lighter_api_key"]]) expect(() => checkSetupKind(required(step), required(kind))).not.toThrow();
  for (const [step, kind] of [["permit", "aster_approval"], ["agent", "permit"], ["api_key", "permit"], ["other", "permit"]]) expect(() => checkSetupKind(required(step), required(kind))).toThrow("another kind of signature");
});

test("a listed permit domain is the pinned one, and none on a venue settled inside itself", () => {
  const listed = (venue: string) => { const { id, token, decimals, escrow } = required(CHAINS[venue]); return { id, token, decimals, escrow }; };
  const hyper = listed("hyperliquid"), lighter = listed("lighter");
  expect(() => checkRegistry("hyperliquid", { ...hyper, permit: { name: "USDC", version: "2" } })).not.toThrow();
  expect(() => checkRegistry("hyperliquid", hyper)).not.toThrow();
  expect(() => checkRegistry("hyperliquid", { ...hyper, permit: { name: "USDC", version: "1" } })).toThrow("reviewed deployment");
  expect(() => checkRegistry("hyperliquid", { ...hyper, permit: null })).toThrow("reviewed deployment");
  expect(() => checkRegistry("lighter", { ...lighter, permit: null })).not.toThrow();
  expect(() => checkRegistry("lighter", { ...lighter, permit: { name: "USDC", version: "2" } })).toThrow("reviewed deployment");
});

test("a funding plan lists the permit first, only when a wallet deposit needs it, then the withdrawal and the payment", () => {
  const kinds = (...names: string[]) => names.map(kind => ({ kind, signer: master, chain_id: 137 }));
  const intent = (plan: Record<string, unknown>) => ({ from: "polymarket", payer: master, amount_in: "10000000", funding_plan: { observed_at: new Date().toISOString(), venue: "polymarket", owner: master,
    amount: "10000000", deposit: "7000000", withdrawal_amount: "7000000", withdrawal_to: "signer", payment_setup: "required", requests: kinds("permit", "margin_move", "pay_take"), ...plan } });
  expect(checkFundingPlan(intent({})).requests).toEqual(kinds("permit", "margin_move", "pay_take"));
  for (const plan of [
    { requests: kinds("margin_move", "permit", "pay_take") },
    { payment_setup: "done" },
    { payment_setup: "pending" },
    { requests: kinds("margin_move", "pay_take") },
    { deposit: "0", withdrawal_amount: "0", withdrawal_to: null, requests: kinds("permit", "pay_take") },
  ]) expect(() => checkFundingPlan(intent(plan))).toThrow("Funding requests differ");
});

const owner = "0x84026d3beff123aab7dff957574d1362d6f880a5";
const chain = { id: 999, escrow: ESCROW, token: "0xb88339cb7199b77e23db6e890353e22632ba630f", decimals: 6 };
const order = {
  venue: "hyperliquid",
  order_id: "0x31bf807825710f2bd3fcde1fe005b28a77bd3355a90275391ff6d44d731c5cfe",
  owner,
};
const now = 1_790_000_000;

type PreparedClose = Parameters<typeof checkCloseOffer>[0];

/** What `POST /escrow/close/prepare` answers for `order`. */
const prepared = (): PreparedClose => ({
  venue: "hyperliquid",
  order_id: order.order_id,
  to_margin: true,
  dex: 4_294_967_295,
  nonce: "18446744073709551615",
  deadline: now + 3_600,
  to_sign: [
    {
      kind: "close_offer",
      signer: owner,
      typed_data: {
        types: structuredClone({ EIP712Domain, ...schemas.CloseOffer }),
        primaryType: "CloseOffer",
        domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW },
        message: {
          owner,
          offerId: order.order_id,
          toMargin: true,
          dex: 4_294_967_295,
          nonce: "18446744073709551615",
          deadline: String(now + 3_600),
        },
      },
    },
  ],
});

test("the close asked passes", () => {
  expect(checkCloseOffer(prepared(), order, chain, now)).toBe(true);
});

const tamperings: [string, (close: PreparedClose) => void][] = [
  ["an extra message field", (close) => (required(close.to_sign[0]).typed_data.message.extra = "unexpected")],
  ["another kind", (close) => (required(close.to_sign[0]).kind = "close_orders")],
  ["another signer", (close) => (required(close.to_sign[0]).signer = chain.token)],
  ["a second item", (close) => close.to_sign.push(required(close.to_sign[0]))],
  ["another primary type", (close) => (required(close.to_sign[0]).typed_data.primaryType = "FundOffer")],
  ["a field more", (close) => required(required(close.to_sign[0]).typed_data.types.CloseOffer).push({ name: "to", type: "address" })],
  ["another chain", (close) => (required(close.to_sign[0]).typed_data.domain.chainId = 137)],
  ["another contract", (close) => (required(close.to_sign[0]).typed_data.domain.verifyingContract = chain.token)],
  ["another owner", (close) => (required(close.to_sign[0]).typed_data.message.owner = chain.token)],
  ["another order", (close) => (required(close.to_sign[0]).typed_data.message.offerId = `0x${"1".repeat(64)}`)],
  ["to an address", (close) => (required(close.to_sign[0]).typed_data.message.toMargin = false)],
  ["a dex unlike the body's", (close) => (required(close.to_sign[0]).typed_data.message.dex = 0)],
  ["a dex no venue takes, in both", (close) => {
    close.dex = 123;
    required(close.to_sign[0]).typed_data.message.dex = 123;
  }],
  ["a nonce unlike the body's", (close) => (close.nonce = "1")],
  ["a deadline past the hour", (close) => {
    close.deadline = now + 7_200;
    required(close.to_sign[0]).typed_data.message.deadline = String(now + 7_200);
  }],
  ["an expired deadline", (close) => {
    close.deadline = now - 1;
    required(close.to_sign[0]).typed_data.message.deadline = String(now - 1);
  }],
];

for (const [name, tamper] of tamperings) {
  test(`${name} is refused`, () => {
    const close = prepared();
    tamper(close);
    expect(checkCloseOffer(close, order, chain, now)).toBe(false);
  });
}

test("wallet release requires an explicit matching choice in the request and signature", () => {
  const close = prepared();
  close.to_margin = false;
  close.dex = 0;
  required(close.to_sign[0]).typed_data.message.toMargin = false;
  required(close.to_sign[0]).typed_data.message.dex = 0;
  expect(checkCloseOffer(close, order, chain, now)).toBe(false);
  expect(checkCloseOffer(close, order, chain, now, false)).toBe(true);
  required(close.to_sign[0]).typed_data.message.toMargin = true;
  expect(checkCloseOffer(close, order, chain, now, false)).toBe(false);
});

test("a substituted registry cannot authorize another escrow", () => {
  const close = prepared();
  required(close.to_sign[0]).typed_data.domain.verifyingContract = chain.token;
  expect(checkCloseOffer(close, order, { ...chain, escrow: chain.token }, now)).toBe(false);
});

const maker = `0x${"11".repeat(20)}`, taker = `0x${"22".repeat(20)}`;
/** A maker's fill whose maker leg was abandoned while the taker's payment stays locked, and its refund consent. */
function fixture() {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const payment = {
    id: "fill", role: "maker", maker_leg: "ABANDONED", payment_leg: "LOCKED", from_venue: "hyperliquid", to_venue: "polymarket",
    maker_recipient: maker, payer: taker, swap_id: `0x${"12".repeat(32)}`, hashlock: taker, amount_in: "10000000",
    t1: new Date().toISOString(), t2: new Date((deadline + 600) * 1000).toISOString(), deliver_by: null as string | null, delivery_hash: null as string | null,
  };
  const to_sign: SignItem[] = [{ kind: "refund_payment", fill_id: payment.id, signer: maker, typed_data: {
    domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: required(CHAINS.hyperliquid).escrow },
    primaryType: "RefundPayment", types: structuredClone({ EIP712Domain, ...schemas.RefundPayment }),
    message: { payer: payment.payer, swapId: payment.swap_id, deadline: String(deadline) },
  } }];
  return { payment, prepared: { deadline, to_sign } };
}

test("only an abandoned maker payment can be reviewed for an early refund", () => {
  const { payment, prepared } = fixture();
  expect(canRefundPayment(payment)).toBe(true);
  expect(() => checkPaymentRefund(payment, prepared)).not.toThrow();
  for (const change of [{ role: "taker" as const }, { maker_leg: "LOCKED" as const },
    { maker_leg: "CLAIMED" as const }, { payment_leg: "REFUNDED" as const }, { t2: "2000-01-01T00:00:00Z" }]) {
    expect(() => checkPaymentRefund({ ...payment, ...change }, prepared)).toThrow("This payment cannot be refunded early");
  }
});

test("refund consent binds the payment, recipient, chain, contract, fields and expiry", () => {
  const changed = "Refund terms changed", domain = "Unexpected signing domain";
  const mutations: [(item: SignItem) => void, string][] = [
    [item => { item.kind = "close_offer"; }, changed],
    [item => { item.fill_id = "other-fill"; }, changed],
    [item => { item.signer = taker; }, changed],
    [item => { item.typed_data.message.payer = maker; }, changed],
    [item => { item.typed_data.message.swapId = `0x${"34".repeat(32)}`; }, changed],
    [item => { item.typed_data.message.deadline = "0"; }, changed],
    [item => { item.typed_data.message.recipient = maker; }, "Unexpected signing fields"],
    [item => { item.typed_data.domain.chainId = 137; }, domain],
    [item => { item.typed_data.domain.verifyingContract = taker; }, domain],
    [item => { item.typed_data.domain.version = "2"; }, domain],
    [item => { required(required(item.typed_data.types.RefundPayment)[0]).type = "bytes32"; }, "Unexpected signing types"],
  ];
  for (const [mutate, reason] of mutations) {
    const { payment, prepared } = fixture();
    mutate(required(prepared.to_sign[0]));
    expect(() => checkPaymentRefund(payment, prepared)).toThrow(reason);
  }
  for (const delta of [-1, 3601 + 30]) {
    const { payment, prepared } = fixture();
    prepared.deadline = Math.floor(Date.now() / 1000) + delta;
    required(prepared.to_sign[0]).typed_data.message.deadline = String(prepared.deadline);
    expect(() => checkPaymentRefund({ ...payment, t2: "2099-01-01T00:00:00Z" }, prepared)).toThrow("Signing deadline is expired or too long");
  }
  const { payment, prepared } = fixture();
  expect(() => checkPaymentRefund(payment, { ...prepared, to_sign: [] })).toThrow("Unexpected refund signatures");
  expect(() => checkPaymentRefund(payment, { ...prepared, to_sign: [...prepared.to_sign, ...prepared.to_sign] })).toThrow("Unexpected refund signatures");
  expect(() => checkPaymentRefund({ ...payment, t2: new Date((prepared.deadline - 1) * 1000).toISOString() }, prepared)).toThrow("Refund terms changed");
});

test("an early refund needs the payment locked, and no maker lock or venue delivery", () => {
  type Lock = [bigint, string, string, bigint, number, number];
  const { payment } = fixture();
  const lock = (state: number): Lock => [BigInt(payment.amount_in), payment.hashlock, payment.maker_recipient, BigInt(Math.floor(Date.parse(payment.t2) / 1000)), state, 0];
  const none: Lock = [0n, `0x${"00".repeat(32)}`, `0x${"00".repeat(20)}`, 0n, 0, 0];
  expect(() => checkRefundLocks(payment, lock(1), none)).not.toThrow();
  expect(() => checkRefundLocks(payment, lock(1), lock(1))).toThrow("The onchain locks no longer permit this refund");
  expect(() => checkRefundLocks(payment, lock(1), null)).toThrow("Unsupported refund chain");
  // Delivered inside the venue: no maker lock exists, and a recorded delivery forbids consent.
  const lighter = { ...payment, to_venue: "lighter", deliver_by: payment.t1 };
  expect(() => checkRefundLocks(lighter, lock(1), null)).not.toThrow();
  expect(() => checkRefundLocks(lighter, lock(1), none)).toThrow("Unsupported refund chain");
  expect(() => checkRefundLocks({ ...lighter, delivery_hash: "ab" }, lock(1), null)).toThrow("This fill was delivered");
  expect(() => checkRefundLocks(lighter, lock(2), null)).toThrow("The onchain locks no longer permit this refund");
  // A fill keeps the settlement it was taken under: Aster's escrow era locked the maker.
  expect(() => checkRefundLocks({ ...payment, to_venue: "aster" }, lock(1), none)).not.toThrow();
  expect(() => checkRefundLocks({ ...payment, to_venue: "aster" }, lock(1), null)).toThrow("Unsupported refund chain");
});
