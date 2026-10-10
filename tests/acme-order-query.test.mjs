import test from "node:test";
import assert from "node:assert/strict";
import { parseOrderQuery } from "../lib/acme-validation.ts";

const id = "11111111-1111-1111-1111-111111111111";
const parse = (query) => parseOrderQuery(new URLSearchParams(query));

test("ACME queries separate pending requests, certificate renewal, and submission tracking", () => {
  assert.deepEqual(parse(""), {});
  assert.deepEqual(parse("scope=pending"), { scope: "pending", page: 1 });
  assert.deepEqual(parse("scope=pending&page=2"), { scope: "pending", page: 2 });
  assert.deepEqual(parse(`certificateId=${id}`), { certificateId: id });
  assert.deepEqual(parse(`id=${id}`), { id });
});

test("ACME query rejects ambiguous filters, invalid IDs and unbounded page numbers", () => {
  for (const query of ["scope=all", "page=2", "scope=pending&page=0", "scope=pending&page=-1", "scope=pending&page=1.5", "scope=pending&page=10000000", "scope=pending&page=", `scope=pending&id=${id}`, `certificateId=${id}&id=${id}`, "certificateId=", "id=invalid"]) {
    assert.throws(() => parse(query), /INVALID_/);
  }
});
