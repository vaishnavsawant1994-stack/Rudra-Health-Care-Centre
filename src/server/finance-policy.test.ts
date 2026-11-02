import { describe, expect, it } from "vitest";
import { allocationFits, cashExpectedMinor, cashVarianceMinor, parseMajorToMinor, refundFits } from "./finance-policy";

describe("financial exact-minor-unit policy",()=>{
  it("parses currency strings without floating-point rounding",()=>{
    expect(parseMajorToMinor("0")).toBe(BigInt(0));
    expect(parseMajorToMinor("75.05")).toBe(BigInt(7505));
    expect(parseMajorToMinor("9999999999.99")).toBe(BigInt("999999999999"));
    expect(parseMajorToMinor("1.001")).toBeNull();
    expect(parseMajorToMinor("1e3")).toBeNull();
    expect(parseMajorToMinor("-1.00")).toBeNull();
  });
  it("prevents allocations above the adjusted charge and permits exact partial allocation",()=>{
    expect(allocationFits({chargeMinor:"30000",alreadyAllocatedMinor:"20000",requestedMinor:"10000"})).toBe(true);
    expect(allocationFits({chargeMinor:"30000",alreadyAllocatedMinor:"20000",requestedMinor:"10001"})).toBe(false);
    expect(allocationFits({chargeMinor:"30000",adjustmentMinor:"-5000",alreadyAllocatedMinor:"25000",requestedMinor:"1"})).toBe(false);
  });
  it("reserves requested refunds and rejects excess refund value",()=>{
    expect(refundFits({paymentMinor:"20000",reservedRefundMinor:"5000",requestedRefundMinor:"15000"})).toBe(true);
    expect(refundFits({paymentMinor:"20000",reservedRefundMinor:"15000",requestedRefundMinor:"5001"})).toBe(false);
  });
  it("derives reconciliation expected cash and a signed variance in integer minor units",()=>{
    const expected=cashExpectedMinor({openingMinor:"1000",cashPaymentsMinor:"20000",cashRefundsMinor:"5000"});
    expect(expected).toBe(BigInt(16000));
    expect(cashVarianceMinor({expectedMinor:expected,countedMinor:"15000"})).toBe(BigInt(-1000));
  });
});
