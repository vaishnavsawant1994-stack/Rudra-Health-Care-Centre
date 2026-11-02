type MinorValue=string|number|bigint;
const integerMinor=(value:MinorValue)=>typeof value==="bigint"?value:BigInt(value);

export function parseMajorToMinor(value:string){
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction=""]=value.split(".");
  return BigInt(whole)*BigInt(100)+BigInt((fraction+"00").slice(0,2));
}

export function allocationFits(input:{chargeMinor:MinorValue;adjustmentMinor?:MinorValue;alreadyAllocatedMinor:MinorValue;requestedMinor:MinorValue}){
  return integerMinor(input.alreadyAllocatedMinor)+integerMinor(input.requestedMinor)<=integerMinor(input.chargeMinor)+integerMinor(input.adjustmentMinor??"0");
}

export function refundFits(input:{paymentMinor:MinorValue;reservedRefundMinor:MinorValue;requestedRefundMinor:MinorValue}){
  return integerMinor(input.reservedRefundMinor)+integerMinor(input.requestedRefundMinor)<=integerMinor(input.paymentMinor);
}

export function cashExpectedMinor(input:{openingMinor:MinorValue;cashPaymentsMinor:MinorValue;cashRefundsMinor:MinorValue}){
  return integerMinor(input.openingMinor)+integerMinor(input.cashPaymentsMinor)-integerMinor(input.cashRefundsMinor);
}

export function cashVarianceMinor(input:{expectedMinor:MinorValue;countedMinor:MinorValue}){
  return integerMinor(input.countedMinor)-integerMinor(input.expectedMinor);
}
